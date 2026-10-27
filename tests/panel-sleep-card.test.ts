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

/** `len` nights of `other` minutes, except the nights that fall on the weekday of tonight (a Friday), which get `friday`. */
const series = (other: number, friday: number, len = 60): number[] => Array.from({ length: len }, (_, ago) => (ago % 7 === 6 ? friday : other));

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

	it("aims at what the coming weekday usually brings when that is less than the need, with a quarter of the debt on top", async () => {
		// Friday nights 5 h 30: held at the 6 h floor; the last Friday is 90 min short -> 6 h + 22.5 min -> 6 h 30
		const m = computeSleep(await indexOf(series(420, 330)), END);
		expect(m.weekday).toEqual({ date: "2026-10-23", typical: 330 });
		expect(m.floor).toBe(360);
		expect(m.target).toBe(390);
	});

	it("never aims below an hour under the need, however short the weekday nights are", async () => {
		const m = computeSleep(await indexOf(series(420, 270)), END);
		expect(m.weekday!.typical).toBe(270);
		expect(m.target).toBe(390);
		expect(computeSleep(await indexOf(series(300, 240)), END).target!).toBeGreaterThanOrEqual(360);
	});

	it("follows a weekday that lies between the floor and the need", async () => {
		expect(computeSleep(await indexOf(series(420, 400)), END).target).toBe(405);
	});

	it("never asks for more than the need on top of the catch-up when the weekday usually brings more", async () => {
		expect(computeSleep(await indexOf(series(420, 500)), END).target).toBe(420);
	});

	it("uses the upper quarter of the weekday's last 8 nights, so one bad Friday does not set the aim", async () => {
		const nights = series(420, 420);
		for (const ago of [6, 13, 20]) nights[ago] = 300;
		expect(computeSleep(await indexOf(nights), END).weekday!.typical).toBe(420);
	});

	it("falls back to the need plus a quarter of the debt with fewer than 3 nights of that weekday", async () => {
		const m = computeSleep(await indexOf(series(420, 330, 20)), END); // Fridays at ago 6 and 13 only
		expect(m.weekday).toBeNull();
		expect(m.target).toBe(420 + Math.floor((90 / 4) / 15) * 15);
	});

	it("counts the debt against what the person usually sleeps, kept at the floor or above", async () => {
		const steady = computeSleep(await indexOf(series(360, 360)), END);
		expect(steady.reference).toBe(360);
		expect(steady.debt).toBe(420); // against the general need of 7 h
		expect(steady.personalDebt).toBe(0);
		expect(steady.target).toBe(360);
		const short = computeSleep(await indexOf(series(300, 300)), END);
		expect(short.reference).toBe(360); // 5 h is not a reference
		expect(short.personalDebt).toBe(420);
		expect(short.target).toBe(390);
	});

	it("keeps the general need as the reference with fewer than 10 nights of history", async () => {
		const m = computeSleep(await indexOf([360, 360, 360, 360, 360, 360, 360, 360, 360]), END);
		expect(m.reference).toBe(420);
		expect(m.personalDebt).toBe(m.debt);
	});

	it("takes the middle of an even number of nights as the usual sleep", async () => {
		const nights = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? 380 : 400));
		expect(computeSleep(await indexOf(nights), END).reference).toBe(390);
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
		expect(root.querySelector(".ghs-foot-label")?.textContent).toBe(en.panelTonight);
		expect(root.querySelector(".ghs-foot-value")?.textContent).toBe("Aim for 7 h 45 min");
		expect(root.querySelector(".ghs-card-action")).toBeNull();
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

	it("names the weekday pattern and the usual sleep the debt is counted against", async () => {
		render(computeSleep(await indexOf(series(360, 360)), END));
		expect(notes()).toEqual(["No sleep debt against your usual 6 h"]);
		expect(root.querySelector(".ghs-foot-value")?.textContent).toBe("Aim for 6 h");
		root.replaceChildren();
		render(computeSleep(await indexOf(series(300, 300)), END));
		expect(notes()[0]).toBe("Sleep debt, last 7 nights: 7 h, against your usual 6 h");
		root.replaceChildren();
		render(computeSleep(await indexOf(series(420, 420)), END), "de", true);
		expect(Array.from(root.querySelectorAll(".ghs-fact")).map((e) => e.textContent)).toEqual(["Gegenüber dem allgemeinen Bedarf von 7 h: 0 min", "Nächte vor Freitag: du schläfst meist 7 h"]);
	});

	it("lists both debts and the weekday pattern under the light bulb, and nothing while the card is locked", async () => {
		render(computeSleep(await indexOf(series(300, 300)), END), "en", true);
		expect(Array.from(root.querySelectorAll(".ghs-fact")).map((e) => e.textContent)).toEqual([
			"Against the general need of 7 h: 14 h",
			"Against your usual 6 h: 7 h",
			"Nights before Friday: you usually sleep 5 h",
		]);
		root.replaceChildren();
		render(computeSleep(await indexOf([360, 360]), END), "en", true);
		expect(root.querySelector(".ghs-facts")).toBeNull();
	});

	it("explains how the aim and the debt are worked out when they rest on the person's own nights", async () => {
		render(computeSleep(await indexOf(series(360, 360)), END), "en", true);
		expect(root.querySelector(".ghs-explain")?.textContent).toContain("It never drops below 6 hours");
		root.replaceChildren();
		render(computeSleep(await indexOf([420, 420, 420, 420, 420, 420, 420]), END), "en", true);
		expect(root.querySelector(".ghs-explain")?.textContent).not.toContain("never drops below");
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
		expect(root.querySelector(".ghs-explain")?.textContent).toBe(de.panelSleepExplain.replace(/\{need\}/g, "7"));
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

	it("places each night on a clock that runs downwards as one bar from bedtime as long as the sleep", async () => {
		const model = computeSleep(await timed((ago) => (ago === 0 ? 360 : 450)), END);
		render(model);
		// bedtime 23:00 = 1380, up at 06:30: 450 min in bed; axis from 22:00 to 07:00 (540 min)
		expect(text(".ghs-axis-top")).toBe("22:00");
		expect(root.querySelector(".ghs-axis-bottom")).toBeNull(); // 07:00 would sit on the 06:30 line
		const css = (el: Element | null, prop: string): string => (el as HTMLElement).style.getPropertyValue(prop);
		const last = root.querySelectorAll(".ghs-night")[6]!;
		expect(css(last.querySelector(".ghs-night-asleep"), "--ghs-y")).toBe(`${(60 / 540) * 100}%`);
		expect(css(last.querySelector(".ghs-night-asleep"), "--ghs-h")).toBe(`${(360 / 540) * 100}%`);
		expect(root.querySelector(".ghs-night-window")).toBeNull();
		expect(root.querySelector(".ghs-night-need")).toBeNull();
		expect(last.querySelector(".ghs-night-asleep-last")).not.toBeNull();
		expect(root.querySelectorAll(".ghs-night-asleep-last")).toHaveLength(1);
		const first = root.querySelectorAll(".ghs-night")[0]!;
		expect(css(first.querySelector(".ghs-night-asleep"), "--ghs-h")).toBe(`${(450 / 540) * 100}%`);
	});

	it("draws dotted lines at the usual bedtime and wake-up, labelled with their times", async () => {
		render(computeSleep(await timed(() => 450), END));
		expect(Array.from(root.querySelectorAll(".ghs-axis-line")).map((e) => e.textContent)).toEqual(["23:00", "06:30"]);
		const ys = Array.from(root.querySelectorAll<HTMLElement>(".ghs-night-line")).map((e) => e.style.getPropertyValue("--ghs-y"));
		expect(ys).toEqual([`${(60 / 540) * 100}%`, `${(510 / 540) * 100}%`]);
	});

	it("keeps an axis label that is an hour or more from a usual time and drops one that is closer", async () => {
		// bed 23:00, up 06:00: axis 22:00 to 07:00, both labels at least an hour from a line
		render(computeSleep(await timed(() => 420, () => ({ start: "23:00", end: "06:00" })), END));
		expect(text(".ghs-axis-top")).toBe("22:00");
		expect(text(".ghs-axis-bottom")).toBe("07:00");
		root.empty();
		// bed 22:30: the axis starts at 22:00, half an hour above the line
		render(computeSleep(await timed(() => 420, () => ({ start: "22:30", end: "06:00" })), END));
		expect(root.querySelector(".ghs-axis-top")).toBeNull();
	});

	it("draws a night without times as an empty column and a night without duration as time in bed", async () => {
		const model = computeSleep(await timed((ago) => (ago === 3 ? null : 420), (ago) => (ago === 5 ? null : { start: "23:00", end: "06:30" })), END);
		render(model);
		const cols = Array.from(root.querySelectorAll(".ghs-night"));
		expect(cols[1]!.querySelector(".ghs-night-asleep")).toBeNull();
		expect(cols[1]!.querySelector(".ghs-night-day")).not.toBeNull();
		expect((cols[3]!.querySelector(".ghs-night-asleep") as HTMLElement).style.getPropertyValue("--ghs-h")).toBe(`${(450 / 540) * 100}%`);
	});

	it("counts a bedtime after midnight as later, not earlier", async () => {
		// 4 nights at 23:00, 3 at 00:30 (90 minutes later)
		const model = computeSleep(await timed(() => 420, (ago) => (ago % 2 ? { start: "00:30", end: "08:00" } : { start: "23:00", end: "06:30" })), END);
		expect(model.nights.find((n) => n.bed === 1470)).toBeDefined();
		render(model);
		// 4 nights at 23:00 and 3 at 00:30 -> 23:39; read as 00:30 = 06:30 earlier it would be 20:00-ish
		render(model, "en", true);
		expect(Array.from(root.querySelectorAll(".ghs-fact")).map((e) => e.textContent).join("|")).toContain("Bedtime 23:39 ±");
	});

	it("shows the average bedtime and wake-up time with how much they vary", async () => {
		const facts = (): string[] => Array.from(root.querySelectorAll(".ghs-fact")).map((e) => e.textContent ?? "");
		render(computeSleep(await timed(() => 420), END), "en", true);
		expect(facts()).toContain("Bedtime 23:00 ±0 min · wake-up 06:30 ±0 min");
		expect(Array.from(root.querySelectorAll(".ghs-card-note")).map((e) => e.textContent).join("|")).not.toContain("Bedtime");
		root.empty();
		// 4 nights at 23:00 and 3 at 23:30 -> mean 23:13, sd 15
		render(computeSleep(await timed(() => 420, (ago) => ({ start: ago % 2 ? "23:30" : "23:00", end: "07:00" })), END), "en", true);
		expect(facts().join("|")).toContain("Bedtime 23:13 ±15 min");
	});

	it("explains the timeline only when it is shown, in the plugin language", async () => {
		render(computeSleep(await timed(() => 420), END), "de", true);
		expect(text(".ghs-explain")).toBe(`${de.panelSleepExplain} ${de.panelSleepExplainTimes}`.replace(/\{need\}/g, "7"));
		root.empty();
		render(computeSleep(await indexOf([420, 420, 420, 420, 420, 420, 420]), END), "en", true);
		expect(text(".ghs-explain")).toBe(en.panelSleepExplain.replace(/\{need\}/g, "7"));
	});
});

