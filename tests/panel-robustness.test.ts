// Why it matters: a score or a chart built on missing, zero or freak data must say it does not know instead of
// showing a confident number. These are the cases where a gap used to look like a good day: two ranges that do
// not overlap, a missing night counted as no sleep debt, a stage of zero minutes, one broken reading in a baseline.
import { describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { baseline, pairedDays } from "../src/panel/stats";
import { computeToday, renderToday } from "../src/panel/cards/today-card";
import { computeStages, renderStages } from "../src/panel/cards/stages-card";
import { computeHydration, hydrationShare, renderHydration } from "../src/panel/cards/hydration-card";
import { computeRange, HRV_CARD, renderRange } from "../src/panel/cards/range-card";
import { Signals } from "../src/panel/insights/signals";
import { en } from "../src/i18n/en";

const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };
const END = "2026-10-22";
type Fm = Record<string, unknown>;

async function indexOf(frontmatter: (ago: number) => Fm | null, days: number): Promise<DayIndex> {
	const app = new App();
	await seedHistory(app, { end: END, days, frontmatter });
	return new DayIndex(app as never, () => settings);
}
const alt = (ago: number, a: number, b: number): number => (ago % 2 === 0 ? a : b);
const full = (ago: number): Fm => ({ hrv: alt(ago, 62, 58), resting_hr: alt(ago, 54, 50), sleep_duration: "7h 30min" });
const html = (render: (parent: HTMLElement) => void): string => {
	const parent = document.createElement("div");
	render(parent);
	return parent.innerHTML;
};

describe("HRV and resting heart rate on different days", () => {
	it("counts only the days on which both were measured", async () => {
		// HRV on the older 15 days, resting heart rate on the newer 15: each has a range, but they never overlap
		const index = await indexOf((ago) => ({ sleep_duration: "7h 30min", ...(ago >= 16 ? { hrv: alt(ago, 62, 58) } : { resting_hr: alt(ago, 54, 50) }), ...(ago === 0 ? { hrv: 60, resting_hr: 52 } : {}) }), 31);
		expect(pairedDays(index, ["hrv", "resting_hr"], END, 30)).toBe(0);
		const model = computeToday(index, END, null);
		expect(model.baselineDays).toBe(0);
		expect(model.score).toBeNull();
		expect(html((p) => renderToday(p, model, "en", false, () => undefined))).toContain("so far");
	});

	it("gives a score again once enough days have both", async () => {
		const index = await indexOf(full, 12);
		const model = computeToday(index, END, null);
		expect(model.baselineDays).toBe(11);
		expect(model.score).not.toBeNull();
		const few = await indexOf(full, 5);
		expect(computeToday(few, END, null).baselineDays).toBe(4);
		expect(computeToday(few, END, null).score).toBeNull();
	});
});

describe("sleep that is missing", () => {
	it("gives no score without last night's sleep, because the missing night would count as no debt", async () => {
		const index = await indexOf((ago) => (ago === 0 ? { hrv: 60, resting_hr: 52 } : full(ago)), 40);
		const model = computeToday(index, END, null);
		expect(model.score).toBeNull();
		expect(html((p) => renderToday(p, model, "en", false, () => undefined))).toContain(en.panelTodayWaiting);
	});

	it("says how many nights the debt rests on when the week has gaps, and nothing when all 7 are there", async () => {
		const gaps = await indexOf((ago) => ({ ...full(ago), ...(ago === 3 || ago === 5 ? { sleep_duration: undefined } : {}) }), 40);
		const model = computeToday(gaps, END, null);
		expect(model.score).not.toBeNull();
		expect(model.sleepNights).toBe(5);
		expect(html((p) => renderToday(p, model, "en", false, () => undefined))).toContain("5 of 7 nights");
		const complete = computeToday(await indexOf(full, 40), END, null);
		expect(complete.sleepNights).toBe(7);
		expect(html((p) => renderToday(p, complete, "en", false, () => undefined))).not.toContain("of 7 nights");
	});
});

