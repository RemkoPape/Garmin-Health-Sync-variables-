// Why it matters: a card that has data but says nothing under its light bulb looks unfinished, and a long history
// should tell the user things a short one cannot. These rules cover the quiet cases and the long-history ones.
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { Signals } from "../src/panel/insights/signals";
import { insightText, type Insight } from "../src/panel/insights/registry";
import { hrvInsights, restingHrInsights } from "../src/panel/insights/recovery";
import { floorsInsights, stepsInsights } from "../src/panel/insights/activity";
import { sessionsInsights, weeklyInsights } from "../src/panel/insights/training";
import { de } from "../src/i18n/de";

const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };
const END = "2026-10-22"; // a Thursday
type Fm = Record<string, unknown>;
const ids = (list: Insight[]): string[] => list.map((i) => i.id);

async function signals(fm: (ago: number) => Fm | null, days: number, birthYear: number | null = null): Promise<Signals> {
	const app = new App();
	await seedHistory(app, { end: END, days, frontmatter: fm });
	return new Signals(new DayIndex(app as never, () => settings), END, birthYear);
}

afterEach(() => vi.useRealTimers());

describe("HRV and resting heart rate over months", () => {
	/** Three stretches of a year: the last 90 days at `recent`, the 90 before at `prior`, the rest at `old`. */
	const hrvOver = (recent: number, prior: number, old = 55) => signals((ago) => ({ hrv: ago < 90 ? recent : ago < 180 ? prior : old }), 300);

	it("says when the last 90 days average clearly lower or higher than the 90 before", async () => {
		expect(await hrvOver(50, 60).then(hrvInsights)).toEqual([{ id: "hrv_in_range" }, { id: "hrv_trend_down", params: { recent: "50", delta: "10" } }]);
		expect(await hrvOver(60, 50).then(hrvInsights)).toEqual([{ id: "hrv_in_range" }, { id: "hrv_trend_up", params: { recent: "60", delta: "10" } }]);
	});

	it("keeps quiet about a change that is smaller than half the spread of the year, and without two windows of data", async () => {
		expect(ids(hrvInsights(await hrvOver(55, 55.5, 55)))).toEqual(["hrv_in_range"]);
		expect(ids(hrvInsights(await signals((ago) => ({ hrv: ago < 90 ? 50 : ago < 100 ? 60 : ago < 180 ? null : 55 }), 300)))).toEqual(["hrv_in_range"]);
	});

	it("does the same for the resting heart rate, a rise being the one to watch", async () => {
		const over = (recent: number, prior: number) => signals((ago) => ({ resting_hr: ago < 90 ? recent : ago < 180 ? prior : 56 }), 300);
		expect(await over(60, 52).then(restingHrInsights)).toEqual([{ id: "rhr_in_range" }, { id: "rhr_trend_up", params: { recent: "60", delta: "8" } }]);
		expect(await over(52, 60).then(restingHrInsights)).toEqual([{ id: "rhr_in_range" }, { id: "rhr_trend_down", params: { recent: "52", delta: "8" } }]);
		expect(ids(restingHrInsights(await over(56, 56.4)))).toEqual(["rhr_in_range"]);
	});
});

describe("steps over half a year", () => {
	it("says a day is at the usual level", async () => {
		expect(await signals((ago) => ({ steps: ago === 0 ? 10_400 : 10_000 }), 10).then(stepsInsights)).toEqual([{ id: "steps_in_zone", params: { base: "10000" } }]);
	});

	it("points out that this weekday is usually the quiet one, naming the weekday in the user's language", async () => {
		// every Thursday 3000 steps, every other day 8000: the shown Thursday is below the usual (7286)
		const s = await signals((ago) => ({ steps: ago % 7 === 0 ? 3000 : 8000 }), 200);
		const out = stepsInsights(s);
		expect(out).toEqual([{ id: "steps_weekday_low", params: { dayOf: END, avg: "3000", pct: "63" } }]);
		expect(insightText(out[0]!, "en")).toBe("On Thursdays you usually walk 3000 steps, 63 percent fewer than on your other days. A short walk on these days evens out your week.");
		expect(insightText(out[0]!, "de")).toBe(de.insight_steps_weekday_low.replace("{day}", "Donnerstag").replace("{avg}", "3000").replace("{pct}", "63"));
	});

	it("needs a pattern: not for an ordinary weekday, a short history or a day that reached the usual", async () => {
		expect(stepsInsights(await signals((ago) => ({ steps: 8000 + (ago % 3) * 10 }), 200))).toEqual([]);
		expect(stepsInsights(await signals((ago) => ({ steps: ago % 7 === 0 ? 3000 : 8000 }), 40))).toEqual([]);
		expect(ids(stepsInsights(await signals((ago) => ({ steps: ago === 0 ? 7300 : ago % 7 === 0 ? 3000 : 8000 }), 200)))).toEqual(["steps_in_zone"]);
	});
});

