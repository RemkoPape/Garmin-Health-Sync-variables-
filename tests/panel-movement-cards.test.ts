// Why it matters: these cards tell the user how much more to move today. The zone arithmetic, the week
// layout (Monday first, days still to come as dashed placeholders) and the units decide what the text says.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { computeSteps, renderSteps } from "../src/panel/cards/steps-card";
import { computeIntensity, renderIntensity } from "../src/panel/cards/intensity-card";
import { computeFloors, renderFloors } from "../src/panel/cards/floors-card";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";

const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };
const END = "2026-10-22"; // a Thursday

async function indexOf(frontmatter: (ago: number) => Record<string, unknown> | null, days = 12): Promise<DayIndex> {
	const app = new App();
	await seedHistory(app, { end: END, days, frontmatter });
	return new DayIndex(app as never, () => settings);
}

let root: HTMLElement;
beforeEach(() => {
	root = document.createElement("div");
	vi.useFakeTimers();
	vi.setSystemTime(new Date(2026, 9, 25, 10)); // not the shown day, so "so far" is off by default
});
afterEach(() => vi.useRealTimers());
const text = (sel: string): string => root.querySelector(sel)?.textContent ?? "";
const noop = (): void => undefined;

describe("steps card", () => {
	/** The 7 days before END average 10,000 steps, END itself has `today`. */
	const steps = (today: number | null, extra: Record<string, unknown> = {}) =>
		indexOf((ago) => (ago === 0 ? (today === null ? null : { steps: today, ...extra }) : { steps: 10_000, ...extra }));

	it("sets the zone from the 7-day average to 10 % above it and says how far the top is", async () => {
		const model = computeSteps(await steps(9742), END);
		expect(model.base).toBe(10_000);
		renderSteps(root, model, "en", false, noop);
		expect(text(".ghs-card-value")).toBe("9,742");
		expect(Array.from(root.querySelectorAll(".ghs-tick-label")).map((e) => e.textContent)).toEqual(["10.0k", "11.0k"]);
		// 11,000 - 9,742 = 1,258 steps = 13 minutes at 100 steps/min
		expect(text(".ghs-foot-value")).toBe("1,258 · 13 min walk");
		expect(root.querySelector(".ghs-foot-good")).toBeNull(); // a quantity is not good news
		expect(text(".ghs-foot-label")).toBe(en.panelToTopOfZone);
		expect(root.querySelector(".ghs-dot-warn")).not.toBeNull();
	});

	it("places the dot on a bar that spans 0 to 1.6 times the usual", async () => {
		renderSteps(root, computeSteps(await steps(8000), END), "en", false, noop);
		expect((root.querySelector(".ghs-dot") as HTMLElement).style.getPropertyValue("--ghs-x")).toBe("50%");
		root.empty();
		renderSteps(root, computeSteps(await steps(30_000), END), "en", false, noop);
		expect((root.querySelector(".ghs-dot") as HTMLElement).style.getPropertyValue("--ghs-x")).toBe("100%");
	});

	it("says the zone is done, and never warns, above it", async () => {
		renderSteps(root, computeSteps(await steps(12_500), END), "en", false, noop);
		expect(text(".ghs-foot-value")).toBe(en.panelZoneDone);
		expect(root.querySelector(".ghs-foot-good")).not.toBeNull();
		expect(root.querySelector(".ghs-dot-ok")).not.toBeNull();
	});

	it("says so far while the shown day is today", async () => {
		vi.setSystemTime(new Date(2026, 9, 22, 10));
		renderSteps(root, computeSteps(await steps(5000), END), "en", false, noop);
		expect(text(".ghs-foot-label")).toBe(en.panelToTopOfZoneSoFar);
	});

	it("shows distance, active calories with their difference to the usual, and total calories", async () => {
		const index = await indexOf((ago) => ({ steps: 10_000, distance_km: 7.2, calories_active: ago === 0 ? 583 : 610, calories_total: 2410 }));
		renderSteps(root, computeSteps(index, END), "en", false, noop);
		const chips = Array.from(root.querySelectorAll(".ghs-chip")).map((c) => c.textContent);
		expect(chips).toEqual(["Distance7.2 km", "Active583 −27", "Total kcal2,410"]);
		expect(root.querySelector(".ghs-chip-delta-down")).not.toBeNull();
	});

	it("marks a rise against the usual and hides a difference that rounds to zero", async () => {
		const up = await indexOf((ago) => ({ steps: 10_000, calories_active: ago === 0 ? 650 : 610 }));
		renderSteps(root, computeSteps(up, END), "en", false, noop);
		expect(root.querySelector(".ghs-chip-delta-up")?.textContent).toBe(" +40");
		root.empty();
		const same = await indexOf(() => ({ steps: 10_000, calories_active: 610 }));
		renderSteps(root, computeSteps(same, END), "en", false, noop);
		expect(root.querySelector(".ghs-chip-delta")).toBeNull();
	});

	it("shows active calories without a difference while there is no usual to compare with", async () => {
		const index = await indexOf((ago) => (ago === 0 ? { steps: 10_000, calories_active: 500 } : { steps: 10_000 }));
		renderSteps(root, computeSteps(index, END), "en", false, noop);
		expect(text(".ghs-chip-value")).toBe("500");
	});

	it("reads miles from notes written with imperial units", async () => {
		const index = await indexOf(() => ({ steps: 10_000, distance_mi: 4.5 }));
		renderSteps(root, computeSteps(index, END), "en", false, noop);
		expect(text(".ghs-chip-value")).toBe("4.5 mi");
	});

	it("omits the chips when the notes have none of them", async () => {
		renderSteps(root, computeSteps(await steps(9000), END), "en", false, noop);
		expect(root.querySelector(".ghs-chips")).toBeNull();
	});

	it("says there is no reading but keeps the card when the day has no steps", async () => {
		renderSteps(root, computeSteps(await steps(null), END), "en", false, noop);
		expect(text(".ghs-card-value")).toBe(en.panelNoReading);
		expect(root.querySelector(".ghs-dot")).toBeNull();
	});

	it("is locked until 5 of the last 7 days have steps", async () => {
		const index = await indexOf((ago) => (ago >= 1 && ago <= 4 ? { steps: 9000 } : ago === 0 ? { steps: 5000 } : null));
		renderSteps(root, computeSteps(index, END), "en", false, noop);
		expect(text(".ghs-card-note")).toBe("Unlocks after 5 days of data · 4 so far");
		expect(root.querySelector(".ghs-range")).toBeNull();
	});

	it("speaks the plugin language and shows the explanation", async () => {
		renderSteps(root, computeSteps(await steps(9742, { distance_km: 7.2 }), END), "de", true, noop);
		expect(text(".ghs-foot-value")).toBe("1.258 · 13 Min. Gehen");
		expect(text(".ghs-explain")).toBe(de.panelStepsExplain);
		expect(text(".ghs-chip-label")).toBe(de.panelDistance);
	});

	it("writes thousands as plain numbers below 1000", async () => {
		const index = await indexOf(() => ({ steps: 400 }));
		renderSteps(root, computeSteps(index, END), "en", false, noop);
		expect(Array.from(root.querySelectorAll(".ghs-tick-label")).map((e) => e.textContent)).toEqual(["400", "440"]);
	});
});

