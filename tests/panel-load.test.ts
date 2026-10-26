// Why it matters: intensity steps and the 7 over 28 day ratio decide what the training cards advise. Ranking
// by heart rate, the 10 session minimum, recovery sessions left out and weeks without notes not counting
// are the rules that keep a thin history from producing a confident number.
import { describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { heartRateHistory, intensityStep, kmBetween, minutesBetween, previousWeekSums, previousWeeks, previousWeeksKm, sessionLoad } from "../src/panel/load";
import { percentileRank } from "../src/panel/stats";
import type { Session } from "../src/panel/sessions";

const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };
const END = "2026-10-22"; // a Thursday
const session = (patch: Partial<Session> = {}): Session => ({ type: "running", category: "running", count: 1, minutes: 30, km: null, avgHr: 140, kcal: null, ...patch });

async function indexOf(frontmatter: (ago: number) => Record<string, unknown> | null, days: number): Promise<DayIndex> {
	const app = new App();
	await seedHistory(app, { end: END, days, frontmatter });
	return new DayIndex(app as never, () => settings);
}

describe("percentileRank", () => {
	it("is the share of values at or below", () => {
		expect(percentileRank(3, [1, 2, 3, 4])).toBe(0.75);
		expect(percentileRank(0, [1, 2])).toBe(0);
		expect(percentileRank(9, [1, 2])).toBe(1);
	});
});

describe("intensityStep", () => {
	const history = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190];

	it.each([
		[100, 0], // 0.1
		[120, 1], // 0.3
		[140, 2], // 0.5
		[160, 3], // 0.7
		[190, 4], // 1.0
		[200, 4],
		[50, 0],
	])("puts %s bpm at step %s", (hr, step) => {
		expect(intensityStep(session({ avgHr: hr }), history)).toBe(step);
	});

	it("has no step without a heart rate, for recovery or with fewer than 10 sessions of history", () => {
		expect(intensityStep(session({ avgHr: null }), history)).toBeNull();
		expect(intensityStep(session({ type: "breathwork", category: "other" }), history)).toBeNull();
		expect(intensityStep(session(), history.slice(1))).toBeNull();
	});
});

describe("sessionLoad", () => {
	const history = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190];
	it("weights minutes by the step: 0.6, 0.8, 1.0, 1.2, 1.4", () => {
		expect(sessionLoad(session({ avgHr: 100 }), history)).toBeCloseTo(18);
		expect(sessionLoad(session({ avgHr: 120 }), history)).toBeCloseTo(24);
		expect(sessionLoad(session({ avgHr: 140 }), history)).toBeCloseTo(30);
		expect(sessionLoad(session({ avgHr: 160 }), history)).toBeCloseTo(36);
		expect(sessionLoad(session({ avgHr: 190 }), history)).toBeCloseTo(42);
	});

	it("uses the plain minutes while the intensity is unknown", () => {
		expect(sessionLoad(session({ avgHr: null }), history)).toBe(30);
		expect(sessionLoad(session({ avgHr: 190 }), [])).toBe(30);
	});
});

describe("heartRateHistory", () => {
	it("takes the heart rates of non-recovery sessions before the day, never the day itself", async () => {
		const index = await indexOf((ago) => ({ running: "30min · Ø150 bpm", ...(ago === 1 ? { breathwork: "10min · Ø60 bpm" } : {}), ...(ago === 2 ? { yoga: "30min" } : {}) }), 4);
		expect(heartRateHistory(index, END)).toEqual([150, 150, 150]);
	});

	it("stops after 90 sessions", async () => {
		const index = await indexOf(() => ({ running: "30min · Ø150 bpm", cycling: "30min · Ø120 bpm" }), 70);
		expect(heartRateHistory(index, END)).toHaveLength(90);
	});
});

describe("minutesBetween", () => {
	it("adds the minutes of the days in the range, both ends included, without recovery", async () => {
		const index = await indexOf(() => ({ running: "30min", breathwork: "10min" }), 10);
		expect(minutesBetween(index, "2026-10-19", END)).toBe(120);
		expect(minutesBetween(index, END, END)).toBe(30);
	});
});

describe("previousWeeks", () => {
	it("returns the minutes of the previous complete weeks that have enough notes, nearest first", async () => {
		const index = await indexOf(() => ({ running: "30min" }), 35); // Sep 18 .. Oct 22
		expect(previousWeeks(index, END)).toEqual([210, 210, 210, 210]);
	});

	it("skips a week with fewer than 4 notes and keeps counting zero-session weeks that have notes", async () => {
		// notes only on Oct 5..11 (every day, no sessions) and Oct 12..14 (3 days)
		const app = new App();
		await seedHistory(app, { end: "2026-10-11", days: 7, frontmatter: () => ({ hrv: 40 }) });
		await seedHistory(app, { end: "2026-10-14", days: 3, frontmatter: () => ({ running: "60min" }) });
		const index = new DayIndex(app as never, () => settings);
		expect(previousWeeks(index, END)).toEqual([0]);
	});

	it("is empty without notes in the previous weeks", async () => {
		expect(previousWeeks(await indexOf(() => ({ running: "30min" }), 4), END)).toEqual([]);
	});
});

describe("kilometres per sport", () => {
	it("adds the distance of one category in a range and ignores sessions without distance", async () => {
		const index = await indexOf(() => ({ running: "5 km · 30min", cycling: "20 km · 60min", yoga: "30min" }), 10);
		expect(kmBetween(index, "2026-10-19", END, "running")).toBe(20);
		expect(kmBetween(index, "2026-10-19", END, "cycling")).toBe(80);
	});

	it("gives the kilometres of the previous weeks that have enough notes", async () => {
		const index = await indexOf(() => ({ running: "5 km · 30min" }), 35);
		expect(previousWeeksKm(index, END, "running")).toEqual([35, 35, 35, 35]);
		expect(previousWeeksKm(index, END, "cycling")).toEqual([0, 0, 0, 0]);
	});
});

describe("previousWeekSums", () => {
	it("sums a numeric metric over each previous complete week with enough notes", async () => {
		const index = await indexOf(() => ({ intensity_min: 10 }), 35);
		expect(previousWeekSums(index, END, "intensity_min")).toEqual([70, 70, 70, 70]);
		expect(previousWeekSums(index, END, "floors")).toEqual([0, 0, 0, 0]);
	});
});
