// Why it matters: the settings tab is where the user turns metrics on and off, changes language and units,
// and signs in or out. A toggle that does not persist, a label in the wrong language or a login row that
// stacks buttons on every refresh are all visible bugs.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, Notice, Setting } from "../testUtils/mocks/obsidian";
import { DEFAULT_SETTINGS, HealthSyncSettingTab, type HealthSyncSettings } from "../src/settings";
import { METRICS } from "../src/metrics";
import { PANEL_CARDS } from "../src/panel/cards";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";

interface Item {
	type?: string;
	name?: string;
	desc?: string;
	heading?: string;
	items?: Item[];
	control?: { type: string; key: string; options?: Record<string, string>; rows?: number };
	render?: (setting: Setting) => unknown;
	action?: (el: HTMLElement) => void;
}

function make(patch: Partial<HealthSyncSettings> = {}, session = false) {
	const settings: HealthSyncSettings = { ...DEFAULT_SETTINGS, enabledMetrics: { ...DEFAULT_SETTINGS.enabledMetrics }, lastSyncTimes: {}, language: "en", ...patch };
	const plugin = {
		settings,
		isSessionValid: () => session,
		saveSettings: vi.fn().mockResolvedValue(undefined),
		applyServerRegion: vi.fn(),
		applyPanelEnabled: vi.fn().mockResolvedValue(undefined),
		refreshPanels: vi.fn(),
		logout: vi.fn().mockResolvedValue(undefined),
		loginViaBrowser: vi.fn().mockImplementation((done?: () => void) => {
			done?.();
			return Promise.resolve();
		}),
		openManualLogin: vi.fn(),
		getSyncDiagnostics: vi.fn().mockReturnValue("the diagnostics"),
	};
	const tab = new HealthSyncSettingTab(new App() as never, plugin as never);
	return { tab, plugin, defs: () => tab.getSettingDefinitions() as unknown as Item[] };
}
const flat = (items: Item[]): Item[] => items.flatMap((i) => [i, ...(i.items ? flat(i.items) : [])]);
const named = (items: Item[], name: string): Item => flat(items).find((i) => i.name === name)!;
const keyed = (items: Item[], key: string): Item => flat(items).find((i) => i.control?.key === key)!;

beforeEach(() => {
	document.body.innerHTML = "";
});