describe("zero minutes and zero means in the charts", () => {
	const noNaN = (markup: string): void => {
		expect(markup).not.toMatch(/NaN|Infinity/);
	};
	const night = { sleep_deep: "1h 30min", sleep_rem: "1h 40min", sleep_light: "4h 0min", sleep_awake: "0h 0min" };

	it("does not draw a stage that was not recorded against a usual of zero", async () => {
		// awake time is 0 on every night: a watch that sends none. Deep, REM and light have a usual amount.
		const index = await indexOf(() => night, 20);
		const model = computeStages(index, END);
		const awake = model.stages!.find((s) => s.spec.id === "awake")!;
		expect(awake.baseline).toBeNull();
		expect(awake.deviation).toBeNull();
		noNaN(html((p) => renderStages(p, model, "en", false, () => undefined)));
	});

	it("shows no deviation for a stage of 0 minutes on a night whose other nights had it", async () => {
		const index = await indexOf((ago) => ({ ...night, sleep_awake: ago === 0 ? "0h 0min" : "0h 40min" }), 20);
		const awake = computeStages(index, END).stages!.find((s) => s.spec.id === "awake")!;
		expect(awake.minutes).toBe(0);
		expect(awake.baseline?.mean).toBe(40);
		expect(awake.deviation).toBeNull();
	});

	it("draws nothing for a night of zero everywhere", async () => {
		const zero = { sleep_deep: "0h 0min", sleep_rem: "0h 0min", sleep_light: "0h 0min", sleep_awake: "0h 0min" };
		expect(computeStages(await indexOf(() => zero, 10), END).stages).toBeNull();
	});

	it("treats a goal or usual intake of 0 as no mark, without NaN or Infinity", async () => {
		const index = await indexOf((ago) => ({ hydration_ml: ago === 0 ? 1200 : 0, hydration_goal_ml: 0 }), 10);
		const model = computeHydration(index, END);
		expect(model.goal).toBeNull();
		expect(model.usual).toBeNull();
		expect(hydrationShare(index, END)).toBeNull();
		noNaN(html((p) => renderHydration(p, model, "en", false, () => undefined)));
		const none = await indexOf(() => ({ hydration_ml: 0 }), 10);
		noNaN(html((p) => renderHydration(p, computeHydration(none, END), "en", false, () => undefined)));
	});
});

describe("one freak reading in a baseline", () => {
	const usual = [58, 62, 58, 62, 58, 62, 58, 62, 58, 62];

	it("leaves a value far outside the rest out of the mean and the spread, from 8 values on", () => {
		const clean = baseline(usual, 5, 2)!;
		const spiked = baseline([...usual, 190], 5, 2)!;
		expect(spiked.n).toBe(10);
		expect(spiked.mean).toBeCloseTo(clean.mean, 6);
		expect(spiked.sd).toBeCloseTo(clean.sd, 6);
		// a reading far below is left out as well
		expect(baseline([...usual, 5], 5, 2)!.n).toBe(10);
	});

	it("keeps every value of a short list, and a value that is only somewhat high", () => {
		expect(baseline([58, 62, 58, 62, 190], 5, 2)!.n).toBe(5);
		expect(baseline([...usual, 70], 5, 2)!.n).toBe(11);
	});

	it("does not decide an outlier from a spread smaller than the floor", () => {
		// all the same: the spread is the floor of 2, so 62 is 4 from the middle and well inside 5 spreads
		expect(baseline([58, 58, 58, 58, 58, 58, 58, 58, 62], 5, 2)!.n).toBe(9);
	});

	it("keeps the usual range of a card and the z-score of the interpretations steady when one day was a sensor error", async () => {
		const index = await indexOf((ago) => ({ hrv: ago === 12 ? 190 : alt(ago, 62, 58) }), 31);
		const model = computeRange(HRV_CARD, index, END);
		expect(model.baseline!.mean).toBeCloseTo(60, 0);
		expect(model.baseline!.sd).toBeLessThan(3);
		expect(model.baseline!.n).toBe(29);
		expect(new Signals(index, END, null).z("hrv")).toBe(model.z);
		// the usual range on the card is the clean one (58 to 62), not one stretched to 190
		expect(html((p) => renderRange(p, HRV_CARD, model, "en", false, () => undefined))).toContain("Usual range 58–62 ms");
	});
});
