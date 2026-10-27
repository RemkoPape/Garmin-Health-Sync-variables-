import { t } from "../../i18n/t";
import { shiftDate } from "../../dates";
import { weekdayInitial, weekdayName } from "../format";
import type { DayIndex } from "../index";
import { computeTrend, type Trend } from "../trend";
import { ageAt } from "../zones";
import { renderCard } from "./shell";
import type { Insight } from "../insights/registry";

const NIGHTS = 7;
/** Fewest nights with data before the debt is shown at all. */
export const SLEEP_MIN_NIGHTS = 5;
/** Sleep need of an adult until it can be learned from the user's own history (7 h). */
const ADULT_NEED_MIN = 420;
/** With a birth year: the lower end of the recommended sleep for school children (9 h) and teenagers (8 h). */
const CHILD_NEED_MIN = 540;
const TEEN_NEED_MIN = 480;

/** Minutes of sleep to aim for: 7 hours, more for a child or teenager when the birth year says so. */
function sleepNeed(date: string, birthYear: number | null): number {
	if (birthYear === null) return ADULT_NEED_MIN;
	const age = ageAt(date, birthYear);
	return age < 14 ? CHILD_NEED_MIN : age < 18 ? TEEN_NEED_MIN : ADULT_NEED_MIN;
}
const MAX_CATCH_UP_MIN = 60;
const TARGET_STEP_MIN = 15;
/** However short a person's nights usually are, tonight's aim stays within an hour of the need: 5 h is not a goal. */
const FLOOR_BELOW_NEED_MIN = 60;
/** The extra sleep asked for on top of what the weekday usually brings, at most half an hour. */
const WEEKDAY_CATCH_UP_MIN = 30;
const WEEKDAY_NIGHTS = 8;
const MIN_WEEKDAY_NIGHTS = 3;
/** Nights that say what the person usually sleeps, and how many are needed before that replaces the general need. */
const USUAL_DAYS = 28;
const MIN_USUAL_NIGHTS = 10;

export interface SleepNight {
	date: string;
	/** Time asleep. */
	minutes: number | null;
	/** Bedtime in minutes since midnight, counted past 24:00 after midnight (00:30 is 1470); null without the times. */
	bed: number | null;
	/** Minutes from bedtime to getting up. */
	span: number | null;
}

/** Bedtime and wake-up averages over the nights that have times, with how much they vary. */
export interface SleepSchedule {
	/** Minutes since midnight. */
	bed: number;
	/** The same averages without wrapping past midnight, to compare with a night's own times (see SleepNight.bed). */
	bedAbs: number;
	wakeAbs: number;
	bedSd: number;
	wake: number;
	wakeSd: number;
}

/** From this many nights with times the chart shows when you slept instead of only how long. */
export const SLEEP_MIN_TIMED_NIGHTS = 3;
const DAY = 1440;

export interface SleepModel {
	/** What the data suggests, filled in by the panel (see insights/). */
	insights: Insight[];
	/** Minutes of sleep to aim for. */
	need: number;
	trend: Trend | null;
	/** Null while fewer than SLEEP_MIN_TIMED_NIGHTS nights have a bedtime and wake-up time. */
	schedule: SleepSchedule | null;
	/** The last seven nights, oldest first, the shown day last. */
	nights: SleepNight[];
	/** Last night's sleep in minutes. */
	minutes: number | null;
	score: number | null;
	/** Nights with a duration among the last seven (the shown one included). */
	have: number;
	/** Minutes slept short of the need over those nights, or null while too few nights exist. */
	debt: number | null;
	/** Suggested sleep tonight in minutes. Without a weekday pattern: the need plus a quarter of the debt, at most one hour extra. With one: what that weekday usually brings, held between the floor and the need, plus a quarter of the debt (at most half an hour). */
	target: number | null;
	/** The lowest sleep the card ever asks for: an hour under the need. */
	floor: number;
	/** What the person usually sleeps (median of the last 28 nights), held between the floor and the need; the need itself with too little history. */
	reference: number;
	/** Minutes slept short of the reference over the last 7 nights (the same as debt while the reference is the need). */
	personalDebt: number | null;
	/** How long the nights before the coming weekday usually are (upper end of the last 8), or null with fewer than 3 such nights. */
	weekday: { date: string; typical: number } | null;
}

