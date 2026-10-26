import {
	App,
	PluginSettingTab,
	Notice,
	Setting,
	SettingDefinition,
	SettingDefinitionItem,
} from "obsidian";
import type HealthSyncPlugin from "./main";
import { METRICS, getDefaultEnabledMetrics } from "./metrics";
import { PANEL_CARDS } from "./panel/cards";
import { t } from "./i18n/t";
import type { TranslationKeys } from "./i18n/en";

/** Maps internal metric keys to their imperial i18n label when unit system is imperial */
const IMPERIAL_LABEL_MAP: Partial<Record<string, TranslationKeys>> = {
	distance_km: "metric_distance_mi",
	weight_kg: "metric_weight_lbs",
};

/**
 * Control-key prefix for per-metric toggles. Metric enablement lives in the
 * nested `enabledMetrics` record, so the flat declarative keys are namespaced
 * and mapped back in `getControlValue`/`setControlValue`.
 */
const METRIC_KEY_PREFIX = "metric:";
/** Control-key prefix for the per-card panel switches, stored in `panelCards`. */
const PANEL_CARD_KEY_PREFIX = "panel:";

export type ServerRegion = "international" | "china";
export type UnitSystem = "metric" | "imperial";

export interface HealthSyncSettings {
	usePrefix: boolean;
	dailyNotePath: string;
	dailyNoteFormat: string;
	dailyNoteTemplate: string;
	enabledMetrics: Record<string, boolean>;
	lastSyncTimes: Record<string, number>; // Date → last sync timestamp (epoch ms)
	garminSession: string;
	garminOAuth1: string; // JSON-serialized OAuth1Token (long-lived, ~1 year)
	garminOAuth2: string; // JSON-serialized OAuth2Token (short-lived)
	language: string;
	autoSync: boolean;
	createDailyNoteIfMissing: boolean; // When false, sync waits for the note instead of creating it
	writeTrainings: boolean; // Machine-readable training data in frontmatter
	writeWorkoutLocation: boolean; // Reverse-geocoded workout location in frontmatter
	serverRegion: ServerRegion;
	unitSystem: UnitSystem;
	panelEnabled: boolean; // Side panel with health cards
	panelCards: Record<string, boolean>; // Cards switched off in the panel (missing = on)
}

export const DEFAULT_SETTINGS: HealthSyncSettings = {
	usePrefix: false,
	dailyNotePath: "",
	dailyNoteFormat: "YYYY-MM-DD",
	dailyNoteTemplate: "",
	enabledMetrics: getDefaultEnabledMetrics(),
	lastSyncTimes: {},
	garminSession: "",
	garminOAuth1: "",
	garminOAuth2: "",
	language: "en",
	autoSync: true,
	createDailyNoteIfMissing: true,
	writeTrainings: false,
	writeWorkoutLocation: true,
	serverRegion: "international",
	unitSystem: "metric",
	panelEnabled: false,
	panelCards: {},
};

export class HealthSyncSettingTab extends PluginSettingTab {
	plugin: HealthSyncPlugin;