describe("sleep need by age", () => {
	let root: HTMLElement;
	beforeEach(() => {
		root = document.createElement("div");
	});
	const nights = (m: number) => indexOf([m, m, m, m, m, m, m]);

	it.each([
		[2026 - 45, 420], // adult: 7 h
		[2026 - 18, 420],
		[2026 - 17, 480], // teenager: 8 h
		[2026 - 14, 480],
		[2026 - 13, 540], // school child: 9 h
		[2026 - 10, 540],
	])("born %s: %s minutes", async (born, need) => {
		expect(computeSleep(await nights(450), END, born).need).toBe(need);
	});

	it("keeps 7 hours without a birth year", async () => {
		expect(computeSleep(await nights(450), END).need).toBe(420);
		expect(computeSleep(await nights(450), END, null).need).toBe(420);
	});

	it("counts the debt, the tip and the chart against the age's need", async () => {
		const model = computeSleep(await nights(450), END, 2026 - 15); // 8 h: 30 min short every night
		expect(model.debt).toBe(210);
		expect(model.target).toBe(Math.floor((480 + 52.5) / 15) * 15);
		renderSleep(root, model, "en", true, () => undefined);
		expect(root.querySelector(".ghs-nights-need-label")?.textContent).toBe("8 h");
		expect(root.querySelector(".ghs-explain")?.textContent).toContain("fell short of 8 hours");
	});
});
