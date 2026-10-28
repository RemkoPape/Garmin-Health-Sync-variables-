// Why it matters: the panel gets thin, sparse, mixed data: a new watch, a history that starts last week, notes
// and history files in different units, an unfinished day. These are the edges where a card could show a
// confident number, a NaN bar or a false alarm, so each one is pinned here.
import { describe, expect, it, vi } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { serializeMonth } from "../src/history/format";
import { DayIndex } from "../src/panel/index";
import { HistoryStore } from "../src/history/store";
import { computeLoad } from "../src/panel/cards/load-card";
import { computeSteps } from "../src/panel/cards/steps-card";
import { computeFloors } from "../src/panel/cards/floors-card";
import { computeStages } from "../src/panel/cards/stages-card";
import { computeBody } from "../src/panel/cards/body-card";
import { renderToday, computeToday } from "../src/panel/cards/today-card";
import { bodyInsights, floorsInsights, stepsInsights } from "../src/panel/insights/activity";
import { Signals } from "../src/panel/insights/signals";
import { computeTrend } from "../src/panel/trend";
import { en } from "../src/i18n/en";
import { PANEL_CARDS } from "../src/panel/cards";

const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };
const END = "2026-10-22"; // a Thursday
const run = { type: "running", category: "running", duration_min: 30, avg_hr: 140 };

async function indexOf(frontmatter: (ago: number) => Record<string, unknown> | null, days: number): Promise<DayIndex> {
	const app = new App();
	await seedHistory(app, { end: END, days, frontmatter });
	return new DayIndex(app as never, () => settings);
}

describe("the load ratio rests on the days that are known", () => {
	it("is not shown with fewer than 14 days of notes in the 28", async () => {
		const index = await indexOf((ago) => ({ trainings: [run] }), 10);
		expect(computeLoad(index, END).ratio).toBeNull();
	});

	it("takes the average of the weeks that exist, not of four weeks: even training reads as 1.0 after two weeks", async () => {
		const index = await indexOf(() => ({ trainings: [run] }), 14);
		expect(computeLoad(index, END).ratio).toBeCloseTo(1, 5);
	});

	it("reads a week that doubles after two even weeks as a build, not as the overreach of a young history", async () => {
		const index = await indexOf((ago) => ({ trainings: ago < 7 ? [run, run] : [run] }), 14);
		const ratio = computeLoad(index, END).ratio!;
		expect(ratio).toBeCloseTo(7 * 2 / ((7 * 2 + 7) / 2), 5);
		expect(ratio).toBeLessThan(1.5);
	});
});

describe("a trend that did not move", () => {
	it("is steady when both weeks are zero, not a fall", () => {
		const t = computeTrend(() => 0, END)!;
		expect(t.direction).toBe("steady");
	});
});

describe("an empty property in a note", () => {
	it("leaves the value of the history record visible", async () => {
		const app = new App();
		await seedHistory(app, { end: END, days: 1, frontmatter: () => ({ hrv: "", steps: null }) });
		app.vault.seed("Garmin history/Garmin history 2026-10.md", serializeMonth("2026-10", new Map([["2026-10-22", { hrv: 55, steps: 9000 }]])));
		const history = new HistoryStore(app as never, settings);
		await history.warm("2026-10-01", END);
		const index = new DayIndex(app as never, () => settings, history);
		expect(index.value("hrv", END)).toBe(55);
		expect(index.value("steps", END)).toBe(9000);
	});
});

describe("averages of zero", () => {
	it("give steps and floors no zone and the sleep stages no bars", async () => {
		const index = await indexOf((ago) => (ago === 0 ? { steps: 4000, floors: 3, sleep_deep: "0h 0min", sleep_rem: "0h 0min", sleep_light: "0h 0min", sleep_awake: "0h 0min" } : { steps: 0, floors: 0 }), 8);
		expect(computeSteps(index, END).base).toBeNull();
		expect(computeFloors(index, END).zone).toBeNull();
		expect(computeStages(index, END).stages).toBeNull();
	});
});

