// Why it matters: the interpretation has to be set apart from the general explanation, come first under (i),
// show only when (i) is open, and reach the card from the real data, not only from the rule tests.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, WorkspaceLeaf } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { HealthPanelView } from "../src/panel/view";
import { DEFAULT_SETTINGS } from "../src/settings";
import { computeRange, renderRange, HRV_CARD } from "../src/panel/cards/range-card";
import { DayIndex } from "../src/panel/index";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";
import type { Insight } from "../src/panel/insights/registry";

const END = "2026-10-22";
const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };

async function model(insights: Insight[]) {
	const app = new App();
	await seedHistory(app, { end: END, days: 31, frontmatter: (ago) => ({ hrv: ago % 2 ? 58 : 62 }) });
	return { ...computeRange(HRV_CARD, new DayIndex(app as never, () => settings), END), insights };
}

describe("the interpretation box", () => {
	let root: HTMLElement;
	beforeEach(() => {
		root = document.createElement("div");
	});

	it("is shown before the general explanation, with a headline, one line per interpretation and the note", async () => {
		renderRange(root, HRV_CARD, await model([{ id: "hrv_low_load", params: { pct: "70" } }, { id: "hrv_in_range" }]), "en", true, () => undefined);
		const children = Array.from(root.querySelector(".ghs-card")!.children).map((c) => c.className);
		expect(children.indexOf("ghs-insight")).toBeGreaterThan(-1);
		expect(children.indexOf("ghs-insight")).toBeLessThan(children.indexOf("ghs-about"));
		expect(root.querySelector(".ghs-insight-title")?.textContent).toBe(en.panelInsightTitle);
		const items = Array.from(root.querySelectorAll(".ghs-insight-item"));
		expect(items.map((i) => i.textContent)).toEqual([en.insight_hrv_low_load.replace("{pct}", "70"), en.insight_hrv_in_range]);
		expect(items.map((i) => i.classList.contains("ghs-insight-watch"))).toEqual([true, false]);
		expect(items.map((i) => i.classList.contains("ghs-insight-good"))).toEqual([false, true]);
		expect(root.querySelector(".ghs-insight .ghs-insight-note")).toBeNull();
		expect(root.querySelector(".ghs-explain")?.textContent).toBe(en.panelHrvExplain);
	});

	it("keeps the general explanation and the disclaimer in their own container, folded by default", async () => {
		renderRange(root, HRV_CARD, await model([{ id: "hrv_in_range" }]), "en", true, () => undefined);
		const about = root.querySelector("details.ghs-about") as HTMLDetailsElement;
		expect(about.open).toBe(false);
		expect(about.querySelector("summary")?.textContent).toBe(en.panelAboutTitle);
		expect(about.querySelector(".ghs-explain")?.textContent).toBe(en.panelHrvExplain);
		expect(about.querySelector(".ghs-insight-note")?.textContent).toBe(en.panelInsightNote);
		root.replaceChildren();
		renderRange(root, HRV_CARD, await model([]), "de", true, () => undefined);
		expect(root.querySelector(".ghs-about summary")?.textContent).toBe(de.panelAboutTitle);
		expect(root.querySelector(".ghs-insight")).toBeNull();
		expect(root.querySelector(".ghs-about .ghs-insight-note")?.textContent).toBe(de.panelInsightNote);
	});

	it("is written in the plugin language", async () => {
		renderRange(root, HRV_CARD, await model([{ id: "hrv_in_range" }]), "de", true, () => undefined);
		expect(root.querySelector(".ghs-insight-title")?.textContent).toBe(de.panelInsightTitle);
		expect(root.querySelector(".ghs-insight-item")?.textContent).toBe(de.insight_hrv_in_range);
	});

	it("stays hidden while (i) is closed", async () => {
		renderRange(root, HRV_CARD, await model([{ id: "hrv_in_range" }]), "en", false, () => undefined);
		expect(root.querySelector(".ghs-insight")).toBeNull();
		expect(root.querySelector(".ghs-about")).toBeNull();
	});

	it("is left out when there is nothing to say, leaving only the general explanation", async () => {
		renderRange(root, HRV_CARD, await model([]), "en", true, () => undefined);
		expect(root.querySelector(".ghs-insight")).toBeNull();
		expect(root.querySelector(".ghs-explain")).not.toBeNull();
	});
});

