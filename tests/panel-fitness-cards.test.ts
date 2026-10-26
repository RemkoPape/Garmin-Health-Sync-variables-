// Why it matters: VO2 max and body weight move slowly and are easy to over-read. The cards smooth them
// (weekly values, a 7-day mean), say nothing without enough readings, and never colour a direction as good.
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { computeVo2, renderVo2 } from "../src/panel/cards/vo2-card";
import { computeBody, renderBody } from "../src/panel/cards/body-card";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";

const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };
const END = "2026-10-22"; // a Thursday
const noop = (): void => undefined;

async function indexOf(frontmatter: (ago: number) => Record<string, unknown> | null, days = 90): Promise<DayIndex> {
	const app = new App();
	await seedHistory(app, { end: END, days, frontmatter });
	return new DayIndex(app as never, () => settings);
}
let root: HTMLElement;
beforeEach(() => {
	root = document.createElement("div");
});
const text = (sel: string): string => root.querySelector(sel)?.textContent ?? "";

describe("VO2 max card", () => {
	/** One value on each Thursday: week w ago has `value(w)`. */
	const weekly = (value: (w: number) => number | null, weeks = 12) =>
		indexOf((ago) => (ago % 7 === 0 && ago / 7 < weeks && value(ago / 7) !== null ? { vo2_max: value(ago / 7) } : { hrv: 40 }));

	it("takes the latest value of each of the last 12 weeks and reads the slope as the change over 12 weeks", async () => {
		const model = computeVo2(await weekly((w) => 50 - 0.5 * w), END);
		expect(model.weeks).toHaveLength(12);
		expect(model.weeks[0]).toBe(44.5);
		expect(model.weeks[11]).toBe(50);
		expect(model.points).toBe(12);
		expect(model.latest).toBe(50);
		expect(model.change).toBeCloseTo(6, 6);
		expect(model.direction).toBe("up");
		renderVo2(root, model, "en", false, noop);
		expect(text(".ghs-card-value")).toBe("50 ml/kg/min");
		expect(root.querySelectorAll(".ghs-vo2-bars .ghs-trend-bar")).toHaveLength(12);
		expect(root.querySelectorAll(".ghs-trend-bar-last")).toHaveLength(1);
		expect(text(".ghs-foot-label")).toBe("↑ +6 over 12 weeks");
		expect(text(".ghs-foot-value")).toBe(en.panelVo2Up);
	});

	it("falls", async () => {
		const model = computeVo2(await weekly((w) => 44 + 0.5 * w), END);
		expect(model.direction).toBe("down");
		renderVo2(root, model, "en", false, noop);
		expect(text(".ghs-foot-label")).toBe("↓ −6 over 12 weeks");
		expect(text(".ghs-foot-value")).toBe(en.panelVo2Down);
	});

	it("calls a change within 0.3 steady", async () => {
		const model = computeVo2(await weekly((w) => 50 + (w % 2) * 0.01), END);
		expect(model.direction).toBe("steady");
		renderVo2(root, model, "en", false, noop);
		expect(text(".ghs-foot-label")).toBe("→ +0 over 12 weeks");
		expect(text(".ghs-foot-value")).toBe(en.panelVo2Steady);
	});

	it("uses the latest day of a week and ignores days after the shown day", async () => {
		const app = new App();
		await seedHistory(app, { end: "2026-10-25", days: 30, frontmatter: (ago) => (ago === 3 ? { vo2_max: 48 } : ago === 1 ? { vo2_max: 49 } : ago === 0 ? { vo2_max: 55 } : { hrv: 1 }) });
		const index = new DayIndex(app as never, () => settings);
		// the 22nd has 48, the 24th 49 and the 25th 55; days after the shown day do not count yet
		expect(computeVo2(index, "2026-10-22").weeks[11]).toBe(48);
		expect(computeVo2(index, "2026-10-23").weeks[11]).toBe(48);
		expect(computeVo2(index, "2026-10-24").weeks[11]).toBe(49);
		expect(computeVo2(index, "2026-10-25").weeks[11]).toBe(55);
	});

	it("leaves missing weeks empty and needs 3 weeks with a value", async () => {
		const model = computeVo2(await weekly((w) => (w === 0 || w === 5 ? 50 : null)), END);
		expect(model.points).toBe(2);
		expect(model.direction).toBeNull();
		renderVo2(root, model, "en", false, noop);
		expect(text(".ghs-card-note")).toBe("Needs 3 weeks with a reading · 2 so far");
		expect(root.querySelector(".ghs-vo2-bars")).toBeNull();
		root.empty();
		renderVo2(root, computeVo2(await weekly((w) => (w % 2 === 0 ? 50 : null)), END), "en", false, noop);
		expect(root.querySelectorAll(".ghs-trend-bar-missing")).toHaveLength(6);
	});

	it("draws a flat series at the middle", async () => {
		renderVo2(root, computeVo2(await weekly(() => 50), END), "en", false, noop);
		expect((root.querySelector(".ghs-trend-bar") as HTMLElement).style.getPropertyValue("--ghs-h")).toBe("60%");
	});

	it("has no reading when the newest value is older than 28 days, but one from exactly 28 days ago counts", async () => {
		const stale = await indexOf((ago) => (ago === 36 || ago === 43 || ago === 50 ? { vo2_max: 50 } : { hrv: 1 }));
		expect(computeVo2(stale, END).latest).toBeNull();
		renderVo2(root, computeVo2(stale, END), "en", false, noop);
		expect(text(".ghs-card-value")).toBe(en.panelNoReading);
		const edge = await indexOf((ago) => (ago === 28 || ago === 35 || ago === 42 ? { vo2_max: 50 } : { hrv: 1 }));
		expect(computeVo2(edge, END).latest).toBe(50);
	});

	it("speaks the plugin language and shows the explanation", async () => {
		renderVo2(root, computeVo2(await weekly((w) => 50 - 0.5 * w), END), "de", true, noop);
		expect(text(".ghs-foot-label")).toBe("↑ +6 in 12 Wochen");
		expect(text(".ghs-foot-value")).toBe(de.panelVo2Up);
		expect(text(".ghs-explain")).toBe(de.panelVo2Explain);
	});
});

