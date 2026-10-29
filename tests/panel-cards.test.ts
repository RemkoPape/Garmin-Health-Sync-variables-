// Why it matters: the card list drives the panel and the settings page. Stable ids (stored in settings), a
// fixed order and sections that stay together are what users see and what their switches refer to.
import { describe, expect, it } from "vitest";
import { App, WorkspaceLeaf } from "../testUtils/mocks/obsidian";
import { PANEL_CARDS, SECTION_TITLES } from "../src/panel/cards";
import { HealthPanelView } from "../src/panel/view";
import { DEFAULT_SETTINGS } from "../src/settings";
import { en } from "../src/i18n/en";

async function open(panelCards: Record<string, boolean>, panelAuto = false): Promise<HealthPanelView> {
	const app = new App();
	const view = new HealthPanelView(new WorkspaceLeaf(app) as never, { settings: { ...DEFAULT_SETTINGS, panelCards, panelAuto } } as never);
	await view.onOpen();
	return view;
}
const titles = (view: HealthPanelView): (string | null)[] => Array.from(view.contentEl.querySelectorAll(".ghs-card-title")).map((e) => e.textContent);
const sections = (view: HealthPanelView): (string | null)[] => Array.from(view.contentEl.querySelectorAll(".ghs-section")).map((e) => e.textContent);

describe("PANEL_CARDS", () => {
	it("has unique ids and keeps the cards of a section together", () => {
		const ids = PANEL_CARDS.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
		const order = PANEL_CARDS.map((c) => c.section).filter((s, i, all) => s !== all[i - 1]);
		expect(order).toEqual(["today", "recovery", "sleep", "energy", "movement", "fitness", "training"]);
	});

	it("keeps the ids stored in users' settings", () => {
		expect(PANEL_CARDS.map((c) => c.id)).toEqual(["today", "hrv", "resting_hr", "spo2", "respiration_rate", "habits", "sleep", "stages", "battery", "stress", "hydration", "steps", "intensity", "floors", "vo2", "body", "load", "weekly", "sessions"]);
	});

	it("names every card and section", () => {
		for (const c of PANEL_CARDS) expect(en[c.title]).toBeTruthy();
		for (const s of Object.values(SECTION_TITLES)) expect(en[s]).toBeTruthy();
	});
});

describe("switching cards off", () => {
	it("shows every card by default", async () => {
		expect(titles(await open({}))).toHaveLength(PANEL_CARDS.length);
	});

	it("skips a switched-off card and keeps the others in order", async () => {
		const view = await open({ resting_hr: false, stages: false });
		expect(titles(view)).not.toContain(en.panelRestingHrTitle);
		expect(titles(view)).not.toContain(en.panelStagesTitle);
		expect(titles(view)).toHaveLength(PANEL_CARDS.length - 2);
		expect(titles(view)[0]).toBe(en.panelTodayTitle);
		expect(titles(view)[1]).toBe(en.panelHrvTitle);
	});

	it("treats an explicit true like the default", async () => {
		expect(titles(await open({ hrv: true }))).toHaveLength(PANEL_CARDS.length);
	});

	it("drops a section header when all its cards are off", async () => {
		const view = await open({ sleep: false, stages: false });
		expect(sections(view)).toEqual([en.panelSectionToday, en.panelSectionRecovery, en.panelSectionEnergy, en.panelSectionMovement, en.panelSectionFitness, en.panelSectionTraining]);
	});

	it("keeps a half-width card on its own when its partner is off", async () => {
		const view = await open({ spo2: false });
		expect(view.contentEl.querySelectorAll(".ghs-pair .ghs-card")).toHaveLength(1);
		const off = await open({ spo2: false, respiration_rate: false });
		expect(off.contentEl.querySelector(".ghs-pair")).toBeNull();
	});

	it("shows nothing but the day navigation when every card is off", async () => {
		const view = await open(Object.fromEntries(PANEL_CARDS.map((c) => [c.id, false])));
		expect(titles(view)).toEqual([]);
		expect(sections(view)).toEqual([]);
		expect(view.contentEl.querySelector(".ghs-daynav")).not.toBeNull();
	});
});
