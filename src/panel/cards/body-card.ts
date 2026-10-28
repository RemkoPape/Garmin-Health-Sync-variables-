import { shiftDate } from "../../dates";
import { t } from "../../i18n/t";
import { formatNumber, formatSigned } from "../format";
import type { DayIndex } from "../index";
import { slope } from "../stats";
import { renderCard } from "./shell";
import type { Insight } from "../insights/registry";

/** Days with a weight needed in the last 14 days. */
export const BODY_MIN_ENTRIES = 3;
const ENTRY_WINDOW_DAYS = 14;
const MEAN_DAYS = 7;
const TREND_DAYS = 28;
/** A change faster than this share of the body weight per week is worth a second look. */
const FAST_SHARE = 0.01;
const KG_TO_LBS = 2.20462;
/** Days between the first and the last reading before a weekly change is worked out: a few days of noise are no trend. */
const MIN_SPAN_DAYS = 7;

export interface BodyModel {
	/** What the data suggests, filled in by the panel (see insights/). */
	insights: Insight[];
	unit: "kg" | "lbs";
	/** Mean of the weights of the last 7 days (the shown day included), null without any. */
	weight: number | null;
	/** Mean body fat of the last 7 days. */
	fat: number | null;
	/** Days with a weight in the last 14 days. */
	entries: number;
	/** The weights of the last 28 days: x = 0 for 27 days ago up to 27 for the shown day. */
	points: { x: number; y: number }[];
	/** Change of the weight per week from the last 28 days; null with fewer than two readings. */
	perWeek: number | null;
	fast: boolean;
}

export function computeBody(index: DayIndex, date: string): BodyModel {
	const read = (day: string): { value: number; unit: "kg" | "lbs" } | null => {
		const kg = index.value("weight_kg", day);
		if (kg !== null) return { value: kg, unit: "kg" };
		const lbs = index.value("weight_lbs", day);
		return lbs === null ? null : { value: lbs, unit: "lbs" };
	};
	const points: { x: number; y: number }[] = [];
	let unit: "kg" | "lbs" = "kg";
	let entries = 0;
	const readings: { i: number; w: { value: number; unit: "kg" | "lbs" } }[] = [];
	const fats: number[] = [];
	for (let i = TREND_DAYS - 1; i >= 0; i--) {
		const day = shiftDate(date, -i);
		const w = read(day);
		if (w) {
			unit = w.unit;
			readings.push({ i, w });
		}
		const f = index.value("body_fat_pct", day);
		if (f !== null && i < MEAN_DAYS) fats.push(f);
	}
	// notes in one unit and history records in the other (history keeps kilograms) are brought to the unit of the latest reading
	const inUnit = (w: { value: number; unit: "kg" | "lbs" }): number => (w.unit === unit ? w.value : unit === "lbs" ? w.value * KG_TO_LBS : w.value / KG_TO_LBS);
	const recent: number[] = [];
	for (const { i, w } of readings) {
		points.push({ x: TREND_DAYS - 1 - i, y: inUnit(w) });
		if (i < ENTRY_WINDOW_DAYS) entries++;
		if (i < MEAN_DAYS) recent.push(inUnit(w));
	}
	const mean = (v: number[]): number | null => (v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length);
	const weight = mean(recent);
	const span = points.length < 2 ? 0 : points[points.length - 1]!.x - points[0]!.x;
	const perWeek = points.length >= 2 && span >= MIN_SPAN_DAYS ? slope(points) * 7 : null;
	return { insights: [], unit, weight, fat: mean(fats), entries, points, perWeek, fast: perWeek !== null && weight !== null && Math.abs(perWeek) > weight * FAST_SHARE };
}

export function renderBody(parent: HTMLElement, model: BodyModel, lang: string, explainOpen: boolean, onToggleExplain: () => void): void {
	const value = model.weight === null ? null : formatNumber(model.weight, lang, 1);
	renderCard(parent, { title: t("panelBodyTitle", lang), value, unit: model.unit, explain: t("panelBodyExplain", lang), explainOpen, onToggleExplain, lang, insights: model.insights }, (card) => {
		if (model.weight === null) return;
		if (model.entries < BODY_MIN_ENTRIES || model.perWeek === null) {
			card.createDiv({ cls: "ghs-card-note", text: t("panelLocked", lang).replace("{need}", String(BODY_MIN_ENTRIES)).replace("{have}", String(model.entries)) });
			return;
		}
		// Daily readings as dots; neutral in colour because no direction is good or bad without a goal.
		const ys = model.points.map((p) => p.y);
		const lo = Math.min(...ys);
		const hi = Math.max(...ys);
		const chart = card.createDiv({ cls: "ghs-dots", attr: { role: "img", "aria-label": `${formatNumber(lo, lang, 1)}–${formatNumber(hi, lang, 1)} ${model.unit}` } });
		for (const p of model.points) {
			chart.createDiv({ cls: "ghs-dots-point" }).setCssProps({ "--ghs-x": `${(p.x / (TREND_DAYS - 1)) * 100}%`, "--ghs-y": `${hi === lo ? 50 : ((p.y - lo) / (hi - lo)) * 100}%` });
		}
		const foot = card.createDiv({ cls: "ghs-foot" });
		foot.createSpan({ cls: "ghs-foot-label", text: t("panelBodyPerWeek", lang).replace("{delta}", `${formatSigned(model.perWeek, lang)} ${model.unit}`) });
		if (model.fast) foot.createSpan({ cls: "ghs-foot-value ghs-foot-over", text: t("panelBodyFast", lang) });
		if (model.fat !== null) card.createDiv({ cls: "ghs-card-note", text: t("panelBodyFat", lang).replace("{n}", formatNumber(model.fat, lang, 1)) });
	});
}