describe("body card", () => {
	/** `kg(ago)` kilograms every day (null = no reading), fat 18 + ago / 10 percent. */
	const body = (kg: (ago: number) => number | null, extra: (ago: number) => Record<string, unknown> = () => ({})) =>
		indexOf((ago) => ({ ...(kg(ago) === null ? { hrv: 1 } : { weight_kg: kg(ago) }), ...extra(ago) }), 40);

	it("shows the mean of the last 7 days, the daily dots and the change per week", async () => {
		// 0.1 kg a day more than the day before: +0.7 kg a week; the mean of ago 0..6 is 80 - 0.3
		const model = computeBody(await body((ago) => 80 - 0.1 * ago), END);
		expect(model.weight).toBeCloseTo(79.7, 6);
		expect(model.entries).toBe(14);
		expect(model.points).toHaveLength(28);
		expect(model.points[0]).toEqual({ x: 0, y: expect.closeTo(77.3, 6) });
		expect(model.points[27]).toEqual({ x: 27, y: 80 });
		expect(model.perWeek).toBeCloseTo(0.7, 6);
		expect(model.fast).toBe(false);
		renderBody(root, model, "en", false, noop);
		expect(text(".ghs-card-value")).toBe("79.7 kg");
		expect(root.querySelectorAll(".ghs-dots-point")).toHaveLength(28);
		expect(text(".ghs-foot-label")).toBe("+0.7 kg per week");
		expect(text(".ghs-foot-value")).toBe(en.panelBodyOk);
		expect(root.querySelector(".ghs-foot-over")).toBeNull();
	});

	it("places the dots between the lowest and the highest reading", async () => {
		renderBody(root, computeBody(await body((ago) => 80 - 0.1 * ago), END), "en", false, noop);
		const dots = Array.from(root.querySelectorAll<HTMLElement>(".ghs-dots-point"));
		expect(dots[0]!.style.getPropertyValue("--ghs-x")).toBe("0%");
		expect(dots[0]!.style.getPropertyValue("--ghs-y")).toBe("0%");
		expect(dots[27]!.style.getPropertyValue("--ghs-x")).toBe("100%");
		expect(dots[27]!.style.getPropertyValue("--ghs-y")).toBe("100%");
	});

	it("flags a change faster than 1 percent of the weight a week", async () => {
		const model = computeBody(await body((ago) => 80 - 0.2 * ago), END);
		expect(model.fast).toBe(true);
		renderBody(root, model, "en", false, noop);
		expect(text(".ghs-foot-value")).toBe(en.panelBodyFast);
		expect(root.querySelector(".ghs-foot-over")).not.toBeNull();
	});

	it("writes a fall with a minus sign and treats both directions alike", async () => {
		const model = computeBody(await body((ago) => 80 + 0.1 * ago), END);
		expect(model.perWeek).toBeCloseTo(-0.7, 6);
		renderBody(root, model, "en", false, noop);
		expect(text(".ghs-foot-label")).toBe("−0.7 kg per week");
		expect(computeBody(await body((ago) => 80 + 0.2 * ago), END).fast).toBe(true);
	});

	it("draws a flat series in the middle", async () => {
		renderBody(root, computeBody(await body(() => 80), END), "en", false, noop);
		expect((root.querySelector(".ghs-dots-point") as HTMLElement).style.getPropertyValue("--ghs-y")).toBe("50%");
		expect(text(".ghs-foot-value")).toBe(en.panelBodyOk);
	});

	it("shows the body fat mean when there is some", async () => {
		const index = await body((ago) => 80 - 0.1 * ago, (ago) => ({ body_fat_pct: 18 + (ago < 7 ? 1 : 0) }));
		renderBody(root, computeBody(index, END), "en", false, noop);
		expect(text(".ghs-card-note")).toBe("Body fat 19 %");
	});

	it("reads pounds from notes written with imperial units", async () => {
		const index = await indexOf((ago) => ({ weight_lbs: 176 - ago }), 40);
		const model = computeBody(index, END);
		expect(model.unit).toBe("lbs");
		renderBody(root, model, "en", false, noop);
		expect(text(".ghs-card-value")).toBe("173 lbs");
		expect(text(".ghs-foot-label")).toBe("+7 lbs per week");
	});

	it("is locked with fewer than 3 readings in 14 days, and has no reading without any", async () => {
		const sparse = await body((ago) => (ago === 0 || ago === 5 ? 80 : null));
		renderBody(root, computeBody(sparse, END), "en", false, noop);
		expect(text(".ghs-card-note")).toBe("Unlocks after 3 days of data · 2 so far");
		expect(root.querySelector(".ghs-dots")).toBeNull();
		root.empty();
		renderBody(root, computeBody(await body(() => null), END), "en", false, noop);
		expect(text(".ghs-card-value")).toBe(en.panelNoReading);
	});

	it("needs two readings in the last 28 days for a change", async () => {
		const model = computeBody(await body((ago) => (ago === 0 ? 80 : null)), END);
		expect(model.perWeek).toBeNull();
		expect(model.fast).toBe(false);
		renderBody(root, model, "en", false, noop);
		expect(text(".ghs-card-note")).toBe("Unlocks after 3 days of data · 1 so far");
	});

	it("speaks the plugin language and shows the explanation", async () => {
		renderBody(root, computeBody(await body((ago) => 80 - 0.1 * ago), END), "de", true, noop);
		expect(text(".ghs-foot-label")).toBe("+0,7 kg pro Woche");
		expect(text(".ghs-foot-value")).toBe(de.panelBodyOk);
		expect(text(".ghs-explain")).toBe(de.panelBodyExplain);
	});
});