describe("intensity minutes card", () => {
	// Monday 19th .. Thursday 22nd
	const week = (m: (number | null)[]) => indexOf((ago) => (m[3 - ago] === null || m[3 - ago] === undefined ? null : { intensity_min: m[3 - ago] }), 4);

	it("lays out the week Monday to Sunday with the days still to come as placeholders", async () => {
		renderIntensity(root, computeIntensity(await week([20, 30, 40, 28]), END), "en", false, noop);
		expect(Array.from(root.querySelectorAll(".ghs-night-day")).map((e) => e.textContent)).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
		expect(root.querySelectorAll(".ghs-week-bar-future")).toHaveLength(3);
		expect(root.querySelectorAll(".ghs-night-bar-last")).toHaveLength(1);
		expect(text(".ghs-card-value")).toBe("118 / 150 wk");
	});

	it("shows what is left and spreads it over the days to come", async () => {
		renderIntensity(root, computeIntensity(await week([20, 30, 40, 28]), END), "en", false, noop);
		// 150 - 118 = 32 over Fri, Sat, Sun = 11 a day
		expect(text(".ghs-foot-value")).toBe("32 min · 11/day");
		expect(text(".ghs-foot-label")).toBe(en.panelToWeeklyGoal);
		// the placeholders are as tall as the daily need, relative to the tallest day
		const future = root.querySelector(".ghs-week-bar-future") as HTMLElement;
		expect(future.style.getPropertyValue("--ghs-h")).toBe(`${(11 / 40) * 100}%`);
	});

	it("says the goal is reached", async () => {
		renderIntensity(root, computeIntensity(await week([60, 60, 40, 0]), END), "en", false, noop);
		expect(text(".ghs-foot-value")).toBe(en.panelGoalReached);
		expect(root.querySelector(".ghs-foot-good")).not.toBeNull();
	});

	it("on the last day of the week, gives the minutes left without a per-day figure", async () => {
		const sunday = "2026-10-25";
		const app = new App();
		await seedHistory(app, { end: sunday, days: 7, frontmatter: () => ({ intensity_min: 10 }) });
		const model = computeIntensity(new DayIndex(app as never, () => settings), sunday);
		expect(model.perDay).toBeNull();
		renderIntensity(root, model, "en", false, noop);
		expect(text(".ghs-foot-value")).toBe("80 min");
		expect(root.querySelector(".ghs-week-bar-future")).toBeNull();
	});

	it("has no reading, but still the plan, when no day of the week has data", async () => {
		const index = await indexOf(() => null, 1);
		const model = computeIntensity(index, END);
		expect(model.total).toBeNull();
		renderIntensity(root, model, "en", false, noop);
		expect(text(".ghs-card-value")).toBe(en.panelNoReading);
		expect(root.querySelectorAll(".ghs-night-bar-missing")).toHaveLength(4);
	});

	it("keeps 150 when the previous weeks are below it, and says nothing about a personal goal", async () => {
		const index = await indexOf(() => ({ intensity_min: 10 }), 35); // 70 a week
		const model = computeIntensity(index, END);
		expect(model.goal).toBe(150);
		expect(model.goalWeeks).toBe(0);
		renderIntensity(root, model, "en", false, noop);
		expect(text(".ghs-card-value")).toBe("40 / 150 wk");
		expect(root.querySelector(".ghs-card-note")).toBeNull();
	});

	it("raises the goal to a little above the average of a sportier person, in steps of 5, with no upper limit", async () => {
		// 49 minutes a day = 343 a week; +10 % = 377.3 -> 380
		const index = await indexOf(() => ({ intensity_min: 49 }), 35);
		const model = computeIntensity(index, END);
		expect(model.goal).toBe(380);
		expect(model.goalWeeks).toBe(4);
		renderIntensity(root, model, "en", false, noop);
		expect(text(".ghs-card-value")).toBe("196 / 380 wk");
		// 380 - 196 = 184 over Fri, Sat, Sun = 62 a day
		expect(text(".ghs-foot-value")).toBe("184 min · 62/day");
		expect(text(".ghs-card-note")).toBe("Your goal is set a little above your own average of the last 4 weeks, because you already do more than 150 minutes.");
	});

	it("reaches the goal at the personal level and scales the bars to it", async () => {
		const index = await indexOf((ago) => ({ intensity_min: ago < 4 ? 100 : 49 }), 35);
		const model = computeIntensity(index, END);
		expect(model.total).toBe(400);
		expect(model.remaining).toBe(0);
		renderIntensity(root, model, "en", false, noop);
		expect(text(".ghs-foot-value")).toBe(en.panelGoalReached);
	});

	it("starts at 420 minutes (60 a day) for someone under 18, and moves up from there", async () => {
		const index = await indexOf(() => ({ intensity_min: 10 }), 35);
		const teen = computeIntensity(index, END, 2026 - 15);
		expect(teen.youth).toBe(true);
		expect(teen.goal).toBe(420);
		expect(teen.goalWeeks).toBe(0);
		renderIntensity(root, teen, "en", true, noop);
		expect(text(".ghs-card-value")).toBe("40 / 420 wk");
		expect(text(".ghs-explain")).toBe(en.panelIntensityExplainYouth);
		expect(computeIntensity(index, END, 2026 - 18).youth).toBe(false);
		expect(computeIntensity(index, END, 2026 - 18).goal).toBe(150);
		expect(computeIntensity(index, END, null).youth).toBe(false);
	});

	it("personalises a young person's goal against 420, not 150", async () => {
		const index = await indexOf(() => ({ intensity_min: 80 }), 35); // 560 a week
		const teen = computeIntensity(index, END, 2026 - 15);
		expect(teen.goal).toBe(620);
		root.empty();
		renderIntensity(root, teen, "en", false, noop);
		expect(text(".ghs-card-note")).toBe(en.panelIntensityGoalPersonalYouth.replace("{n}", "4"));
	});

	it("speaks the plugin language and shows the explanation", async () => {
		renderIntensity(root, computeIntensity(await week([20, 30, 40, 28]), END), "de", true, noop);
		expect(text(".ghs-foot-value")).toBe("32 Min. · 11/Tag");
		expect(text(".ghs-explain")).toBe(de.panelIntensityExplain);
	});
});

