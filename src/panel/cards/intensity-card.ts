import { t } from "../../i18n/t";
import { shiftDate, weekStart } from "../../dates";
import { formatNumber, weekdayInitial } from "../format";
import type { DayIndex } from "../index";
import { renderCard } from "./shell";

/** WHO guideline: 150 minutes of moderate activity a week. */
export const WEEKLY_GOAL_MIN = 150;

export interface IntensityDay {
	date: string;
	minutes: number | null;
	/** After the shown day: nothing to show yet. */
	future: boolean;
}

export interface IntensityModel {
	/** The shown day. */
	date: string;
	/** Monday to Sunday of the shown day's week. */
	days: IntensityDay[];
	/** Minutes so far this week, up to and including the shown day, or null when no day of the week has a value. */
	total: number | null;
	remaining: number;
	/** Minutes a day over the days still to come, or null on the last day of the week. */
	perDay: number | null;
}

export function computeIntensity(index: DayIndex, date: string): IntensityModel {
	const start = weekStart(date);
	const days: IntensityDay[] = [];
	let total = 0;
	let any = false;
	for (let i = 0; i < 7; i++) {
		const day = shiftDate(start, i);
		const future = day > date;
		const minutes = future ? null : index.value("intensity_min", day);
		if (minutes !== null) {
			total += minutes;
			any = true;
		}
		days.push({ date: day, minutes, future });
	}
	const remaining = Math.max(0, WEEKLY_GOAL_MIN - total);
	const daysLeft = days.filter((d) => d.future).length;
	return { date, days, total: any ? total : null, remaining, perDay: daysLeft === 0 ? null : Math.ceil(remaining / daysLeft) };
}

export function renderIntensity(parent: HTMLElement, model: IntensityModel, lang: string, explainOpen: boolean, onToggleExplain: () => void): void {
	const value = model.total === null ? null : formatNumber(model.total, lang, 0);
	const unit = t("panelIntensityUnit", lang).replace("{goal}", String(WEEKLY_GOAL_MIN));
	renderCard(parent, { title: t("panelIntensityTitle", lang), value, unit, explain: t("panelIntensityExplain", lang), explainOpen, onToggleExplain, lang }, (card) => {
		const top = Math.max(WEEKLY_GOAL_MIN / 7, ...model.days.map((d) => d.minutes ?? 0));
		const perDayHeight = model.perDay === null ? 0 : Math.min(100, (model.perDay / top) * 100);
		const chart = card.createDiv({ cls: "ghs-nights ghs-week" });
		for (const d of model.days) {
			const col = chart.createDiv({ cls: "ghs-night" });
			const classes = ["ghs-night-bar", "ghs-week-bar"];
			if (d.future) classes.push("ghs-week-bar-future");
			else if (d.minutes === null) classes.push("ghs-night-bar-missing");
			if (d.date === model.date) classes.push("ghs-night-bar-last");
			const bar = col.createDiv({ cls: classes.join(" ") });
			bar.setCssProps({ "--ghs-h": d.future ? `${perDayHeight}%` : `${((d.minutes ?? 0) / top) * 100}%` });
			col.createSpan({ cls: "ghs-night-day", text: weekdayInitial(d.date, lang) });
		}
		const foot = card.createDiv({ cls: "ghs-foot" });
		foot.createSpan({ cls: "ghs-foot-label", text: t("panelToWeeklyGoal", lang) });
		const text =
			model.remaining === 0
				? t("panelGoalReached", lang)
				: model.perDay === null
					? t("panelIntensityToGoLastDay", lang).replace("{min}", formatNumber(model.remaining, lang, 0))
					: t("panelIntensityToGo", lang).replace("{min}", formatNumber(model.remaining, lang, 0)).replace("{perDay}", String(model.perDay));
		foot.createSpan({ cls: "ghs-foot-value", text });
	});
}