describe("the settings layout", () => {
	it("lists the controls in order with their kinds", () => {
		const controls = flat(make().defs())
			.filter((i) => i.control && !i.control.key.startsWith("metric:") && !i.control.key.startsWith("panel:"))
			.map((i) => [i.control!.key, i.control!.type]);
		expect(controls).toEqual([
			["language", "dropdown"],
			["serverRegion", "dropdown"],
			["unitSystem", "dropdown"],
			["panelEnabled", "toggle"],
			["birthYear", "text"],
			["autoSync", "toggle"],
			["createDailyNoteIfMissing", "toggle"],
			["dailyNotePath", "text"],
			["dailyNoteFormat", "text"],
			["dailyNoteTemplate", "textarea"],
			["usePrefix", "toggle"],
			["writeWorkoutLocation", "toggle"],
			["writeTrainings", "toggle"],
		]);
	});

	it("offers the six languages and the two regions and unit systems", () => {
		const defs = make().defs();
		expect(Object.keys(keyed(defs, "language").control!.options!)).toEqual(["en", "de", "zh", "ja", "es", "fr"]);
		expect(keyed(defs, "serverRegion").control!.options).toEqual({ international: en.regionInternational, china: en.regionChina });
		expect(keyed(defs, "unitSystem").control!.options).toEqual({ metric: en.unitMetric, imperial: en.unitImperial });
	});

	it("shows standard metrics in a group and extended ones on their own page", () => {
		const defs = make().defs();
		const group = defs.find((i) => i.type === "group")!;
		expect(group.heading).toBe(en.settingsMetricsStandard);
		expect(group.items!.map((i) => i.control!.key)).toEqual(METRICS.filter((m) => m.category === "standard").map((m) => `metric:${m.key}`));
		const page = defs.find((i) => i.type === "page" && i.name === en.settingsMetricsExtendedDesc)!;
		expect(page.items![0]!.items!.map((i) => i.control!.key)).toEqual(METRICS.filter((m) => m.category === "extended").map((m) => `metric:${m.key}`));
	});

	it("puts the side panel switch on its own page", () => {
		const page = make().defs().find((i) => i.name === en.settingsPanel)!;
		expect(page.type).toBe("page");
		expect(page.items![0]!.control!.key).toBe("panelEnabled");
	});

	it("lists one switch per panel card after the panel switch, each in the user's language", () => {
		const page = make().defs().find((i) => i.name === en.settingsPanel)!;
		expect(page.items!.map((i) => i.control!.key)).toEqual(["panelEnabled", "birthYear", ...PANEL_CARDS.map((c) => `panel:${c.id}`)]);
		const german = make({ language: "de" }).defs().find((i) => i.name === de.settingsPanel)!;
		expect(german.items!.slice(2).map((i) => i.name)).toEqual(PANEL_CARDS.map((c) => de[c.title]));
	});

	it("says when a card's metric is not synced", () => {
		const { defs } = make({ enabledMetrics: { ...DEFAULT_SETTINGS.enabledMetrics, spo2: false } });
		const page = defs().find((i) => i.name === en.settingsPanel)!;
		const desc = (key: string) => (page.items!.find((i) => i.control?.key === key) as { desc?: string }).desc;
		expect(desc("panel:spo2")).toBe(en.settingsPanelCardNotSynced);
		expect(desc("panel:hrv")).toBe("");
		// stages needs any of its four metrics
		expect(desc("panel:stages")).toBe(en.settingsPanelCardNotSynced);
		const on = make({ enabledMetrics: { ...DEFAULT_SETTINGS.enabledMetrics, sleep_rem: true } }).defs().find((i) => i.name === en.settingsPanel)!;
		expect((on.items!.find((i) => i.control?.key === "panel:stages") as { desc?: string }).desc).toBe("");
		// a metric missing from the record falls back to its default
		const fallback = make({ enabledMetrics: {} }).defs().find((i) => i.name === en.settingsPanel)!;
		expect((fallback.items!.find((i) => i.control?.key === "panel:hrv") as { desc?: string }).desc).toBe("");
		expect((fallback.items!.find((i) => i.control?.key === "panel:spo2") as { desc?: string }).desc).toBe(en.settingsPanelCardNotSynced);
	});

	it("reads and writes a card switch, defaulting to on, and refreshes the panels", async () => {
		const { tab, plugin } = make();
		expect(tab.getControlValue("panel:hrv")).toBe(true);
		await tab.setControlValue("panel:hrv", false);
		expect(plugin.settings.panelCards).toEqual({ hrv: false });
		expect(tab.getControlValue("panel:hrv")).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
		expect(plugin.refreshPanels).toHaveBeenCalledOnce();
	});

	it("shows the birth year as text and stores only a believable year, otherwise nothing", async () => {
		const { tab, plugin } = make();
		expect(tab.getControlValue("birthYear")).toBe("");
		await tab.setControlValue("birthYear", "1985");
		expect(plugin.settings.birthYear).toBe(1985);
		expect(tab.getControlValue("birthYear")).toBe("1985");
		expect(plugin.refreshPanels).toHaveBeenCalledTimes(1);
		await tab.setControlValue("birthYear", "19");
		expect(plugin.settings.birthYear).toBeNull();
		await tab.setControlValue("birthYear", "1985");
		await tab.setControlValue("birthYear", "");
		expect(plugin.settings.birthYear).toBeNull();
		expect(plugin.saveSettings).toHaveBeenCalledTimes(4);
	});

	it("rebuilds the screen after a metric toggle so the card hints follow", async () => {
		const { tab } = make();
		await tab.setControlValue("metric:spo2", true);
		expect((tab as unknown as { updates: number }).updates).toBe(1);
	});

	it("labels every metric in the user's language", () => {
		const german = flat(make({ language: "de" }).defs());
		expect(named(german, de.metric_steps)).toBeDefined();
		expect(named(german, de.settingsAutoSync)).toBeDefined();
	});

	it("uses the miles and pounds labels for imperial users", () => {
		const defs = make({ unitSystem: "imperial" }).defs();
		expect(keyed(defs, "metric:distance_km").name).toBe(en.metric_distance_mi);
		expect(keyed(defs, "metric:weight_kg").name).toBe(en.metric_weight_lbs);
		expect(keyed(make().defs(), "metric:distance_km").name).toBe(en.metric_distance_km);
	});

	it("describes the connection state, with the logout hint only when signed in", () => {
		const out = named(make().defs(), en.settingsGarminLogin);
		expect(out.desc).toContain(en.settingsGarminLoggedOut);
		expect(out.desc).not.toContain(en.settingsGarminLogoutHint);
		const inn = named(make({}, true).defs(), en.settingsGarminLogin);
		expect(inn.desc).toContain(en.settingsGarminLoggedIn);
		expect(inn.desc).toContain(en.settingsGarminLogoutHint);
	});

	it("offers the diagnostics action", () => {
		expect(named(make().defs(), en.modalCredCopyDiagnostics).action).toBeTypeOf("function");
	});
});

