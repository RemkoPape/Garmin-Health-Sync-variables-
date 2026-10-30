// Why it matters: a card that opens its light bulb to nothing but "how to read this" looks broken. Where the data
// allows a statement, every state of a card should get one; these cases are the gaps found on real cards (stress above
// the week but still in the low band, floors short on a day that is not over).
import { describe, expect, it, vi } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { Signals } from "../src/panel/insights/signals";
import { floorsInsights, stepsInsights } from "../src/panel/insights/activity";
import { stressInsights } from "../src/panel/insights/energy";
import { INSIGHTS } from "../src/panel/insights/registry";

const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };
const END = "2026-10-22";
type Fm = Record<string, unknown>;

async function signals(frontmatter: (ago: number) => Fm, days = 14): Promise<Signals> {
	const app = new App();
	await seedHistory(app, { end: END, days, frontmatter });
	return new Signals(new DayIndex(app as never, () => settings), END, null);
}
const ids = (list: { id: string }[]): string[] => list.map((i) => i.id);

describe("stress", () => {
	const day = (level: number, week: number, extra: Fm = {}) => (ago: number): Fm => (ago === 0 ? { stress: level, ...extra } : { stress: week });

	it("says it is above the week when the level is more than 10 over the average and still in the low band", async () => {
		const out = stressInsights(await signals(day(38.4, 28)));
		expect(ids(out)).toEqual(["stress_above_week"]);
		expect(out[0]!.params).toEqual({ level: "38", week: "28", delta: "10" });
	});

	it("is in line with the week at exactly 10 over, and calm at 25 or below", async () => {
		expect(ids(stressInsights(await signals(day(38, 28))))).toEqual(["stress_usual"]);
		expect(ids(stressInsights(await signals(day(25, 5))))).toEqual(["stress_calm"]);
	});

	it("says a high level is in line with the week when the days before were as stressed, and keeps the sleep reason first", async () => {
		const out = stressInsights(await signals(day(55, 50)));
		expect(ids(out)).toEqual(["stress_high_usual"]);
		expect(out[0]!.params).toEqual({ level: "55", week: "50" });
		const short = stressInsights(await signals(day(55, 50, { sleep_duration: "4h 0min" }), 30));
		expect(ids(short)).toEqual(["stress_high_sleep"]);
	});

	it("leaves the rules above 50 alone", async () => {
		expect(ids(stressInsights(await signals(day(60, 30)))).includes("stress_above_week")).toBe(false);
		expect(ids(stressInsights(await signals(day(60, 30))))).toEqual(["stress_high_week"]);
	});

	it("names the more stressed minutes next to it, and says nothing without a week to compare with", async () => {
		const both = stressInsights(await signals(day(38.4, 28, { stress_high: 215, recovery_high: 120 })));
		expect(ids(both)).toEqual(["stress_more_stressed", "stress_above_week"]);
		expect(stressInsights(await signals((ago) => (ago === 0 ? { stress: 38 } : {}), 3))).toEqual([]);
	});

	it("gives every level from 0 to 100 against every week from 5 to 60 at least one statement", async () => {
		for (const week of [5, 20, 28, 40, 60]) {
			for (let level = 0; level <= 100; level += 3) {
				const out = stressInsights(await signals(day(level, week)));
				expect(out.length, `${level} against a week of ${week}`).toBeGreaterThan(0);
			}
		}
	});
});

describe("floors", () => {
	const usual = (ago: number): Fm => (ago === 0 ? { floors: 5 } : { floors: 8 });

	it("says what is left to the usual range on a day that is not over, and nothing about a day that is", async () => {
		const s = await signals(usual);
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date(2026, 9, 22, 11));
			const out = floorsInsights(s);
			expect(ids(out)).toEqual(["floors_to_go"]);
			expect(out[0]!.params).toEqual({ left: "3", low: "8", high: "9" });
			vi.setSystemTime(new Date(2026, 9, 23, 11));
			expect(floorsInsights(s)).toEqual([]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps the zone texts: reached is good, a quiet stretch is the streak", async () => {
		expect(ids(floorsInsights(await signals((ago) => ({ floors: 9 }))))).toEqual(["floors_zone_good"]);
	});
});

describe("the registry", () => {
	it("knows the two new interpretations", () => {
		expect(INSIGHTS.stress_above_week).toEqual({ card: "stress", kind: "watch" });
		expect(INSIGHTS.floors_to_go).toEqual({ card: "floors", kind: "watch" });
	});
});

describe("steps", () => {
	const week = (today: number) => (ago: number): Fm => ({ steps: ago === 0 ? today : 8000 });

	it("says what is left to the usual on a day that is not over, and nothing on a day that is, when no quiet stretch or weekday pattern applies", async () => {
		const s = await signals(week(5000), 10);
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date(2026, 9, 22, 11));
			const out = stepsInsights(s);
			expect(ids(out)).toEqual(["steps_to_go"]);
			expect(out[0]!.params).toEqual({ left: "3000", min: "30", base: "8000" });
			vi.setSystemTime(new Date(2026, 9, 23, 11));
			expect(stepsInsights(s)).toEqual([]);
		} finally {
			vi.useRealTimers();
		}
	});
});
