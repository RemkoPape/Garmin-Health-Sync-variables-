import type { TranslationKeys } from "../../i18n/en";
import { t } from "../../i18n/t";
import { formatNumber } from "../format";
import type { DayIndex } from "../index";
import { average } from "../stats";
import { renderCard } from "./shell";

/** Days with a stress level before the 7-day marker is shown. */
export const STRESS_MIN_DAYS = 5;
const WINDOW_DAYS = 7;

/** Garmin's bands: 0-25 rest, 26-50 low, 51-75 medium, 76-100 high. */
const BANDS: { upTo: number; label: TranslationKeys }[] = [
	{ upTo: 25, label: "panelStressRest" },
	{ upTo: 50, label: "panelStressLow" },
	{ upTo: 75, label: "panelStressMedium" },
	{ upTo: 100, label: "panelStressHigh" },
];

export interface StressModel {
	level: number | null;
	/** Mean of the 7 days before, or null with fewer than STRESS_MIN_DAYS. */
	week: number | null;
}

export function computeStress(index: DayIndex, date: string): StressModel {
	return { level: index.value("stress", date), week: average(index, "stress", date, WINDOW_DAYS, STRESS_MIN_DAYS) };
}

const pct = (v: number): number => Math.min(100, Math.max(0, v));

export function renderStress(parent: HTMLElement, model: StressModel, lang: string, explainOpen: boolean, onToggleExplain: () => void): void {
	const level = model.level;
	const band = level === null ? null : (BANDS.find((b) => level <= b.upTo) ?? BANDS[BANDS.length - 1]!);
	const value = level === null ? null : formatNumber(level, lang, 0);
	renderCard(parent, { title: t("panelStressTitle", lang), value, unit: band ? t(band.label, lang) : undefined, explain: t("panelStressExplain", lang), explainOpen, onToggleExplain, lang }, (card) => {
		if (level === null) return;
		const bar = card.createDiv({ cls: "ghs-range ghs-stress-bar", attr: { role: "img", "aria-label": `${Math.round(level)}` } });
		bar.createDiv({ cls: "ghs-range-track ghs-range-track-stress" });
		if (model.week !== null) bar.createDiv({ cls: "ghs-tick ghs-tick-solid" }).setCssProps({ "--ghs-x": `${pct(model.week)}%` });
		bar.createDiv({ cls: "ghs-dot ghs-dot-neutral" }).setCssProps({ "--ghs-x": `${pct(level)}%` });
		if (model.week !== null) card.createDiv({ cls: "ghs-card-note", text: t("panelStressWeek", lang).replace("{n}", formatNumber(model.week, lang, 0)) });
	});
}