describe("reading and writing values", () => {
	it("reads plain settings from the settings object", () => {
		const { tab } = make({ dailyNoteFormat: "DD.MM.YYYY" });
		expect(tab.getControlValue("dailyNoteFormat")).toBe("DD.MM.YYYY");
		expect(tab.getControlValue("autoSync")).toBe(true);
	});

	it("reads a metric toggle: the saved value, else the metric's default, else off", () => {
		const { tab, plugin } = make();
		plugin.settings.enabledMetrics["steps"] = false;
		expect(tab.getControlValue("metric:steps")).toBe(false);
		delete plugin.settings.enabledMetrics["hrv"];
		expect(tab.getControlValue("metric:hrv")).toBe(true);
		delete plugin.settings.enabledMetrics["spo2"];
		expect(tab.getControlValue("metric:spo2")).toBe(false);
		expect(tab.getControlValue("metric:nonexistent")).toBe(false);
	});

	it("writes a metric toggle into the enabledMetrics record and saves", async () => {
		const { tab, plugin } = make();
		await tab.setControlValue("metric:spo2", true);
		expect(plugin.settings.enabledMetrics["spo2"]).toBe(true);
		await tab.setControlValue("metric:spo2", 0);
		expect(plugin.settings.enabledMetrics["spo2"]).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
	});

	it("writes plain settings and saves without refreshing for ordinary keys", async () => {
		const { tab, plugin } = make();
		await tab.setControlValue("dailyNotePath", "Journal");
		expect(plugin.settings.dailyNotePath).toBe("Journal");
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
		expect((tab as unknown as { updates: number }).updates).toBe(0);
		expect(plugin.applyServerRegion).not.toHaveBeenCalled();
	});

	it("applies a changed server region to the provider", async () => {
		const { tab, plugin } = make();
		await tab.setControlValue("serverRegion", "china");
		expect(plugin.settings.serverRegion).toBe("china");
		expect(plugin.applyServerRegion).toHaveBeenCalledOnce();
	});

	it.each(["language", "unitSystem"])("rebuilds the screen after %s changes", async (key) => {
		const { tab } = make();
		await tab.setControlValue(key, key === "language" ? "de" : "imperial");
		expect((tab as unknown as { updates: number }).updates).toBe(1);
	});

	it("re-renders open panels after a language change", async () => {
		const { tab, plugin } = make();
		await tab.setControlValue("language", "de");
		expect(plugin.refreshPanels).toHaveBeenCalledOnce();
	});

	it("opens or closes the panel when its switch changes", async () => {
		const { tab, plugin } = make();
		await tab.setControlValue("panelEnabled", true);
		expect(plugin.settings.panelEnabled).toBe(true);
		expect(plugin.applyPanelEnabled).toHaveBeenCalledOnce();
	});
});

