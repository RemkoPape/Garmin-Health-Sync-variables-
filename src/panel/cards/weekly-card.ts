import { weekStart } from "../../dates";
import { t } from "../../i18n/t";
import { formatNumber } from "../format";
import type { DayIndex } from "../index";
import { CHRONIC_WEEKS, DISTANCE_CATEGORIES, kmBetween, minutesBetween, previousWeeks, previousWeeksKm, type DistanceCategory } from "../load";
import { renderCard } from "./shell";
import type { Insight } from "../insights/registry";

/** Training may grow by at most this much over the average of the previous weeks. */
const CAP_FACTOR = 1.1;

/** The week of a distance sport: kilometres so far against the average of the previous weeks and a cap 10 percent above it. */
export interface WeeklyDistance {
	category: DistanceCategory;
	km: number;
	average: number;
	cap: number;
}

export interface WeeklyModel {
	/** What the data suggests, filled in by the panel (see insights/). */
	insights: Insight[];
	/** Distance of running, cycling, walking, outdoor and swimming, for the sports that have any this week or in the previous weeks. */
	distances: WeeklyDistance[];
	/** Minutes so far this week, up to and including the shown day. */
	minutes: number;
	/** Previous complete weeks that were used (0 to 4). */
	weeks: number;
	average: number | null;
	cap: number | null;
}

export function computeWeekly(index: DayIndex, date: string): WeeklyModel {
	const start = weekStart(date);
	const previous = previousWeeks(index, date);
	const average = previous.length === 0 ? null : previous.reduce((a, b) => a + b, 0) / previous.length;
	const distances: WeeklyDistance[] = [];
	for (const category of DISTANCE_CATEGORIES) {
		const before = previousWeeksKm(index, date, category);
		const km = kmBetween(index, start, date, category);
		const average = before.length === 0 ? 0 : before.reduce((a, b) => a + b, 0) / before.length;
		if (km > 0 || average > 0) distances.push({ category, km, average, cap: average * CAP_FACTOR });
	}
	return { insights: [], distances, minutes: minutesBetween(index, start, date), weeks: previous.length, average, cap: average === null ? null : average * CAP_FACTOR };
}

const KM_PER_MILE = 1.609344;

const CATEGORY_LABELS = { running: "panelCategoryRunning", cycling: "panelCategoryCycling", walking: "panelCategoryWalking", outdoor: "panelCategoryOutdoor", swimming: "panelCategorySwimming" } as const;

export function renderWeekly(parent: HTMLElement, model: WeeklyModel, lang: string, imperial: boolean, explainOpen: boolean, onToggleExplain: () => void): void {
	renderCard(parent, { title: t("panelWeeklyTitle", lang), value: formatNumber(model.minutes, lang, 0), unit: "min", explain: t("panelWeeklyExplain", lang), explainOpen, onToggleExplain, lang, insights: model.insights }, (card) => {
		if (model.average === null || model.cap === null) {
			card.createDiv({ cls: "ghs-card-note", text: t("panelLoadLocked", lang) });
			return;
		}
		const left = Math.round(model.cap - model.minutes);
		weekRow(card, {
			label: t("panelWeeklyMinutes", lang),
			shown: `${formatNumber(model.minutes, lang, 0)} min`,
			value: model.minutes,
			average: model.average,
			cap: model.cap,
			marks: true,
			number: (n) => formatNumber(n, lang, 0),
			over: left < 0,
			leftText: t("panelWeeklyLeft", lang).replace("{min}", formatNumber(left, lang, 0)),
			rowClass: "ghs-weekly-minutes",
			lang,
		});
		for (const d of model.distances) distanceRow(card, d, lang, imperial);
		if (model.weeks < CHRONIC_WEEKS) {
			card.createDiv({ cls: "ghs-card-note ghs-card-warning", text: t("panelWeeksBasis", lang).replace("{have}", String(model.weeks)).replace("{need}", String(CHRONIC_WEEKS)) });
		}
	});
}