describe("interpretations in the panel", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 9, 22, 10));
	});
	afterEach(() => vi.useRealTimers());

	async function panel(fm: (ago: number) => Record<string, unknown>, settingsPatch = {}): Promise<HealthPanelView> {
		const app = new App();
		await seedHistory(app, { end: END, days: 45, frontmatter: fm });
		const view = new HealthPanelView(new WorkspaceLeaf(app) as never, { settings: { ...DEFAULT_SETTINGS, ...settingsPatch } } as never);
		await view.onOpen();
		return view;
	}
	const openInfo = (view: HealthPanelView, title: string): HTMLElement => {
		const card = Array.from(view.contentEl.querySelectorAll<HTMLElement>(".ghs-card")).find((c) => c.querySelector(".ghs-card-title")?.textContent === title)!;
		(card.querySelector(".ghs-info") as HTMLButtonElement).click();
		return Array.from(view.contentEl.querySelectorAll<HTMLElement>(".ghs-card")).find((c) => c.querySelector(".ghs-card-title")?.textContent === title)!;
	};

	it("explains a low HRV after a spike in training under the (i) of the HRV card", async () => {
		const view = await panel((ago) => ({ hrv: ago === 0 ? 54 : ago % 2 ? 58 : 62, running: `${ago < 7 ? 90 : 30}min` }));
		const card = openInfo(view, en.panelHrvTitle);
		expect(card.querySelector(".ghs-insight-item")?.textContent).toBe(en.insight_hrv_low_load.replace("{pct}", "100"));
	});

	it("opens the interpretation of one card at a time", async () => {
		const view = await panel((ago) => ({ hrv: ago === 0 ? 54 : ago % 2 ? 58 : 62, resting_hr: ago === 0 ? 60 : ago % 2 ? 50 : 54 }));
		openInfo(view, en.panelHrvTitle);
		openInfo(view, en.panelRestingHrTitle);
		expect(view.contentEl.querySelectorAll(".ghs-insight")).toHaveLength(1);
	});

	it("gives the sessions card its heart rate zone interpretations once a birth year is set", async () => {
		const view = await panel((ago) => ({ running: "40min · Ø160 bpm", hrv: ago }), { birthYear: 1986 });
		const card = openInfo(view, en.panelSessionsTitle);
		expect(card.querySelector(".ghs-insight-item")?.textContent).toBe(en.insight_sessions_all_hard.replace("{n}", "7"));
	});

	it("reaches every card that has interpretations", async () => {
		// a history that makes every rule family run once; the point is that each card passes its rules to the box
		const view = await panel((ago) => ({
			hrv: ago === 0 ? 54 : ago % 2 ? 58 : 62, resting_hr: ago % 2 ? 50 : 54, spo2: 96, respiration_rate: 14, sleep_duration: "7h 30min", sleep_deep: "1h 0min", sleep_rem: "1h 30min", sleep_light: "3h 20min", sleep_awake: "0h 20min",
			body_battery_max: ago === 0 ? 60 : 82, stress: 20, steps: ago === 0 ? 12000 : 10000, intensity_min: 40, vo2_max: ago % 7 === 0 ? 50 - ago / 14 : undefined, weight_kg: 80, running: ago < 4 ? "55min" : "30min",
		}));
		for (const title of [en.panelHrvTitle, en.panelRestingHrTitle, en.panelSpo2Title, en.panelBreathingTitle, en.panelSleepTitle, en.panelStagesTitle, en.panelBatteryTitle, en.panelStressTitle, en.panelStepsTitle, en.panelIntensityTitle, en.panelVo2Title, en.panelBodyTitle, en.panelLoadTitle, en.panelWeeklyTitle]) {
			const card = openInfo(view, title);
			expect(card.querySelector(".ghs-insight"), title).not.toBeNull();
		}
	});
});