describe("floors", () => {
	it("is glad about the usual floors or more", async () => {
		expect(ids(floorsInsights(await signals((ago) => ({ floors: ago === 0 ? 12 : 10 }), 10)))).toEqual(["floors_zone_good"]);
	});

	it("points out a stretch of quiet days when floors are below the usual", async () => {
		expect(floorsInsights(await signals((ago) => ({ floors: ago === 0 ? 2 : ago <= 5 ? 3 : 10 }), 10))).toEqual([{ id: "floors_below_streak", params: { n: "5" } }]);
	});

	it("has nothing for a below-usual day without a stretch, a day of zero, or without floors or a range", async () => {
		expect(floorsInsights(await signals((ago) => ({ floors: ago === 0 ? 4 : 5 }), 10))).toEqual([]);
		expect(floorsInsights(await signals((ago) => (ago === 0 ? { floors: 0 } : { floors: 0 }), 10))).toEqual([]);
		expect(floorsInsights(await signals((ago) => (ago === 0 ? null : { floors: 10 }), 10))).toEqual([]);
		// days without floors do not count as quiet
		expect(floorsInsights(await signals((ago) => (ago === 0 ? { floors: 2 } : ago <= 2 ? { hrv: 1 } : { floors: 10 }), 10))).toEqual([]);
		expect(floorsInsights(await signals((ago) => ({ floors: ago === 0 ? 5 : null }), 10))).toEqual([]);
	});
});

describe("VO2 max with too few weeks", () => {
	it("has nothing to say about a trend that is not there yet", async () => {
		const { vo2Insights } = await import("../src/panel/insights/activity");
		const two = await signals((ago) => (ago === 0 || ago === 7 ? { vo2_max: 48 } : { hrv: 1 }), 20);
		expect(vo2Insights(two)).toEqual([]);
	});
});

describe("the week's room and the mix of sessions", () => {
	const week = (perDay: (ago: number) => number) => signals((ago) => ({ running: `${perDay(ago)}min` }), 35);

	it("says what is left to the limit today and what that makes per day for the days that remain", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 9, 22, 12));
		// Monday to Thursday 4 x 20 = 80 minutes against a limit of 231: 151 left, 4 days including today
		expect(weeklyInsights(await week((ago) => (ago < 4 ? 20 : 30)))).toEqual([{ id: "weekly_room", params: { left: "151", perDay: "38", days: "4" } }]);
		expect(ids(weeklyInsights(await week((ago) => (ago < 4 ? 55 : 30))))).toEqual(["weekly_on_track", "weekly_room"]);
		expect(ids(weeklyInsights(await week((ago) => (ago < 4 ? 90 : 30))))).toEqual(["weekly_over_cap"]);
	});

	it("does not plan a week that is over, or look at a day that is not today", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 9, 28, 12));
		expect(weeklyInsights(await week((ago) => (ago < 4 ? 20 : 30)))).toEqual([]);
	});

	const born = 1986; // maximum heart rate 180
	const sessions = (hr: (ago: number) => number | null) => signals((ago) => (hr(ago) === null ? { hrv: 1 } : { running: `40min · Ø${hr(ago)} bpm` }), 10, born);

	it("calls a mix of easy and hard sessions balanced", async () => {
		const out = sessionsInsights(await sessions((ago) => [165, 165, 120, 120, 135][ago] ?? null));
		expect(out).toEqual([{ id: "sessions_balanced", params: { easy: "2", hard: "2" } }]);
	});

	it("has nothing for sessions without any hard or any easy one", async () => {
		expect(sessionsInsights(await sessions((ago) => [135, 135, 135][ago] ?? null))).toEqual([]);
		expect(sessionsInsights(await sessions((ago) => [165, 135, 135][ago] ?? null))).toEqual([]);
	});
});