	constructor(app: App, plugin: HealthSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const lang = this.plugin.settings.language;

		// On needsUserLogin the OAuth tokens are discarded → appears as "not
		// connected"; transient errors leave the tokens in place and are
		// automatically retried with backoff (no separate UI state needed).
		const hasSavedSession = this.plugin.isSessionValid();
		const garminStatus = hasSavedSession
			? t("settingsGarminLoggedIn", lang)
			: t("settingsGarminLoggedOut", lang);

		return [
			{
				name: t("settingsLanguage", lang),
				desc: t("settingsLanguageDesc", lang),
				control: {
					type: "dropdown",
					key: "language",
					options: {
						en: "English",
						de: "Deutsch",
						zh: "中文",
						ja: "日本語",
						es: "Español",
						fr: "Français",
					},
				},
			},
			{
				name: t("settingsServerRegion", lang),
				desc: t("settingsServerRegionDesc", lang),
				control: {
					type: "dropdown",
					key: "serverRegion",
					options: {
						international: t("regionInternational", lang),
						china: t("regionChina", lang),
					},
				},
			},
			{
				name: t("settingsUnitSystem", lang),
				desc: t("settingsUnitSystemDesc", lang),
				control: {
					type: "dropdown",
					key: "unitSystem",
					options: {
						metric: t("unitMetric", lang),
						imperial: t("unitImperial", lang),
					},
				},
			},
			{
				type: "page",
				name: t("settingsPanel", lang),
				items: [
					{
						name: t("settingsPanelShow", lang),
						desc: t("settingsPanelShowDesc", lang),
						control: { type: "toggle", key: "panelEnabled" },
					},
					...this.panelCardDefinitions(lang),
				],
			},
			{
				name: t("settingsGarminLogin", lang),
				desc: `${garminStatus}. ${t("settingsGarminSessionPrivacyDesc", lang)}${hasSavedSession ? ` ${t("settingsGarminLogoutHint", lang)}` : ""}`,
				render: (setting) => this.renderGarminLogin(setting, hasSavedSession),
			},
			{
				// Mobile has no dev console: lets users paste what the last sync did into a bug report.
				name: t("modalCredCopyDiagnostics", lang),
				action: (el) => { void this.copySyncDiagnostics(el, lang); },
			},
			{
				name: t("settingsAutoSync", lang),
				desc: t("settingsAutoSyncDesc", lang),
				control: { type: "toggle", key: "autoSync" },
			},
			// Auto-sync behaviour only: when off, the background auto-sync waits
			// for a real note instead of creating it; manual sync and backfill
			// still create. Avoids conflicts with the tool that owns the note
			// (Templater, Calendar, an external sync, ...).
			{
				name: t("settingsCreateDailyNote", lang),
				desc: t("settingsCreateDailyNoteDesc", lang),
				control: { type: "toggle", key: "createDailyNoteIfMissing" },
			},
			{
				name: t("settingsDailyNotePath", lang),
				desc: t("settingsDailyNotePathDesc", lang),
				control: { type: "text", key: "dailyNotePath" },
			},
			{
				name: t("settingsDailyNoteFormat", lang),
				desc: t("settingsDailyNoteFormatDesc", lang),
				control: { type: "text", key: "dailyNoteFormat" },
			},
			{
				name: t("settingsDailyNoteTemplate", lang),
				desc: t("settingsDailyNoteTemplateDesc", lang),
				control: { type: "textarea", key: "dailyNoteTemplate", rows: 4 },
			},
			{
				name: t("settingsPrefix", lang),
				desc: t("settingsPrefixDesc", lang),
				control: { type: "toggle", key: "usePrefix" },
			},
			{
				name: t("settingsWriteWorkoutLocation", lang),
				desc: t("settingsWriteWorkoutLocationDesc", lang),
				control: { type: "toggle", key: "writeWorkoutLocation" },
			},
			{
				name: t("settingsWriteTrainings", lang),
				desc: t("settingsWriteTrainingsDesc", lang),
				control: { type: "toggle", key: "writeTrainings" },
			},
			{
				type: "group",
				heading: t("settingsMetricsStandard", lang),
				items: this.metricToggleDefinitions("standard", lang),
			},
			{
				type: "page",
				name: t("settingsMetricsExtendedDesc", lang),
				items: [
					{
						type: "group",
						items: this.metricToggleDefinitions("extended", lang),
					},
				],
			},
		];
	}

	private async copySyncDiagnostics(el: HTMLElement, lang: HealthSyncSettings["language"]): Promise<void> {
		const text = this.plugin.getSyncDiagnostics();
		try {
			await navigator.clipboard.writeText(text);
			new Notice(t("modalCredDiagnosticsCopied", lang));
		} catch {
			// Clipboard write blocked: show the text so it can be selected and copied by hand.
			const area = el.createEl("textarea", { text });
			area.readOnly = true;
			area.rows = 6;
			area.addClass("ghs-diagnostics");
		}
	}

	/** One switch per card. A card whose metrics are not synced says so, because it would only show "No reading". */
	private panelCardDefinitions(lang: string): SettingDefinition[] {
		const enabled = this.plugin.settings.enabledMetrics;
		return PANEL_CARDS.map((card) => {
			const metric = (key: string): boolean => enabled[key] ?? METRICS.find((m) => m.key === key)!.defaultEnabled;
			return {
				name: t(card.title, lang),
				desc: card.metrics.length === 0 || card.metrics.some(metric) ? "" : t("settingsPanelCardNotSynced", lang),
				control: { type: "toggle", key: `${PANEL_CARD_KEY_PREFIX}${card.id}` },
			};
		});
	}

