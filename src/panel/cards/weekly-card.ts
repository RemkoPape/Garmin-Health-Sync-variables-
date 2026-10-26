import { shiftDate, weekStart } from "../../dates";
import { t } from "../../i18n/t";
import { formatNumber } from "../format";
import type { DayIndex } from "../index";
import { CHRONIC_WEEKS, DISTANCE_CATEGORIES, heartRateHistory, intensityStep, kmBetween, minutesBetween, previousWeeks, previousWeeksKm, type DistanceCategory, type Step } from "../load";
import { isRecovery } from "../sessions";
import { maxHrAt } from "../zones";
import { renderCard } from "./shell";

/** Training may grow by at most this much over the average of the previous weeks. */
const CAP_FACTOR = 1.1;

export interface WeekSegment {
	minutes: number;
	step: Step | null;
}

/** The week of a distance sport: kilometres so far against the average of the previous weeks and a cap 10 percent above it. */
export interface WeeklyDistance {
	category: DistanceCategory;
	km: number;
	average: number;
	cap: number;
}

export interface WeeklyModel {
	/** Segment colours come from heart rate zones (a birth year is set). */
	zones: boolean;
	/** Running and cycling distance, for the sports that have any this week or in the previous weeks. */
	distances: WeeklyDistance[];
	/** Minutes so far this week, up to and including the shown day. */
	minutes: number;
	/** The sessions of the week so far in order. */
	segments: WeekSegment[];
	/** Previous complete weeks that were used (0 to 4). */
	weeks: number;
	average: number | null;
	cap: number | null;
}

export function computeWeekly(index: DayIndex, date: string, birthYear: number | null = null): WeeklyModel {
	const maxHr = maxHrAt(birthYear, date);
	const start = weekStart(date);
	const history = heartRateHistory(index, date);
	const segments: WeekSegment[] = [];
	for (let day = start; day <= date; day = shiftDate(day, 1)) {
		for (const s of index.sessions(day)) if (!isRecovery(s)) segments.push({ minutes: s.minutes, step: intensityStep(s, history, maxHr) });
	}
	const previous = previousWeeks(index, date);
	const average = previous.length === 0 ? null : previous.reduce((a, b) => a + b, 0) / previous.length;
	const distances: WeeklyDistance[] = [];
	for (const category of DISTANCE_CATEGORIES) {
		const before = previousWeeksKm(index, date, category);
		const km = kmBetween(index, start, date, category);
		const average = before.length === 0 ? 0 : before.reduce((a, b) => a + b, 0) / before.length;
		if (km > 0 || average > 0) distances.push({ category, km, average, cap: average * CAP_FACTOR });
	}
	return { zones: maxHr !== null, distances, minutes: minutesBetween(index, start, date), segments, weeks: previous.length, average, cap: average === null ? null : average * CAP_FACTOR };
}

const KM_PER_MILE = 1.609344;

