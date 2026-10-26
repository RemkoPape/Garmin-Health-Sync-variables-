// Why it matters: the sleep card gives an instruction for tonight. The debt arithmetic, the one-hour cap on
// catching up, the rounding to 15 minutes and the "not enough nights yet" state each decide what it says.
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { computeSleep, formatMinutes, renderSleep, SLEEP_MIN_NIGHTS } from "../src/panel/cards/sleep-card";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";

const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };
const END = "2026-10-22";
const dur = (m: number): string => `${Math.floor(m / 60)}h ${m % 60}min`;

/** `nights[0]` is the shown day, then one entry per earlier day; null = no note. */
async function indexOf(nights: (number | null)[], score?: number): Promise<DayIndex> {
	const app = new App();
	await seedHistory(app, {
		end: END,
		days: nights.length,
		frontmatter: (ago) => (nights[ago] === null || nights[ago] === undefined ? null : { sleep_duration: dur(nights[ago]!), ...(ago === 0 && score !== undefined ? { sleep_score: score } : {}) }),
	});
	return new DayIndex(app as never, () => settings);
}

describe("computeSleep", () => {
	it("sums the shortfall against 7 hours over the last 7 nights", async () => {
		// 6h, 6h30, 7h, 8h, 5h, 7h30, 6h45  ->  60 + 30 + 0 + 0 + 120 + 0 + 15
		const m = computeSleep(await indexOf([360, 390, 420, 480, 300, 450, 405]), END);
		expect(m.have).toBe(7);
		expect(m.debt).toBe(225);
		expect(m.minutes).toBe(360);
	});

	it("suggests the need plus a quarter of the debt, rounded down to 15 minutes", async () => {
		// debt 225 -> 56.25 -> 420 + 56.25 = 476.25 -> 465
		expect((computeSleep(await indexOf([360, 390, 420, 480, 300, 450, 405]), END)).target).toBe(465);
	});

	it("never asks for more than one extra hour", async () => {
		expect((computeSleep(await indexOf([0, 0, 0, 0, 0, 0, 0]), END)).target).toBe(480);
	});

	it("has no debt and suggests the plain need when every night was long enough", async () => {
		const m = computeSleep(await indexOf([480, 450, 420, 500, 430, 440, 460]), END);
		expect(m.debt).toBe(0);
		expect(m.target).toBe(420);
	});

	it("counts nights without data as unknown, not as zero", async () => {
		const m = computeSleep(await indexOf([360, null, 420, null, 400, 410, 430]), END);
		expect(m.have).toBe(5);
		expect(m.debt).toBe(60 + 20 + 10);
	});

	it("shows nothing before enough nights exist", async () => {
		const m = computeSleep(await indexOf([360, 360, 360, 360]), END);
		expect(m.have).toBe(SLEEP_MIN_NIGHTS - 1);
		expect(m.debt).toBeNull();
		expect(m.target).toBeNull();
	});

	it("only looks at seven nights", async () => {
		const m = computeSleep(await indexOf([420, 420, 420, 420, 420, 420, 420, 0, 0]), END);
		expect(m.debt).toBe(0);
	});

	it("reads the sleep score of the shown day", async () => {
		expect(computeSleep(await indexOf([420], 81), END).score).toBe(81);
		expect(computeSleep(await indexOf([420]), END).score).toBeNull();
	});
});

describe("formatMinutes", () => {
	it.each([[45, "45 min"], [60, "1 h"], [373, "6 h 13 min"], [465, "7 h 45 min"]])("formats %s", (m, text) => {
		expect(formatMinutes(m)).toBe(text);
	});
});