describe("floors card", () => {
	/** The 7 days before END have 9, 10 and 11 floors in turn, END has `today`. */
	const floors = (today: number | null) => indexOf((ago) => (ago === 0 ? (today === null ? null : { floors: today }) : { floors: 9 + (ago % 3) }));

	it("sets a zone in whole floors and draws filled, zone and empty blocks", async () => {
		const model = computeFloors(await floors(8), END);
		// 7 days: 10, 11, 9, 10, 11, 9, 10 -> mean 10 -> zone 10..11
		expect(model.zone).toEqual({ low: 10, high: 11 });
		renderFloors(root, model, "en", false, noop);
		const blocks = Array.from(root.querySelectorAll(".ghs-block"));
		expect(blocks).toHaveLength(14);
		expect(root.querySelectorAll(".ghs-block-filled")).toHaveLength(8);
		expect(root.querySelectorAll(".ghs-block-zone")).toHaveLength(3);
		expect(text(".ghs-foot-value")).toBe("Floors to go: 2–3");
		expect(text(".ghs-foot-label")).toBe(en.panelToYourZone);
	});

	it("gives a single number when only one floor is left to the zone", async () => {
		renderFloors(root, computeFloors(await floors(10), END), "en", false, noop);
		expect(text(".ghs-foot-value")).toBe("Floors to go: 1");
	});

	it("says the zone is done at or above its top", async () => {
		renderFloors(root, computeFloors(await floors(12), END), "en", false, noop);
		expect(text(".ghs-foot-value")).toBe(en.panelZoneDone);
		expect(root.querySelectorAll(".ghs-block-filled")).toHaveLength(12);
	});

	it("adds blocks when the day goes past 14 floors", async () => {
		renderFloors(root, computeFloors(await floors(20), END), "en", false, noop);
		expect(root.querySelectorAll(".ghs-block")).toHaveLength(20);
	});

	it("keeps the zone at least one floor wide for a low average", async () => {
		const index = await indexOf(() => ({ floors: 2 }));
		expect(computeFloors(index, END).zone).toEqual({ low: 2, high: 2 });
	});

	it("has no reading without a value for the day", async () => {
		renderFloors(root, computeFloors(await floors(null), END), "en", false, noop);
		expect(text(".ghs-card-value")).toBe(en.panelNoReading);
		expect(root.querySelector(".ghs-blocks")).toBeNull();
	});

	it("is locked until 5 of the last 7 days have floors", async () => {
		const index = await indexOf((ago) => (ago >= 1 && ago <= 3 ? { floors: 9 } : ago === 0 ? { floors: 5 } : null));
		renderFloors(root, computeFloors(index, END), "en", false, noop);
		expect(text(".ghs-card-note")).toBe("Unlocks after 5 days of data · 3 so far");
	});

	it("speaks the plugin language and shows the explanation", async () => {
		renderFloors(root, computeFloors(await floors(8), END), "de", true, noop);
		expect(text(".ghs-foot-value")).toBe("Etagen bis zur Zone: 2–3");
		expect(text(".ghs-explain")).toBe(de.panelFloorsExplain);
	});
});