export function renderWeekly(parent: HTMLElement, model: WeeklyModel, lang: string, imperial: boolean, explainOpen: boolean, onToggleExplain: () => void): void {
	renderCard(parent, { title: t("panelWeeklyTitle", lang), value: formatNumber(model.minutes, lang, 0), unit: "min", explain: model.zones ? `${t("panelWeeklyExplain", lang)} ${t("panelHardnessZones", lang)}` : t("panelWeeklyExplain", lang), explainOpen, onToggleExplain, lang }, (card) => {
		if (model.average === null || model.cap === null) {
			card.createDiv({ cls: "ghs-card-note", text: t("panelLoadLocked", lang) });
			return;
		}
		const domain = Math.max(model.cap * 1.25, model.minutes * 1.05, 1);
		const bar = card.createDiv({ cls: "ghs-range ghs-weekly", attr: { role: "img", "aria-label": formatNumber(model.minutes, lang, 0) } });
		const track = bar.createDiv({ cls: "ghs-weekly-track" });
		for (const s of model.segments) {
			track.createDiv({ cls: `ghs-weekly-seg ghs-step-${s.step ?? "none"}` }).setCssProps({ "--ghs-w": `${(s.minutes / domain) * 100}%` });
		}
		const over = bar.createDiv({ cls: "ghs-weekly-over" });
		over.setCssProps({ "--ghs-x": `${(model.cap / domain) * 100}%` });
		bar.createDiv({ cls: "ghs-tick ghs-tick-solid" }).setCssProps({ "--ghs-x": `${(model.average / domain) * 100}%` });
		bar.createDiv({ cls: "ghs-tick ghs-tick-solid ghs-tick-cap" }).setCssProps({ "--ghs-x": `${(model.cap / domain) * 100}%` });
		const labels = bar.createDiv({ cls: "ghs-range-labels" });
		labels.createSpan({ cls: "ghs-tick-label", text: t("panelWeeklyAverage", lang) }).setCssProps({ "--ghs-x": `${(model.average / domain) * 100}%` });
		labels.createSpan({ cls: "ghs-tick-label", text: t("panelWeeklyCap", lang) }).setCssProps({ "--ghs-x": `${(model.cap / domain) * 100}%` });
		const left = Math.round(model.cap - model.minutes);
		const foot = card.createDiv({ cls: "ghs-foot" });
		foot.createSpan({ cls: "ghs-foot-label", text: t("panelWeeklyFoot", lang) });
		foot.createSpan({
			cls: `ghs-foot-value${left < 0 ? " ghs-foot-over" : ""}`,
			text: left < 0 ? t("panelWeeklyOver", lang) : t("panelWeeklyLeft", lang).replace("{min}", formatNumber(left, lang, 0)),
		});
		for (const d of model.distances) distanceRow(card, d, lang, imperial);
		if (model.weeks < CHRONIC_WEEKS) {
			card.createDiv({ cls: "ghs-card-note ghs-card-warning", text: t("panelWeeksBasis", lang).replace("{have}", String(model.weeks)).replace("{need}", String(CHRONIC_WEEKS)) });
		}
	});
}

/** A sport's weekly distance: a bar with the average and the cap, and what is left to the cap. */
function distanceRow(card: HTMLElement, d: WeeklyDistance, lang: string, imperial: boolean): void {
	const unit = imperial ? "mi" : "km";
	const show = (km: number): string => `${formatNumber(imperial ? km / KM_PER_MILE : km, lang, 1)} ${unit}`;
	const domain = Math.max(d.cap * 1.25, d.km * 1.05, 0.1);
	const row = card.createDiv({ cls: "ghs-battery-row" });
	const head = row.createDiv({ cls: "ghs-battery-row-head" });
	head.createSpan({ cls: "ghs-battery-row-label", text: t(d.category === "running" ? "panelCategoryRunning" : "panelCategoryCycling", lang) });
	head.createSpan({ text: show(d.km) });
	const bar = row.createDiv({ cls: "ghs-battery-bar", attr: { role: "img", "aria-label": show(d.km) } });
	bar.createDiv({ cls: "ghs-battery-track" });
	bar.createDiv({ cls: "ghs-battery-fill ghs-distance-fill" }).setCssProps({ "--ghs-x": "0%", "--ghs-w": `${(d.km / domain) * 100}%` });
	bar.createDiv({ cls: "ghs-weekly-over" }).setCssProps({ "--ghs-x": `${(d.cap / domain) * 100}%` });
	bar.createDiv({ cls: "ghs-tick ghs-tick-solid" }).setCssProps({ "--ghs-x": `${(d.average / domain) * 100}%` });
	bar.createDiv({ cls: "ghs-tick ghs-tick-solid ghs-tick-cap" }).setCssProps({ "--ghs-x": `${(d.cap / domain) * 100}%` });
	const foot = row.createDiv({ cls: "ghs-foot" });
	foot.createSpan({ cls: "ghs-foot-label", text: t("panelDistanceBasis", lang).replace("{avg}", show(d.average)).replace("{cap}", show(d.cap)) });
	const left = d.cap - d.km;
	foot.createSpan({
		cls: `ghs-foot-value${left < 0 ? " ghs-foot-over" : ""}`,
		text: left < 0 ? t("panelWeeklyOver", lang) : t("panelDistanceLeft", lang).replace("{km}", show(left)),
	});
}
