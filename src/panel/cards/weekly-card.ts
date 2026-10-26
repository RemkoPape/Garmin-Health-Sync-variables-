import { shiftDate, weekStart } from "../../dates";
import { t } from "../../i18n/t";
import { formatNumber } from "../format";
import type { DayIndex } from "../index";
import { CHRONIC_WEEKS, heartRateHistory, intensityStep, minutesBetween, previousWeeks, type Step } from "../load";
import { isRecovery } from "../sessions";
import { renderCard } from "./shell";

/** Training may grow by at most this much over the average of the previous weeks. */
const CAP_FACTOR = 1.1;

export interface WeekSegment {
	minutes: number;
	step: Step | null;
}

export interface WeeklyModel {
	/** Minutes so far this week, up to and including the shown day. */
	minutes: number;
	/** The sessions of the week so far in order. */
	segments: WeekSegment[];
	/** Previous complete weeks that were used (0 to 4). */
	weeks: number;
	average: number | null;
	cap: number | null;
}

export function computeWeekly(index: DayIndex, date: string): WeeklyModel {
	const start = weekStart(date);
	const history = heartRateHistory(index, date);
	const segments: WeekSegment[] = [];
	for (let day = start; day <= date; day = shiftDate(day, 1)) {
		for (const s of index.sessions(day)) if (!isRecovery(s)) segments.push({ minutes: s.minutes, step: intensityStep(s, history) });
	}
	const previous = previousWeeks(index, date);
	const average = previous.length === 0 ? null : previous.reduce((a, b) => a + b, 0) / previous.length;
	return { minutes: minutesBetween(index, start, date), segments, weeks: previous.length, average, cap: average === null ? null : average * CAP_FACTOR };
}

export function renderWeekly(parent: HTMLElement, model: WeeklyModel, lang: string, explainOpen: boolean, onToggleExplain: () => void): void {
	renderCard(parent, { title: t("panelWeeklyTitle", lang), value: formatNumber(model.minutes, lang, 0), unit: "min", explain: t("panelWeeklyExplain", lang), explainOpen, onToggleExplain, lang }, (card) => {
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
		if (model.weeks < CHRONIC_WEEKS) {
			card.createDiv({ cls: "ghs-card-note ghs-card-warning", text: t("panelWeeksBasis", lang).replace("{have}", String(model.weeks)).replace("{need}", String(CHRONIC_WEEKS)) });
		}
	});
}