describe("an unfinished day is not set against whole days", () => {
	const quietWeek = (ago: number): Record<string, unknown> => (ago === 0 ? { steps: 1000, floors: 1 } : { steps: ago < 6 ? 3000 : 9000, floors: ago < 6 ? 2 : 12 });

	it("gives no 'below the usual' insight for today, but for a day that is over", async () => {
		const index = await indexOf(quietWeek, 14);
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date(2026, 9, 22, 10));
			expect(stepsInsights(new Signals(index, END, null)).map((i) => i.id)).toEqual([]);
			expect(floorsInsights(new Signals(index, END, null))).toEqual([]);
			vi.setSystemTime(new Date(2026, 9, 24, 10));
			expect(stepsInsights(new Signals(index, END, null)).map((i) => i.id)).toContain("steps_below_streak");
			expect(floorsInsights(new Signals(index, END, null)).map((i) => i.id)).toContain("floors_below_streak");
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("weights in two units", () => {
	it("are brought to the unit of the latest reading", async () => {
		const index = await indexOf((ago) => (ago >= 8 ? { weight_kg: 80 } : { weight_lbs: 176.4 }), 14);
		const body = computeBody(index, END);
		expect(body.unit).toBe("lbs");
		expect(body.points[0]!.y).toBeCloseTo(80 * 2.20462, 3);
		expect(body.points.at(-1)!.y).toBeCloseTo(176.4, 3);
		expect(Math.abs(body.perWeek ?? 0)).toBeLessThan(0.5);
	});

	it("convert the other way when the latest reading is in kilograms", async () => {
		const index = await indexOf((ago) => (ago >= 8 ? { weight_lbs: 176.4 } : { weight_kg: 80 }), 14);
		const body = computeBody(index, END);
		expect(body.unit).toBe("kg");
		expect(body.points[0]!.y).toBeCloseTo(176.4 / 2.20462, 3);
	});

	it("give no weekly change from readings less than a week apart", async () => {
		const index = await indexOf((ago) => (ago < 3 ? { weight_kg: 80 + ago * 3 } : null), 3);
		const body = computeBody(index, END);
		expect(body.entries).toBe(3);
		expect(body.perWeek).toBeNull();
		expect(body.fast).toBe(false);
	});
});

describe("the Today card without today's readings", () => {
	it("says it is waiting for them when the usual range is there, and counts days while it is not", async () => {
		const full = (ago: number): Record<string, unknown> => (ago === 0 ? { steps: 5 } : { hrv: 60 + (ago % 3), resting_hr: 50, sleep_duration: "7h 30min" });
		const index = await indexOf(full, 12);
		const model = computeToday(index, END, null);
		expect(model.score).toBeNull();
		const parent = document.createElement("div");
		renderToday(parent, model, "en", false, () => undefined);
		expect(parent.textContent).toContain(en.panelTodayWaiting);
		const young = await indexOf((ago) => ({ hrv: 60 + ago }), 2);
		const parent2 = document.createElement("div");
		renderToday(parent2, computeToday(young, END, null), "en", false, () => undefined);
		expect(parent2.textContent).toContain("so far");
	});
});

describe("body insights from two weigh-ins", () => {
	it("say nothing about a trend that two readings cannot show", async () => {
		const index = await indexOf((ago) => (ago === 0 || ago === 9 ? { weight_kg: 80 } : null), 10);
		const body = computeBody(index, END);
		expect(body.perWeek).not.toBeNull();
		expect(body.entries).toBe(2);
		expect(bodyInsights(new Signals(index, END, null))).toEqual([]);
	});
});

describe("work that is shared between the cards of one draw", () => {
	const context = (index: DayIndex) => ({ parent: document.createElement("div"), index, date: END, lang: "en", imperial: false, birthYear: null as number | null, explainOpen: false, onToggleExplain: () => undefined });

	it("reads the sessions of a day once, until the index is touched or invalidated", async () => {
		const app = new App();
		await seedHistory(app, { end: END, days: 2, frontmatter: () => ({ trainings: [run] }) });
		const index = new DayIndex(app as never, () => settings);
		const first = index.sessions(END);
		expect(index.sessions(END)).toBe(first);
		const version = index.version;
		index.touch();
		expect(index.version).toBe(version + 1);
		expect(index.sessions(END)).not.toBe(first);
		const second = index.sessions(END);
		index.invalidate();
		expect(index.version).toBe(version + 2);
		expect(index.sessions(END)).not.toBe(second);
	});

	it("works out the signals once for all the cards, and again after a change or for another day or birth year", async () => {
		const index = await indexOf(() => ({ hrv: 60, resting_hr: 50, sleep_duration: "7h 30min", trainings: [run] }), 40);
		const spy = vi.spyOn(Signals.prototype, "sleep");
		const draw = (c: ReturnType<typeof context>): number => {
			for (const card of PANEL_CARDS) card.render(c);
			return new Set(spy.mock.contexts).size;
		};
		// a few cards make signals of their own inside their model (the Today card); without the shared ones each of the 19 cards would
		const first = draw(context(index));
		expect(first).toBeLessThan(PANEL_CARDS.length / 2);
		const second = draw(context(index));
		expect(second - first).toBeLessThan(first);
		index.touch();
		const afterTouch = draw(context(index));
		expect(afterTouch).toBeGreaterThan(second);
		expect(draw({ ...context(index), birthYear: 1990 })).toBeGreaterThan(afterTouch);
		spy.mockRestore();
	});
});