/** Value at the upper quarter of the list: what the person manages when the night allows it. */
function upperQuarter(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.ceil(0.75 * sorted.length) - 1]!;
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function computeSleep(index: DayIndex, date: string, birthYear: number | null = null): SleepModel {
	const need = sleepNeed(date, birthYear);
	const floor = need - FLOOR_BELOW_NEED_MIN;
	const usual: number[] = [];
	for (let i = 0; i < USUAL_DAYS; i++) {
		const m = index.minutes("sleep_duration", shiftDate(date, -i));
		if (m !== null) usual.push(m);
	}
	const reference = usual.length < MIN_USUAL_NIGHTS ? need : Math.min(need, Math.max(floor, median(usual)));
	// the night that is coming ends on the next date: its weekday's earlier nights are 7, 14, ... days before that
	const tonight = shiftDate(date, 1);
	const sameWeekday: number[] = [];
	for (let k = 1; k <= WEEKDAY_NIGHTS; k++) {
		const m = index.minutes("sleep_duration", shiftDate(tonight, -7 * k));
		if (m !== null) sameWeekday.push(m);
	}
	let have = 0;
	let debt = 0;
	let personalDebt = 0;
	const nights: SleepNight[] = [];
	for (let i = NIGHTS - 1; i >= 0; i--) {
		const day = shiftDate(date, -i);
		const m = index.minutes("sleep_duration", day);
		const start = index.clock("sleep_start", day);
		const end = index.clock("sleep_end", day);
		const timed = start !== null && end !== null;
		// a bedtime before noon belongs to the night after midnight
		nights.push({ date: day, minutes: m, bed: timed ? (start < DAY / 2 ? start + DAY : start) : null, span: timed ? (end - start + DAY) % DAY : null });
		if (m === null) continue;
		have++;
		debt += Math.max(0, need - m);
		personalDebt += Math.max(0, reference - m);
	}
	const ready = have >= SLEEP_MIN_NIGHTS;
	const weekday = sameWeekday.length < MIN_WEEKDAY_NIGHTS ? null : { date: tonight, typical: upperQuarter(sameWeekday) };
	let target: number | null = null;
	if (ready && weekday) {
		const base = Math.min(need, Math.max(floor, weekday.typical));
		target = Math.ceil((base + Math.min(personalDebt / 4, WEEKDAY_CATCH_UP_MIN)) / TARGET_STEP_MIN) * TARGET_STEP_MIN;
	} else if (ready) {
		target = Math.floor((need + Math.min(debt / 4, MAX_CATCH_UP_MIN)) / TARGET_STEP_MIN) * TARGET_STEP_MIN;
	}
	return { insights: [], need, schedule: scheduleOf(nights), trend: computeTrend((d) => index.minutes("sleep_duration", d), date), nights, minutes: index.minutes("sleep_duration", date), score: index.value("sleep_score", date), have, debt: ready ? debt : null, target, floor, reference, personalDebt: ready ? personalDebt : null, weekday };
}

function meanAndSd(values: number[]): { mean: number; sd: number } {
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	return { mean, sd: Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) };
}

function scheduleOf(nights: SleepNight[]): SleepSchedule | null {
	const timed = nights.filter((n) => n.bed !== null && n.span !== null);
	if (timed.length < SLEEP_MIN_TIMED_NIGHTS) return null;
	const bed = meanAndSd(timed.map((n) => n.bed as number));
	const wake = meanAndSd(timed.map((n) => (n.bed as number) + (n.span as number)));
	return { bed: bed.mean % DAY, bedAbs: bed.mean, wakeAbs: wake.mean, bedSd: bed.sd, wake: wake.mean % DAY, wakeSd: wake.sd };
}