describe("the sign-in row", () => {
	function row(session: boolean) {
		const m = make({}, session);
		const container = document.createElement("div");
		const setting = new Setting(container);
		const item = named(m.defs(), en.settingsGarminLogin);
		const cleanup = item.render!(setting) as () => void;
		return { ...m, setting, cleanup, buttons: setting.buttons };
	}

	it("signed out: a primary login button and the manual fallback with its tooltip", () => {
		const { buttons, setting } = row(false);
		expect(buttons.map((b) => b.buttonEl.textContent)).toEqual([en.settingsGarminLogin, en.settingsGarminManualLogin]);
		expect(buttons[0]!.buttonEl.classList.contains("mod-cta")).toBe(true);
		expect(buttons[1]!.tooltip).toBe(en.settingsGarminManualLoginTooltip);
		expect(setting.settingEl.classList.contains("ghs-login-row")).toBe(true);
	});

	it("signed in: a single logout button", () => {
		const { buttons } = row(true);
		expect(buttons.map((b) => b.buttonEl.textContent)).toEqual([en.settingsGarminLogout]);
	});

	it("logging in starts the browser-free sign-in and refreshes the screen when done", async () => {
		const { buttons, plugin, tab } = row(false);
		buttons[0]!.buttonEl.click();
		await vi.waitFor(() => expect(plugin.loginViaBrowser).toHaveBeenCalledOnce());
		expect((tab as unknown as { updates: number }).updates).toBe(2);
	});

	it("the manual button opens the ticket dialog and refreshes afterwards", () => {
		const { buttons, plugin, tab } = row(false);
		buttons[1]!.buttonEl.click();
		expect(plugin.openManualLogin).toHaveBeenCalledOnce();
		(plugin.openManualLogin.mock.calls[0]![0] as () => void)();
		expect((tab as unknown as { updates: number }).updates).toBe(1);
	});

	it("logging out clears the session and refreshes", async () => {
		const { buttons, plugin, tab } = row(true);
		buttons[0]!.buttonEl.click();
		await vi.waitFor(() => expect(plugin.logout).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect((tab as unknown as { updates: number }).updates).toBe(1));
	});

	it("the cleanup removes the buttons and the class, so a re-render does not stack them", () => {
		const { cleanup, setting } = row(false);
		cleanup();
		expect(setting.controlEl.querySelectorAll("button")).toHaveLength(0);
		expect(setting.settingEl.classList.contains("ghs-login-row")).toBe(false);
	});
});

describe("copying the diagnostics", () => {
	function run() {
		const m = make();
		const el = document.createElement("div");
		named(m.defs(), en.modalCredCopyDiagnostics).action!(el);
		return { ...m, el };
	}

	it("copies the sync log and confirms with a notice", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
		run();
		await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("the diagnostics"));
		await vi.waitFor(() => expect(Notice.recorded.map((n) => n.message)).toEqual([en.modalCredDiagnosticsCopied]));
	});

	it("shows the text in a selectable field when the clipboard is blocked", async () => {
		Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) }, configurable: true });
		const { el } = run();
		await vi.waitFor(() => expect(el.querySelector("textarea")).not.toBeNull());
		const area = el.querySelector("textarea")!;
		expect(area.value || area.textContent).toBe("the diagnostics");
		expect(area.readOnly).toBe(true);
		expect(Number(area.rows)).toBe(6);
		expect(area.classList.contains("ghs-diagnostics")).toBe(true);
		expect(Notice.recorded).toEqual([]);
	});
});

describe("F8: the Stress duration and Recovery duration switches are gone", () => {
	it("are not metrics, have no toggle and no label in any language", async () => {
		const keys = METRICS.map((m) => m.key);
		expect(keys).not.toContain("stress_high");
		expect(keys).not.toContain("recovery_high");
		const toggles = flat(make().defs()).map((i) => i.control?.key);
		expect(toggles).not.toContain("metric:stress_high");
		expect(toggles).not.toContain("metric:recovery_high");
		const { es } = await import("../src/i18n/es");
		const { fr } = await import("../src/i18n/fr");
		const { ja } = await import("../src/i18n/ja");
		const { zh } = await import("../src/i18n/zh");
		for (const table of [en, de, es, fr, ja, zh]) {
			expect(Object.keys(table)).not.toContain("metric_stress_high");
			expect(Object.keys(table)).not.toContain("metric_recovery_high");
		}
	});
});
