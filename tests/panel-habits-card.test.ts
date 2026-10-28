// Why it matters: the Habits card is where the lifestyle log becomes something to act on. It has to show what was
// logged, say plainly when there is too little to compare and name only clear patterns under the light bulb.
import { describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { PANEL_CARDS } from "../src/panel/cards";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";
import { insightText } from "../src/panel/insights/registry";
import { computeHabitsCard } from "../src/panel/cards/habits-card";
import { habitInsights } from "../src/panel/insights/lifestyle";

const END = "2026-10-22";
const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };
const NAMES = { lifestyle_alcohol: { name: "Alcohol", kind: "check" as const }, lifestyle_coffee: { name: "Late caffeine", kind: "count" as const } };
const noise = (i: number): number => (((i * 37) % 11) - 5) * 0.3;
const on = (ago: number): boolean => {
	let x = Math.imul(ago + 1, 0x9e3779b1);
	x ^= x >>> 15;
	x = Math.imul(x, 0x85ebca6b);
	x ^= x >>> 13;
	return (x & 1) === 0;
};

async function render(days: number, frontmatter: (ago: number) => Record<string, unknown> | null, options: { lang?: string; open?: boolean; habits?: typeof NAMES } = {}): Promise<HTMLElement> {
	const app = new App();
	await seedHistory(app, { end: END, days, frontmatter });
	const parent = document.createElement("div");
	const card = PANEL_CARDS.find((c) => c.id === "habits")!;
	card.render({ parent, index: new DayIndex(app as never, () => settings), date: END, lang: options.lang ?? "en", imperial: false, birthYear: null, habits: options.habits ?? NAMES, explainOpen: options.open ?? false, onToggleExplain: () => undefined });
	return parent;
}
const text = (el: Element | null | undefined): string => el?.textContent ?? "";