	getControlValue(key: string): unknown {
		if (key.startsWith(PANEL_CARD_KEY_PREFIX)) {
			return this.plugin.settings.panelCards[key.slice(PANEL_CARD_KEY_PREFIX.length)] ?? true;
		}
		if (key.startsWith(METRIC_KEY_PREFIX)) {
			const metricKey = key.slice(METRIC_KEY_PREFIX.length);
			const metric = METRICS.find((m) => m.key === metricKey);
			return this.plugin.settings.enabledMetrics[metricKey] ?? metric?.defaultEnabled ?? false;
		}
		return this.plugin.settings[key as keyof HealthSyncSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key.startsWith(PANEL_CARD_KEY_PREFIX)) {
			this.plugin.settings.panelCards[key.slice(PANEL_CARD_KEY_PREFIX.length)] = Boolean(value);
			await this.plugin.saveSettings();
			this.plugin.refreshPanels();
			return;
		}
		if (key.startsWith(METRIC_KEY_PREFIX)) {
			const metricKey = key.slice(METRIC_KEY_PREFIX.length);
			this.plugin.settings.enabledMetrics[metricKey] = Boolean(value);
			await this.plugin.saveSettings();
			// the card switches say whether their metrics are synced
			this.update();
			return;
		}

		const settings = this.plugin.settings as unknown as Record<string, unknown>;
		settings[key] = value;
		await this.plugin.saveSettings();

		if (key === "serverRegion") {
			this.plugin.applyServerRegion();
		} else if (key === "panelEnabled") {
			await this.plugin.applyPanelEnabled();
		} else if (key === "language" || key === "unitSystem") {
			// Rebuild the definitions so labels reflect the new locale / units.
			this.update();
			this.plugin.refreshPanels();
		}
	}

	private metricToggleDefinitions(
		category: "standard" | "extended",
		lang: string
	): SettingDefinition[] {
		const isImperial = this.plugin.settings.unitSystem === "imperial";
		return METRICS.filter((m) => m.category === category).map((metric) => {
			const labelKey =
				(isImperial && IMPERIAL_LABEL_MAP[metric.key]) ||
				(`metric_${metric.key}` as TranslationKeys);
			return {
				name: t(labelKey, lang),
				control: { type: "toggle", key: `${METRIC_KEY_PREFIX}${metric.key}` },
			};
		});
	}

	/**
	 * Login/logout row. Returns a cleanup callback — the row is re-rendered on
	 * every update() (e.g. after login state or language changes), and without
	 * it each pass would append another set of buttons.
	 */
	private renderGarminLogin(setting: Setting, hasSavedSession: boolean): () => void {
		const lang = this.plugin.settings.language;
		const buttonEls: HTMLButtonElement[] = [];
		setting.settingEl.addClass("ghs-login-row");

		if (hasSavedSession) {
			setting.addButton((btn) => {
				buttonEls.push(btn.buttonEl);
				btn.setButtonText(t("settingsGarminLogout", lang)).onClick(async () => {
					await this.plugin.logout();
					this.update();
				});
			});
		} else {
			setting.addButton((btn) => {
				buttonEls.push(btn.buttonEl);
				btn.setButtonText(t("settingsGarminLogin", lang))
					.setCta()
					.onClick(async () => {
						await this.plugin.loginViaBrowser(() => this.update());
						this.update();
					});
			});
			// Manual-ticket fallback (issue #6) for accounts where the embedded
			// login window never completes the sign-in.
			setting.addButton((btn) => {
				buttonEls.push(btn.buttonEl);
				btn.setButtonText(t("settingsGarminManualLogin", lang))
					.setTooltip(t("settingsGarminManualLoginTooltip", lang))
					.onClick(() => {
						this.plugin.openManualLogin(() => this.update());
					});
			});
		}

		return () => {
			buttonEls.forEach((el) => el.remove());
			setting.settingEl.removeClass("ghs-login-row");
		};
	}
}