describe("renderSleep", () => {
	let root: HTMLElement;
	beforeEach(() => {
		root = document.createElement("div");
	});
	const notes = (): (string | null)[] => Array.from(root.querySelectorAll(".ghs-card-note")).map((n) => n.textContent);
	const render = (model: ReturnType<typeof computeSleep>, lang = "en", open = false): void => renderSleep(root, model, lang, open, () => undefined);

	it("shows last night, the debt, tonight's target and the score", async () => {
		render(computeSleep(await indexOf([360, 390, 420, 480, 300, 450, 405], 77), END));
		expect(root.querySelector(".ghs-card-title")?.textContent).toBe(en.panelSleepTitle);
		expect(root.querySelector(".ghs-card-value")?.textContent).toBe("6 h · 77");
		expect(notes()).toEqual(["Sleep debt, last 7 nights: 3 h 45 min"]);
		expect(root.querySelector(".ghs-card-action")?.textContent).toBe("Tonight: aim for 7 h 45 min");
		expect(root.querySelector(".ghs-card-warning")).toBeNull();
	});

	it("draws one bar per night, oldest first, with the shown night highlighted and the need as a line", async () => {
		render(computeSleep(await indexOf([360, 390, null, 480, 300, 450, 405]), END));
		const bars = Array.from(root.querySelectorAll<HTMLElement>(".ghs-night-bar"));
		expect(bars).toHaveLength(7);
		expect(bars[6]!.classList.contains("ghs-night-bar-last")).toBe(true);
		expect(bars[5]!.classList.contains("ghs-night-bar-last")).toBe(false);
		// the night 2 days before the shown day has no note: a thin placeholder, not a bar of height 0 min
		expect(bars[4]!.classList.contains("ghs-night-bar-missing")).toBe(true);
		// heights are relative to the tallest of (need * 1.2, longest night): 480 min is the tallest here
		expect(bars[3]!.style.getPropertyValue("--ghs-h")).toBe(`${(480 / 504) * 100}%`);
		expect(root.querySelector(".ghs-nights-need-label")?.textContent).toBe("7 h");
		expect((root.querySelector(".ghs-nights-need") as HTMLElement).style.getPropertyValue("--ghs-y")).toBe(`${(420 / 504) * 100}%`);
		expect(Array.from(root.querySelectorAll(".ghs-night-day")).map((e) => e.textContent)).toEqual(["F", "S", "S", "M", "T", "W", "T"]);
	});

	it("scales the bars to a night longer than the need", async () => {
		render(computeSleep(await indexOf([600, 420, 420, 420, 420, 420, 420]), END));
		const bars = Array.from(root.querySelectorAll<HTMLElement>(".ghs-night-bar"));
		expect(bars[6]!.style.getPropertyValue("--ghs-h")).toBe("100%");
	});

	it("says so when there is no debt", async () => {
		render(computeSleep(await indexOf([480, 450, 420, 500, 430, 440, 460]), END));
		expect(notes()).toEqual([en.panelSleepNoDebt]);
	});

	it("warns that the debt rests on fewer than seven nights", async () => {
		render(computeSleep(await indexOf([360, null, 420, null, 400, 410, 430]), END));
		expect(root.querySelector(".ghs-card-warning")?.textContent).toBe("Based on 5 of 7 nights.");
	});

	it("says how many nights are missing while locked", async () => {
		render(computeSleep(await indexOf([360, 360]), END));
		expect(notes()).toEqual(["Unlocks after 5 days of data · 2 so far"]);
		expect(root.querySelector(".ghs-card-action")).toBeNull();
	});

	it("says there is no reading for a day without sleep data, keeping the debt of the nights before", async () => {
		render(computeSleep(await indexOf([null, 360, 360, 360, 360, 360, 360]), END));
		expect(root.querySelector(".ghs-card-value")?.textContent).toBe(en.panelNoReading);
		expect(root.querySelector(".ghs-card-empty")).not.toBeNull();
	});

	it("speaks the plugin language and shows the explanation when open", async () => {
		render(computeSleep(await indexOf([480, 450, 420, 500, 430, 440, 460]), END), "de", true);
		expect(notes()).toEqual([de.panelSleepNoDebt]);
		expect(root.querySelector(".ghs-explain")?.textContent).toBe(de.panelSleepExplain);
	});
});
