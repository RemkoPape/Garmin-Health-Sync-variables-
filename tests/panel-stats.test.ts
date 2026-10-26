// Why it matters: the panel's ranges come from these helpers. A window that includes the shown day, a band
// thinner than the sensor can resolve or a range from too few days would show confident but wrong colours.
import { describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { average, baseline, windowValues, zScore } from "../src/panel/stats";

const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };

describe("baseline", () => {
	it("is null below the minimum number of values", () => {
		expect(baseline([1, 2, 3], 4, 0)).toBeNull();
	});

	it("returns mean and population standard deviation", () => {
		const b = baseline([2, 4, 4, 4, 5, 5, 7, 9], 8, 0)!;
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
