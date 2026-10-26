import { t } from "../../i18n/t";
import { shiftDate } from "../../dates";
import { formatNumber } from "../format";
import type { DayIndex } from "../index";
import { average } from "../stats";
import { computeTrend, type Trend } from "../trend";
import { renderCard } from "./shell";

/** Days with a peak before the usual peak is shown, and before it is called reliable. */
export const BATTERY_EARLY_MIN_DAYS = 5;
export const BATTERY_MIN_DAYS = 14;
const WINDOW_DAYS = 30;

export interface BatteryModel {
	trend: Trend | null;
	max: number | null;
	min: number | null;
	charged: number | null;
	/** 30-day mean of the daily peak. */
	usualPeak: number | null;
	/** 30-day mean of the overnight charge. */
	usualCharged: number | null;
	/** Days with a peak in the window. */
	have: number;
}

export function computeBattery(index: DayIndex, date: string): BatteryModel {
	const usualPeak = average(index, "body_battery_max", date, WINDOW_DAYS, BATTERY_EARLY_MIN_DAYS);
	let have = 0;
	for (let i = 1; i <= WINDOW_DAYS; i++) if (index.value("body_battery_max", shiftDate(date, -i)) !== null) have++;
	return {
		trend: computeTrend((d) => index.value("body_battery_max", d), date),
		max: index.value("body_battery_max", date),
		min: index.value("body_battery_min", date),
		charged: index.value("body_battery", date),
		usualPeak,
		usualCharged: average(index, "body_battery", date, WINDOW_DAYS, BATTERY_EARLY_MIN_DAYS),
		have,
	};
}

const pct = (v: number): number => Math.min(100, Math.max(0, v));

export function renderBattery(parent: HTMLElement, model: BatteryModel, lang: string, explainOpen: boolean, onToggleExplain: () => void): void {
	const value = model.max === null ? null : formatNumber(model.max, lang, 0);
	renderCard(parent, { title: t("panelBatteryTitle", lang), value, unit: t("panelBatteryUnit", lang), explain: t("panelBatteryExplain", lang), explainOpen, onToggleExplain, lang, trend: { trend: model.trend, format: (n) => formatNumber(n, lang, 0) } }, (card) => {
		if (model.max === null) return;
		const low = model.min ?? model.max;
		const bar = card.createDiv({ cls: "ghs-range ghs-battery", attr: { role: "img", "aria-label": `${low}–${model.max}` } });
		bar.createDiv({ cls: "ghs-battery-track" });
		const fill = bar.createDiv({ cls: "ghs-battery-fill" });
		fill.setCssProps({ "--ghs-x": `${pct(low)}%`, "--ghs-w": `${pct(model.max) - pct(low)}%` });
		const labels = bar.createDiv({ cls: "ghs-range-labels" });
		if (model.min !== null) labels.createSpan({ cls: "ghs-tick-label", text: t("panelBatteryLow", lang).replace("{n}", formatNumber(model.min, lang, 0)) }).setCssProps({ "--ghs-x": `${pct(low)}%` });
		if (model.usualPeak !== null) {
			bar.createDiv({ cls: "ghs-tick ghs-tick-solid" }).setCssProps({ "--ghs-x": `${pct(model.usualPeak)}%` });
			labels.createSpan({ cls: "ghs-tick-label", text: t("panelBatteryUsual", lang) }).setCssProps({ "--ghs-x": `${pct(model.usualPeak)}%` });
		}
		if (model.charged !== null) {
			const foot = card.createDiv({ cls: "ghs-foot" });
			foot.createSpan({ cls: "ghs-foot-label", text: t("panelRecharged", lang) });
			const charged = formatNumber(model.charged, lang, 0);
			foot.createSpan({
				cls: "ghs-foot-value",
				text: model.usualCharged === null ? t("panelRechargedNoUsual", lang).replace("{charged}", charged) : t("panelRechargedUsual", lang).replace("{charged}", charged).replace("{usual}", formatNumber(model.usualCharged, lang, 0)),
			});
		}
		if (model.usualPeak !== null && model.have < BATTERY_MIN_DAYS) {
			card.createDiv({ cls: "ghs-card-note ghs-card-warning", text: t("panelEarly", lang).replace("{have}", String(model.have)).replace("{need}", String(BATTERY_MIN_DAYS)) });
		}
	});
}