describe("the Habits card", () => {
	it("sits in the Recovery section and needs the lifestyle log", () => {
		const card = PANEL_CARDS.find((c) => c.id === "habits")!;
		expect(card.section).toBe("recovery");
		expect(card.metrics).toEqual(["lifestyle_log"]);
		expect(card.extra).toEqual(["hrv", "resting_hr"]);
	});

	it("says there is nothing to show while no habit was logged in the last 30 days", async () => {
		const parent = await render(40, () => ({ hrv: 50 }));
		expect(text(parent.querySelector(".ghs-card-title"))).toBe(en.panelHabitsTitle);
		expect(text(parent.querySelector(".ghs-card-note"))).toBe(en.panelHabitsEmpty);
		expect(parent.querySelector(".ghs-habit")).toBeNull();
	});

	it("shows one compact row per habit: the day's status, the days logged, the run and a strip", async () => {
		const parent = await render(80, (ago) => ({ lifestyle_alcohol: ago === 0 ? 0 : on(ago) ? 1 : 0, lifestyle_coffee: ago < 4 ? (ago === 0 ? 5 : 1) : 0, hrv: 50, resting_hr: 55 }));
		const rows = Array.from(parent.querySelectorAll(".ghs-habit"));
		expect(rows.map((r) => text(r.querySelector(".ghs-habit-name")).replace(/\s+/g, " ").trim()).sort()).toEqual(["✓ Late caffeine ×5", "✗ Alcohol"]);
		const coffee = rows.find((r) => text(r).includes("Late caffeine"))!;
		expect(text(coffee.querySelector(".ghs-habit-note"))).toBe("80 logged · 4 in a row");
		expect(coffee.querySelector(".ghs-habit-yes")).not.toBeNull();
		expect(rows.find((r) => text(r).includes("Alcohol"))!.querySelector(".ghs-habit-no")).not.toBeNull();
		expect(parent.querySelectorAll(".ghs-habit-strip .ghs-habit-dot")).toHaveLength(28);
		expect(parent.querySelectorAll(".ghs-habit-legend .ghs-habit-dot")).toHaveLength(3);
		expect(parent.querySelector(".ghs-habit-tag")).toBeNull();
	});

	it("draws a clear better night green to the right and a clear worse one orange to the left", async () => {
		const parent = await render(80, (ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, lifestyle_coffee: on(ago) ? 1 : 0, hrv: 50 + (on(ago + 1) ? 8 : 0) + noise(ago), resting_hr: 55 + (on(ago + 1) ? 3 : 0) + noise(ago + 3) * 0.5 }));
		const rows = Array.from(parent.querySelectorAll(".ghs-habit"));
		const hrv = rows[0]!.querySelectorAll(".ghs-habit-effect")[0]!;
		const rhr = rows[0]!.querySelectorAll(".ghs-habit-effect")[1]!;
		expect(text(hrv.querySelector(".ghs-habit-effect-label"))).toBe(en.panelHabitsHrv);
		expect(hrv.querySelector(".ghs-habit-fill-good.ghs-habit-fill-right")).not.toBeNull();
		expect(text(hrv.querySelector(".ghs-habit-value"))).toMatch(/^\+\d+ ms$/);
		expect(text(rhr.querySelector(".ghs-habit-effect-label"))).toBe(en.panelHabitsRhr);
		expect(rhr.querySelector(".ghs-habit-fill-bad.ghs-habit-fill-left")).not.toBeNull();
		expect(text(rhr.querySelector(".ghs-habit-value"))).toMatch(/^\+\d+ bpm$/);
		expect(rhr.querySelector(".ghs-habit-bar")!.getAttribute("aria-label")).toContain("bpm");
	});

	it("draws the bar of the measure that has data and none for the other", async () => {
		const noPulse = await render(80, (ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, hrv: 50 + noise(ago * 7) }));
		expect(Array.from(noPulse.querySelectorAll(".ghs-habit-effect-label")).map(text)).toEqual([en.panelHabitsHrv]);
		const noHrv = await render(80, (ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, resting_hr: 55 + noise(ago * 7) }));
		expect(Array.from(noHrv.querySelectorAll(".ghs-habit-effect-label")).map(text)).toEqual([en.panelHabitsRhr]);
	});

	it("shows no tick or cross for a day on which nothing was logged, and keeps the run of the days before", async () => {
		const parent = await render(80, (ago) => (ago === 0 ? { hrv: 50 } : { lifestyle_alcohol: ago <= 3 ? 1 : ago === 4 ? 0 : on(ago) ? 1 : 0, hrv: 50 }));
		const row = parent.querySelector(".ghs-habit")!;
		expect(row.querySelector(".ghs-habit-yes, .ghs-habit-no")).toBeNull();
		expect(text(row.querySelector(".ghs-habit-note"))).toContain("3 in a row");
	});

	it("shows a difference that is not clear in grey", async () => {
		const parent = await render(80, (ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, hrv: 50 + noise(ago * 7), resting_hr: 55 }));
		expect(parent.querySelector(".ghs-habit-fill-flat")).not.toBeNull();
		expect(parent.querySelector(".ghs-habit-value-flat")).not.toBeNull();
	});

	it("says what it needs when there are too few days to compare, with the days it has", async () => {
		const parent = await render(30, (ago) => ({ lifestyle_alcohol: ago < 5 ? ago % 2 : 0, hrv: 50, resting_hr: 55 }), { habits: { lifestyle_alcohol: NAMES.lifestyle_alcohol } as never });
		const row = parent.querySelector(".ghs-habit")!;
		expect(text(row)).toContain(en.panelHabitsProgress.replace(/\{min\}/g, "8").replace("{n}", "2").replace("{m}", "8"));
		expect(row.querySelector(".ghs-habit-effect")).toBeNull();
	});

	it("is shown in the plugin language", async () => {
		const parent = await render(80, (ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, hrv: 50 + noise(ago * 7) }), { lang: "de" });
		expect(text(parent.querySelector(".ghs-card-title"))).toBe(de.panelHabitsTitle);
		expect(text(parent.querySelector(".ghs-habit-legend"))).toContain(de.panelHabitsBarsHint);
	});

	it("names the clear patterns under the light bulb, the strongest first and at most three", async () => {
		const parent = await render(80, (ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, lifestyle_coffee: on(ago) ? 2 : 0, hrv: 50 - (on(ago + 1) ? 8 : 0) + noise(ago), resting_hr: 55 + (on(ago + 1) ? 3 : 0) + noise(ago + 3) * 0.5 }), { open: true });
		const items = Array.from(parent.querySelectorAll(".ghs-insight-watch, .ghs-insight-good")).map(text);
		expect(items).toHaveLength(3);
		expect(items.every((t) => /^After (Alcohol|Late caffeine) your (HRV is \d+ ms lower|resting heart rate is \d+ bpm higher) than after days without it \(\d+ days against \d+\)\.$/.test(t))).toBe(true);
		expect(parent.querySelectorAll(".ghs-insight-watch")).toHaveLength(3);
		expect(text(parent.querySelector(".ghs-explain"))).toBe(en.panelHabitsExplain);
	});
});