/** One bar of the card: a heading with what it measures and its value, the bar with the usual week and the limit labelled, and what is left. Minutes and every sport use it, so they read the same. */
interface WeekRow {
	label: string;
	/** The value with its unit, next to the label. */
	shown: string;
	value: number;
	average: number;
	cap: number;
	/** Without a usual week (a sport started this week) there is nothing to mark. */
	marks: boolean;
	number: (n: number) => string;
	over: boolean;
	leftText: string;
	rowClass: string;
	lang: string;
}

function weekRow(card: HTMLElement, o: WeekRow): void {
	const domain = Math.max(o.cap * 1.25, o.value * 1.05, 0.1);
	const row = card.createDiv({ cls: `ghs-battery-row ${o.rowClass}` });
	const head = row.createDiv({ cls: "ghs-battery-row-head" });
	head.createSpan({ cls: "ghs-battery-row-label", text: o.label });
	head.createSpan({ text: o.shown });
	const bar = row.createDiv({ cls: "ghs-range ghs-range-labelled ghs-weekly", attr: { role: "img", "aria-label": `${o.label} ${o.shown}` } });
	const track = bar.createDiv({ cls: "ghs-weekly-track" });
	track.createDiv({ cls: "ghs-weekly-seg" }).setCssProps({ "--ghs-w": `${(Math.min(o.value, o.cap) / domain) * 100}%` });
	if (o.value > o.cap) track.createDiv({ cls: "ghs-weekly-seg ghs-weekly-seg-over" }).setCssProps({ "--ghs-w": `${((o.value - o.cap) / domain) * 100}%` });
	bar.createDiv({ cls: "ghs-weekly-over" }).setCssProps({ "--ghs-x": `${(o.cap / domain) * 100}%` });
	if (o.marks) {
		bar.createDiv({ cls: "ghs-tick ghs-tick-solid" }).setCssProps({ "--ghs-x": `${(o.average / domain) * 100}%` });
		bar.createDiv({ cls: "ghs-tick ghs-tick-solid ghs-tick-cap" }).setCssProps({ "--ghs-x": `${(o.cap / domain) * 100}%` });
		const labels = bar.createDiv({ cls: "ghs-range-labels" });
		labels.createSpan({ cls: "ghs-tick-label", text: `${t("panelWeeklyAverage", o.lang)} ${o.number(o.average)}` }).setCssProps({ "--ghs-x": `${(o.average / domain) * 100}%` });
		labels.createSpan({ cls: "ghs-tick-label", text: `${t("panelWeeklyCap", o.lang)} ${o.number(o.cap)}` }).setCssProps({ "--ghs-x": `${(o.cap / domain) * 100}%` });
	}
	const foot = row.createDiv({ cls: "ghs-foot" });
	foot.createSpan({ cls: "ghs-foot-label", text: t("panelWeeklyFoot", o.lang) });
	foot.createSpan({ cls: `ghs-foot-value${o.over ? " ghs-foot-over" : ""}`, text: o.over ? t("panelWeeklyOver", o.lang) : o.leftText });
}

/** A sport's weekly distance, drawn like the minutes. */
function distanceRow(card: HTMLElement, d: WeeklyDistance, lang: string, imperial: boolean): void {
	const unit = imperial ? "mi" : "km";
	const num = (km: number): string => formatNumber(imperial ? km / KM_PER_MILE : km, lang, 1);
	weekRow(card, {
		label: t(CATEGORY_LABELS[d.category], lang),
		shown: `${num(d.km)} ${unit}`,
		value: d.km,
		average: d.average,
		cap: d.cap,
		marks: d.average > 0,
		number: num,
		over: d.cap - d.km < 0,
		leftText: t("panelDistanceLeft", lang).replace("{km}", `${num(d.cap - d.km)} ${unit}`),
		rowClass: "ghs-sport-row",
		lang,
	});
}
