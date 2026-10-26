// Why it matters: the sleep card gives an instruction for tonight. The debt arithmetic, the one-hour cap on
// catching up, the rounding to 15 minutes and the "not enough nights yet" state each decide what it says.
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { computeSleep, formatClock, formatMinutes, renderSleep, SLEEP_MIN_NIGHTS, SLEEP_MIN_TIMED_NIGHTS } from "../src/panel/cards/sleep-card";
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

describe("sleep timeline (nights with bedtime and wake-up time)", () => {
	let root: HTMLElement;
	beforeEach(() => {
		root = document.createElement("div");
	});
	/** Every night 23:00 to 06:30 (450 min in bed) with `asleep(ago)` minutes asleep; `times(ago)` overrides the clock times. */
	async function timed(asleep: (ago: number) => number | null, times: (ago: number) => { start?: string; end?: string } | null = () => ({ start: "23:00", end: "06:30" })): Promise<DayIndex> {
		const app = new App();
		await seedHistory(app, {
			end: END,
			days: 7,
			frontmatter: (ago) => {
				const m = asleep(ago);
				const c = times(ago);
				return { ...(m === null ? {} : { sleep_duration: dur(m) }), ...(c?.start ? { sleep_start: c.start } : {}), ...(c?.end ? { sleep_end: c.end } : {}) };
			},
		});
		return new DayIndex(app as never, () => settings);
	}
	const render = (model: ReturnType<typeof computeSleep>, lang = "en", open = false): void => renderSleep(root, model, lang, open, () => undefined);
	const text = (sel: string): string => root.querySelector(sel)?.textContent ?? "";

	it("formats clock times", () => {
		expect(formatClock(0)).toBe("00:00");
		expect(formatClock(1395)).toBe("23:15");
		expect(formatClock(1860)).toBe("07:00");
	});

	it("switches from the duration bars to the timeline once 3 nights have times", async () => {
		const few = await timed(() => 420, (ago) => (ago < SLEEP_MIN_TIMED_NIGHTS - 1 ? { start: "23:00", end: "06:30" } : null));
		render(computeSleep(few, END));
		expect(root.querySelector(".ghs-nights-timeline")).toBeNull();
		expect(root.querySelector(".ghs-nights-need-label")?.textContent).toBe("7 h");
		root.empty();
		render(computeSleep(await timed(() => 420, (ago) => (ago < SLEEP_MIN_TIMED_NIGHTS ? { start: "23:00", end: "06:30" } : null)), END));
		expect(root.querySelector(".ghs-nights-timeline")).not.toBeNull();
		expect(root.querySelector(".ghs-nights-need-label")).toBeNull();
	});

	it("needs both a bedtime and a wake-up time for a night", async () => {
		const model = computeSleep(await timed(() => 420, (ago) => (ago % 2 ? { start: "23:00" } : { end: "06:30" })), END);
		expect(model.schedule).toBeNull();
		expect(model.nights.every((n) => n.bed === null && n.span === null)).toBe(true);
	});

	it("places each night on a clock that runs downwards with the need as a dashed box from bedtime", async () => {
		const model = computeSleep(await timed((ago) => (ago === 0 ? 360 : 450)), END);
		render(model);
		// bedtime 23:00 = 1380, up at 06:30: 450 min in bed; axis from 22:00 to 07:00 (540 min)
		expect(text(".ghs-axis-top")).toBe("22:00");
		expect(text(".ghs-axis-bottom")).toBe("07:00");
		const css = (el: Element | null, prop: string): string => (el as HTMLElement).style.getPropertyValue(prop);
		const last = root.querySelectorAll(".ghs-night")[6]!;
		expect(css(last.querySelector(".ghs-night-window"), "--ghs-y")).toBe(`${(60 / 540) * 100}%`);
		expect(css(last.querySelector(".ghs-night-window"), "--ghs-h")).toBe(`${(450 / 540) * 100}%`);
		expect(css(last.querySelector(".ghs-night-need"), "--ghs-h")).toBe(`${(420 / 540) * 100}%`);
		// the shown night slept 6 h: its solid bar is shorter than the dashed need box
		expect(css(last.querySelector(".ghs-night-asleep"), "--ghs-h")).toBe(`${(360 / 540) * 100}%`);
		expect(last.querySelector(".ghs-night-asleep-last")).not.toBeNull();
		expect(root.querySelectorAll(".ghs-night-asleep-last")).toHaveLength(1);
		const first = root.querySelectorAll(".ghs-night")[0]!;
		expect(css(first.querySelector(".ghs-night-asleep"), "--ghs-h")).toBe(`${(450 / 540) * 100}%`);
	});

	it("draws a night without times as an empty column and a night without duration as time in bed", async () => {
		const model = computeSleep(await timed((ago) => (ago === 3 ? null : 420), (ago) => (ago === 5 ? null : { start: "23:00", end: "06:30" })), END);
		render(model);
		const cols = Array.from(root.querySelectorAll(".ghs-night"));
		expect(cols[1]!.querySelector(".ghs-night-window")).toBeNull();
		expect(cols[1]!.querySelector(".ghs-night-day")).not.toBeNull();
		expect((cols[3]!.querySelector(".ghs-night-asleep") as HTMLElement).style.getPropertyValue("--ghs-h")).toBe(`${(450 / 540) * 100}%`);
	});

	it("counts a bedtime after midnight as later, not earlier", async () => {
		// 4 nights at 23:00, 3 at 00:30 (90 minutes later)
		const model = computeSleep(await timed(() => 420, (ago) => (ago % 2 ? { start: "00:30", end: "08:00" } : { start: "23:00", end: "06:30" })), END);
		expect(model.nights.find((n) => n.bed === 1470)).toBeDefined();
		render(model);
		// 4 nights at 23:00 and 3 at 00:30 -> 23:39; read as 00:30 = 06:30 earlier it would be 20:00-ish
		expect(Array.from(root.querySelectorAll(".ghs-card-note")).map((e) => e.textContent).join("|")).toContain("Bedtime 23:39 ±");
	});

	it("shows the average bedtime and wake-up time with how much they vary", async () => {
		render(computeSleep(await timed(() => 420), END));
		expect(Array.from(root.querySelectorAll(".ghs-card-note")).map((e) => e.textContent)).toContain("Bedtime 23:00 ±0 min · wake-up 06:30 ±0 min");
		root.empty();
		// 4 nights at 23:00 and 3 at 23:30 -> mean 23:13, sd 15
		render(computeSleep(await timed(() => 420, (ago) => ({ start: ago % 2 ? "23:30" : "23:00", end: "07:00" })), END));
		expect(Array.from(root.querySelectorAll(".ghs-card-note")).map((e) => e.textContent).join("|")).toContain("Bedtime 23:13 ±15 min");
	});

	it("explains the timeline only when it is shown, in the plugin language", async () => {
		render(computeSleep(await timed(() => 420), END), "de", true);
		expect(text(".ghs-explain")).toBe(`${de.panelSleepExplain} ${de.panelSleepExplainTimes}`);
		root.empty();
		render(computeSleep(await indexOf([420, 420, 420, 420, 420, 420, 420]), END), "en", true);
		expect(text(".ghs-explain")).toBe(en.panelSleepExplain);
	});
});