/** "07:05" from minutes since midnight. */
export function formatClock(minutes: number): string {
	const m = Math.round(minutes) % DAY;
	return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "7 h 30 min": plain units that read the same in every supported language. */
export function formatMinutes(total: number): string {
	const h = Math.floor(total / 60);
	const m = Math.round(total % 60);
	return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Seven bars, one per night, against a dashed line at the need; the shown night is the light one. */
function durationChart(parent: HTMLElement, nights: SleepNight[], need: number, lang: string): void {
	const top = Math.max(need * 1.2, ...nights.map((n) => n.minutes ?? 0));
	const chart = parent.createDiv({ cls: "ghs-nights" });
	chart.createDiv({ cls: "ghs-nights-need" }).setCssProps({ "--ghs-y": `${(need / top) * 100}%` });
	chart.createSpan({ cls: "ghs-nights-need-label", text: `${need / 60} h` }).setCssProps({ "--ghs-y": `${(need / top) * 100}%` });
	nights.forEach((n, i) => {
		const col = chart.createDiv({ cls: "ghs-night" });
		const bar = col.createDiv({ cls: `ghs-night-bar${i === nights.length - 1 ? " ghs-night-bar-last" : ""}${n.minutes === null ? " ghs-night-bar-missing" : ""}` });
		bar.setCssProps({ "--ghs-h": `${((n.minutes ?? 0) / top) * 100}%` });
		col.createSpan({ cls: "ghs-night-day", text: weekdayInitial(n.date, lang) });
	});
}

/**
 * One column per night on a clock that runs downwards: a faint bar from bedtime to getting up, a solid bar for
 * the time asleep and a dashed box that is the need long from bedtime. A solid bar that stops above the end
 * of the box is a night with too little sleep; where the bars start and end shows how regular the nights are.
 */
function timelineChart(parent: HTMLElement, nights: SleepNight[], need: number, lang: string): void {
	const timed = nights.filter((n) => n.bed !== null && n.span !== null);
	const first = Math.min(...timed.map((n) => n.bed as number)) - 30;
	const last = Math.max(...timed.map((n) => Math.max((n.bed as number) + (n.span as number), (n.bed as number) + need))) + 30;
	const top = Math.floor(first / 60) * 60;
	const range = Math.ceil(last / 60) * 60 - top;
	const chart = parent.createDiv({ cls: "ghs-nights ghs-nights-timeline" });
	chart.createSpan({ cls: "ghs-axis-label ghs-axis-top", text: formatClock(top) });
	chart.createSpan({ cls: "ghs-axis-label ghs-axis-bottom", text: formatClock(top + range) });
	nights.forEach((n, i) => {
		const col = chart.createDiv({ cls: "ghs-night" });
		if (n.bed !== null && n.span !== null) {
			const y = `${((n.bed - top) / range) * 100}%`;
			const place = (el: HTMLElement, minutes: number): void => el.setCssProps({ "--ghs-y": y, "--ghs-h": `${(minutes / range) * 100}%` });
			place(col.createDiv({ cls: "ghs-night-need" }), need);
			place(col.createDiv({ cls: "ghs-night-window" }), n.span);
			place(col.createDiv({ cls: `ghs-night-asleep${i === nights.length - 1 ? " ghs-night-asleep-last" : ""}` }), n.minutes ?? n.span);
		}
		col.createSpan({ cls: "ghs-night-day", text: weekdayInitial(n.date, lang) });
	});
}

export function renderSleep(parent: HTMLElement, model: SleepModel, lang: string, explainOpen: boolean, onToggleExplain: () => void): void {
	const value = model.minutes === null ? null : formatMinutes(model.minutes);
	const unit = model.minutes !== null && model.score !== null ? `· ${Math.round(model.score)}` : undefined;
	renderCard(parent, { title: t("panelSleepTitle", lang), value, unit, explain: [t("panelSleepExplain", lang), ...(model.schedule ? [t("panelSleepExplainTimes", lang)] : []), ...(model.weekday || model.reference < model.need ? [t("panelSleepExplainPersonal", lang)] : [])].join(" ").replace(/\{need\}/g, String(model.need / 60)).replace(/\{floor\}/g, String(model.floor / 60)), explainOpen, onToggleExplain, lang, insights: model.insights, trend: { trend: model.trend, format: (n) => formatMinutes(n) } }, (card) => {
		if (model.debt === null || model.target === null) {
			card.createDiv({
				cls: "ghs-card-note",
				text: t("panelLocked", lang).replace("{need}", String(SLEEP_MIN_NIGHTS)).replace("{have}", String(model.have)),
			});
			return;
		}
		if (model.schedule) timelineChart(card, model.nights, model.need, lang);
		else durationChart(card, model.nights, model.need, lang);
		const personal = model.reference < model.need;
		const owed = model.personalDebt!;
		card.createDiv({
			cls: "ghs-card-note",
			text: (owed === 0 ? t(personal ? "panelSleepNoDebtPersonal" : "panelSleepNoDebt", lang) : t(personal ? "panelSleepDebtPersonal" : "panelSleepDebt", lang).replace("{debt}", formatMinutes(owed))).replace("{usual}", formatMinutes(model.reference)),
		});
		if (model.weekday) {
			card.createDiv({ cls: "ghs-card-note", text: t("panelSleepWeekday", lang).replace("{day}", weekdayName(model.weekday.date, lang)).replace("{typical}", formatMinutes(model.weekday.typical)) });
		}
		if (model.schedule) {
			const sc = model.schedule;
			card.createDiv({
				cls: "ghs-card-note",
				text: t("panelSleepSchedule", lang)
					.replace("{bed}", formatClock(sc.bed))
					.replace("{bedSd}", String(Math.round(sc.bedSd)))
					.replace("{wake}", formatClock(sc.wake))
					.replace("{wakeSd}", String(Math.round(sc.wakeSd))),
			});
		}
		const foot = card.createDiv({ cls: "ghs-foot" });
		foot.createSpan({ cls: "ghs-foot-label", text: t("panelTonight", lang) });
		foot.createSpan({ cls: "ghs-foot-value", text: t("panelSleepTonight", lang).replace("{target}", formatMinutes(model.target)) });
		if (model.have < NIGHTS) {
			card.createDiv({ cls: "ghs-card-note ghs-card-warning", text: t("panelSleepPartial", lang).replace("{have}", String(model.have)) });
		}
	});
}
