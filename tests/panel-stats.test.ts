// Why it matters: the panel's ranges come from these helpers. A window that includes the shown day, a band
// thinner than the sensor can resolve or a range from too few days would show confident but wrong colours.
import { describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { average, baseline, slope, windowValues, zScore } from "../src/panel/stats";

const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };

describe("baseline", () => {
	it("is null below the minimum number of values", () => {
		expect(baseline([1, 2, 3], 4, 0)).toBeNull();
	});

	it("returns mean and population standard deviation", () => {
		const b = baseline([2, 4, 4, 4, 5, 5, 7, 9], 8, 1)!;
		expect(b.mean).toBe(5);
		expect(b.sd).toBe(2);
		expect(b.n).toBe(8);
	});

	it("never goes below the standard deviation floor", () => {
		expect(baseline([60, 60, 60], 3, 2)!.sd).toBe(2);
	});

	it("scores a value in standard deviations", () => {
		expect(zScore(9, { mean: 5, sd: 2, n: 8 })).toBe(2);
	});
});

describe("windowValues", () => {
	it("takes the days before the date, never the date itself, and skips gaps", async () => {
		const app = new App();
		await seedHistory(app, { end: "2026-10-22", days: 5, frontmatter: (ago) => (ago === 2 ? null : { hrv: 50 + ago }) });
		const index = new DayIndex(app as never, () => settings);
		// 22nd = 50 (the shown day), 21st = 51, 20th missing, 19th = 53, 18th = 54
		expect(windowValues(index, "hrv", "2026-10-22", 4)).toEqual([51, 53, 54]);
		expect(windowValues(index, "hrv", "2026-10-22", 2)).toEqual([51]);
	});
});

describe("average", () => {
	it("is the mean of the days before, or null with too few", async () => {
		const app = new App();
		await seedHistory(app, { end: "2026-10-22", days: 6, frontmatter: (ago) => ({ steps: 1000 * (ago + 1) }) });
		const index = new DayIndex(app as never, () => settings);
		// the 5 days before the 22nd: 2000..6000
		expect(average(index, "steps", "2026-10-22", 7, 5)).toBe(4000);
		expect(average(index, "steps", "2026-10-22", 7, 6)).toBeNull();
	});
});

describe("slope", () => {
	it("is the least-squares change of y per x", () => {
		expect(slope([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }])).toBe(2);
		expect(slope([{ x: 0, y: 5 }, { x: 4, y: 1 }])).toBe(-1);
		expect(slope([{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 4 }])).toBeCloseTo(0.9, 6);
	});

	it("is 0 for a flat series or when x does not vary", () => {
		expect(slope([{ x: 0, y: 4 }, { x: 1, y: 4 }])).toBe(0);
		expect(slope([{ x: 2, y: 1 }, { x: 2, y: 9 }])).toBe(0);
	});
});
