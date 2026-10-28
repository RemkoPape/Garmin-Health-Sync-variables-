// Why it matters: the hydration card tells the user how far the day's water is from the goal and may name low
// intake as a possible cause of a low HRV or a high resting heart rate. A wrong amount or a false cause is a
// wrong nudge, so the maths, the pace of the day and the combinations are pinned here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { Signals } from "../src/panel/insights/signals";
import { computeHydration, dayFraction, hydrationShare, litres, renderHydration } from "../src/panel/cards/hydration-card";
import { dryYesterday, hydrationInsights } from "../src/panel/insights/hydration";
import { hrvInsights, restingHrInsights } from "../src/panel/insights/recovery";
import { PANEL_CARDS } from "../src/panel/cards";
import { INSIGHTS, insightText, type Insight } from "../src/panel/insights/registry";
import { en } from "../src/i18n/en";

const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };
const END = "2026-10-22"; // a Thursday
type Fm = Record<string, unknown>;
const noop = (): void => undefined;

async function indexOf(fm: (ago: number) => Fm | null, days = 31): Promise<DayIndex> {
	const app = new App();
	await seedHistory(app, { end: END, days, frontmatter: fm });
	return new DayIndex(app as never, () => settings);
}
const signals = async (fm: (ago: number) => Fm | null, days = 31): Promise<Signals> => new Signals(await indexOf(fm, days), END, null);
const ids = (list: Insight[]): string[] => list.map((i) => i.id);
/** Water logged `intake` ml on the shown day and `before` ml on the days before it; goal 2500 when given. */
const water = (intake: number | null, before = 2400, goal: number | null = 2500) => (ago: number): Fm => ({
	...(ago === 0 ? (intake === null ? {} : { hydration_ml: intake }) : { hydration_ml: before }),
	...(goal === null ? {} : { hydration_goal_ml: goal }),
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const at = (hour: number, date = END): void => void vi.setSystemTime(new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`));

describe("the pace of the day", () => {
	it("runs from 7:00 to 22:00", () => {
		expect(dayFraction(new Date(2026, 9, 22, 5, 0))).toBe(0);
		expect(dayFraction(new Date(2026, 9, 22, 14, 30))).toBeCloseTo(0.5);
		expect(dayFraction(new Date(2026, 9, 22, 23, 0))).toBe(1);
	});
});

describe("computeHydration", () => {
	it("takes the goal of the day, else the average goal of the week before, and the usual intake", async () => {
		at(15);
		const m = computeHydration(await indexOf(water(1000)), END);
		expect(m).toMatchObject({ intake: 1000, goal: 2500, usual: 2400, today: true });
		expect(m.pace).toBeCloseTo(2500 * (8 / 15));
		const noGoalToday = computeHydration(await indexOf((ago) => (ago === 0 ? { hydration_ml: 1000 } : { hydration_ml: 2400, hydration_goal_ml: 2000 })), END);
		expect(noGoalToday.goal).toBe(2000);
	});

	it("has no pace for a past day and no goal without one", async () => {
		at(15, "2026-10-25");
		const m = computeHydration(await indexOf(water(1000, 2400, null)), END);
		expect(m).toMatchObject({ goal: null, today: false, pace: null });
	});

	it("scores a day against its goal, else against the usual intake", async () => {
		const index = await indexOf(water(1250));
		expect(hydrationShare(index, END)).toBe(0.5);
		expect(hydrationShare(await indexOf(water(1200, 2400, null)), END)).toBe(0.5);
		expect(hydrationShare(await indexOf(water(null)), END)).toBeNull();
		// no goal and too few days before for a usual intake
		expect(hydrationShare(await indexOf(water(500, 2400, null), 2), END)).toBeNull();
	});
});

describe("the hydration card", () => {
	let root: HTMLElement;
	beforeEach(() => {
		root = document.createElement("div");
	});
	const text = (sel: string): string => root.querySelector(sel)?.textContent ?? "";
	const render = async (fm: (ago: number) => Fm | null, open = false): Promise<void> => {
		root.empty();
		renderHydration(root, { ...computeHydration(await indexOf(fm), END), insights: [] }, "en", open, noop);
	};

	it("shows litres, the goal mark and what is left in litres and glasses", async () => {
		at(15, "2026-10-25");
		await render(water(1800));
		expect(text(".ghs-card-title")).toBe("Hydration");
		expect(text(".ghs-card-value")).toBe("1.8 L");
		expect(text(".ghs-tick-label")).toBe("Goal 2.5 L");
		expect(text(".ghs-foot-label")).toBe(en.panelHydrationFoot);
		expect(text(".ghs-foot-value")).toBe("0.7 L · 3 × 250 ml");
	});

	it("says so when the goal is reached and counts the day so far for today", async () => {
		at(15);
		await render(water(2600));
		expect(text(".ghs-foot-value")).toBe(en.panelHydrationDone);
		expect(root.querySelector(".ghs-foot-good")).not.toBeNull();
		expect(text(".ghs-foot-label")).toBe(en.panelHydrationFootToday);
	});

	it("falls back to the usual intake as the mark when there is no goal, and then has no amount left", async () => {
		await render(water(1800, 2400, null));
		expect(text(".ghs-tick-label")).toBe("Usual 2.4 L");
		expect(root.querySelector(".ghs-foot")).toBeNull();
	});

	it("shows no bar without a reading or without anything to compare with", async () => {
		await render(water(null));
		expect(root.querySelector(".ghs-card-empty")).not.toBeNull();
		expect(root.querySelector(".ghs-weekly")).toBeNull();
		await render((ago) => (ago === 0 ? { hydration_ml: 1500 } : null));
		expect(text(".ghs-card-value")).toBe("1.5 L");
		expect(root.querySelector(".ghs-weekly")).toBeNull();
	});

	it("lists the year and the trend in litres under the light bulb", async () => {
		at(15, "2026-10-25");
		const idx = await indexOf((ago) => ({ hydration_ml: ago === 0 ? 3000 : 2000 + (ago % 5) * 100, hydration_goal_ml: 2500 }), 120);
		root.empty();
		renderHydration(root, { ...computeHydration(idx, END), insights: [] }, "en", true, noop);
		expect(text(".ghs-fact")).toContain(" L");
		expect(root.querySelector(".ghs-trend")?.textContent ?? "").toContain(" L");
	});

	it("formats litres in the plugin language", () => {
		expect(litres(2500, "de")).toBe("2,5 L");
	});

	it("is a switchable, reorderable card of the energy section that needs the intake", () => {
		const card = PANEL_CARDS.find((c) => c.id === "hydration")!;
		expect(card).toMatchObject({ section: "energy", metrics: ["hydration_ml"], extra: ["hydration_goal_ml"], needs: "panelNeedsHydration" });
	});
});

describe("hydration interpretations", () => {
	it("has nothing to say without a logged intake", async () => {
		at(15);
		expect(hydrationInsights(await signals(water(null)))).toEqual([]);
	});

	it("confirms a reached goal", async () => {
		at(15);
		expect(ids(hydrationInsights(await signals(water(2600))))).toEqual(["hydration_goal_good"]);
	});

	it("judges today against the pace of the day", async () => {
		at(15); // 53 % of the day: 1330 ml are due
		expect(ids(hydrationInsights(await signals(water(1200))))).toEqual(["hydration_on_pace"]);
		const behind = hydrationInsights(await signals(water(800)));
		expect(behind).toEqual([{ id: "hydration_behind_pace", params: { ml: "1700", glasses: "7" } }]);
		expect(insightText(behind[0]!, "en")).toContain("1700 ml, or 7 glasses");
		at(10); // before noon nobody is behind
		expect(ids(hydrationInsights(await signals(water(100))))).toEqual(["hydration_on_pace"]);
	});

	it("says how much of the goal a past day reached", async () => {
		at(15, "2026-10-25");
		expect(hydrationInsights(await signals(water(1250)))).toEqual([{ id: "hydration_below_goal", params: { pct: "50" } }]);
	});

	it("stays silent about the goal without one", async () => {
		at(15, "2026-10-25");
		expect(hydrationInsights(await signals(water(1200, 2400, null)))).toEqual([]);
	});

	it("points out a streak of dry days, counting only days that were logged", async () => {
		at(15, "2026-10-25");
		const dry = (ago: number): Fm => ({ hydration_goal_ml: 2500, hydration_ml: ago === 0 ? 2600 : ago <= 3 ? 1500 : 2400 });
		expect(ids(hydrationInsights(await signals(dry)))).toEqual(["hydration_goal_good", "hydration_low_streak"]);
		const twoDry = (ago: number): Fm => ({ hydration_goal_ml: 2500, hydration_ml: ago === 0 ? 2600 : ago <= 2 ? 1500 : 2400 });
		expect(ids(hydrationInsights(await signals(twoDry)))).toEqual(["hydration_goal_good"]);
	});

	it("does not count a day without a log as a dry one", async () => {
		at(15, "2026-10-25");
		const gaps = (ago: number): Fm | null => (ago === 0 ? { hydration_goal_ml: 2500, hydration_ml: 2600 } : ago <= 3 ? { hydration_goal_ml: 2500 } : { hydration_goal_ml: 2500, hydration_ml: 2400 });
		expect(ids(hydrationInsights(await signals(gaps)))).toEqual(["hydration_goal_good"]);
	});

	it("has a text and a kind for every id", () => {
		for (const id of ["hydration_goal_good", "hydration_on_pace", "hydration_behind_pace", "hydration_below_goal", "hydration_low_streak", "hrv_low_hydration", "rhr_high_hydration"] as const) {
			expect(INSIGHTS[id].kind).toBeTruthy();
			expect(insightText({ id, params: { ml: "1", glasses: "1", pct: "1", n: "3" } }, "en")).not.toMatch(/\{/);
		}
	});
});

describe("hydration next to other cards", () => {
	/** HRV 62/58 before the shown day (mean 60, sd 2), `hrv` on it; resting heart rate 50/54 (mean 52, sd 2), `rhr` on it; water `yesterday` ml with goal 2500 the day before. */
	const day = (hrv: number, rhr: number, yesterday: number | null) => (ago: number): Fm => ({
		hrv: ago === 0 ? hrv : ago % 2 === 0 ? 62 : 58,
		resting_hr: ago === 0 ? rhr : ago % 2 === 0 ? 50 : 54,
		hydration_goal_ml: 2500,
		...(ago === 1 ? (yesterday === null ? {} : { hydration_ml: yesterday }) : ago === 0 ? {} : { hydration_ml: 2400 }),
	});

	it("names yesterday's dry day as a possible cause of a low HRV", async () => {
		expect(ids(hrvInsights(await signals(day(54, 52, 1500))))).toEqual(["hrv_low_hydration"]);
	});

	it("names it for a high resting heart rate too", async () => {
		expect(ids(restingHrInsights(await signals(day(60, 58, 1500))))).toEqual(["rhr_high_hydration"]);
	});

	it("does not, when yesterday was fine or was not logged", async () => {
		expect(ids(hrvInsights(await signals(day(54, 52, 2400))))).not.toContain("hrv_low_hydration");
		expect(ids(restingHrInsights(await signals(day(60, 58, null))))).toEqual(["unexplained"]);
		expect(dryYesterday(await signals(day(54, 52, null)))).toBe(false);
	});
});