describe("what the habits say with little data", () => {
	it("lists the counts behind every habit and the weekly average of a counted one under the light bulb", async () => {
		const parent = await render(40, (ago) => ({ lifestyle_alcohol: ago % 2, lifestyle_coffee: ago < 3 ? 3 : ago < 7 ? 2 : 0 }), { open: true });
		const items = Array.from(parent.querySelectorAll(".ghs-fact")).map(text);
		expect(items).toContain("Alcohol: logged on 40 of the last 90 days, 20 with the habit and 20 as no.");
		expect(items).toContain("Late caffeine: 2.4 on average on the 7 days of the last 7 on which you logged it, 17 in total.");
		expect(items.some((t) => t.startsWith("Alcohol:") && t.includes("on average"))).toBe(false);
	});

	it("tells a habit that is only ever logged as yes what to log", async () => {
		const parent = await render(40, () => ({ lifestyle_alcohol: 1, hrv: 50 }), { open: true });
		expect(Array.from(parent.querySelectorAll(".ghs-insight-watch")).map(text)).toContain("Alcohol: only 0 days logged as no so far. Log a no on the days you skip it, so the nights after it can be compared.");
	});
});

describe("habitInsights", () => {
	it("picks the text for the measure and the direction, with the habit, the size and the day counts", async () => {
		const app = new App();
		await seedHistory(app, { end: END, days: 80, frontmatter: (ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, lifestyle_coffee: on(ago) ? 1 : 0, hrv: 50 + (on(ago + 1) ? 8 : 0) + noise(ago), resting_hr: 55 - (on(ago + 1) ? 3 : 0) + noise(ago + 3) * 0.5 }) });
		const model = computeHabitsCard(new DayIndex(app as never, () => settings), END, NAMES);
		const insights = habitInsights(model, "en");
		expect(insights.map((i) => i.id).sort()).toEqual(["lifestyle_hrv_up", "lifestyle_hrv_up", "lifestyle_rhr_down"].sort());
		const first = insights.find((i) => i.id === "lifestyle_hrv_up")!;
		expect(insightText(first, "en")).toMatch(/^After (Alcohol|Late caffeine) your HRV is \d ms higher than after days without it \(\d+ days against \d+\)\.$/);
		expect(habitInsights({ insights: [], habits: [] }, "en")).toEqual([]);
	});

	it("names a rise of the resting heart rate and a fall of the HRV as something to watch", async () => {
		const app = new App();
		await seedHistory(app, { end: END, days: 80, frontmatter: (ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, hrv: 50 - (on(ago + 1) ? 8 : 0) + noise(ago), resting_hr: 55 + (on(ago + 1) ? 3 : 0) + noise(ago + 3) * 0.5 }) });
		const ids = habitInsights(computeHabitsCard(new DayIndex(app as never, () => settings), END, NAMES), "en").map((i) => i.id);
		expect(ids.sort()).toEqual(["lifestyle_hrv_down", "lifestyle_rhr_up"]);
	});
});
