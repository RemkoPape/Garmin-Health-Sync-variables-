import { t } from "../../i18n/t";
import { shiftDate, weekStart } from "../../dates";
import { formatNumber, weekdayInitial } from "../format";
import type { DayIndex } from "../index";
import { previousWeekSums } from "../load";
import { ageAt } from "../zones";
import { renderCard } from "./shell";
import type { Insight } from "../insights/registry";

/** The common health guideline: 150 minutes of moderate activity a week. It is the lowest goal, never the highest. */
export const WEEKLY_GOAL_MIN = 150;
/** A person who already does more gets a goal a little above their own average, in steps of 5 minutes. */
const GOAL_STRETCH = 1.1;
const GOAL_STEP_MIN = 5;
/** Children and teenagers are advised 60 minutes a day. */
const YOUTH_GOAL_MIN = 420;
const ADULT_AGE = 18;

export interface IntensityDay {
	date: string;
	minutes: number | null;
	/** After the shown day: nothing to show yet. */
	future: boolean;
}

export interface IntensityModel {
	/** What the data suggests, filled in by the panel (see insights/). */
	insights: Insight[];
	/** The shown day. */
	date: string;
	/** The birth year makes the person under 18, so the goal starts at 60 minutes a day. */
	youth: boolean;
	/** Minutes a week to aim for: 150, or a little above your own average when that is higher. */
	goal: number;
	/** Previous weeks the goal was based on when it is above 150, otherwise 0. */
	goalWeeks: number;
	/** Monday to Sunday of the shown day's week. */
	days: IntensityDay[];
	/** Minutes so far this week, up to and including the shown day, or null when no day of the week has a value. */
	total: number | null;
	remaining: number;
	/** Minutes a day over the days still to come, or null on the last day of the week. */
	perDay: number | null;
}

export function computeIntensity(index: DayIndex, date: string, birthYear: number | null = null): IntensityModel {
	const youth = birthYear !== null && ageAt(date, birthYear) < ADULT_AGE;
	const floor = youth ? YOUTH_GOAL_MIN : WEEKLY_GOAL_MIN;
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
	const before = previousWeekSums(index, date, "intensity_min");
	const average = before.length === 0 ? 0 : before.reduce((a, b) => a + b, 0) / before.length;
	const goal = Math.max(floor, Math.ceil((average * GOAL_STRETCH) / GOAL_STEP_MIN) * GOAL_STEP_MIN);
	const remaining = Math.max(0, goal - total);
	const daysLeft = days.filter((d) => d.future).length;
	return { insights: [], date, youth, goal, goalWeeks: goal > floor ? before.length : 0, days, total: any ? total : null, remaining, perDay: daysLeft === 0 ? null : Math.ceil(remaining / daysLeft) };
}

export function renderIntensity(parent: HTMLElement, model: IntensityModel, lang: string, explainOpen: boolean, onToggleExplain: () => void): void {
	const value = model.total === null ? null : formatNumber(model.total, lang, 0);
	const unit = t("panelIntensityUnit", lang).replace("{goal}", String(model.goal));
	renderCard(parent, { title: t("panelIntensityTitle", lang), value, unit, explain: t(model.youth ? "panelIntensityExplainYouth" : "panelIntensityExplain", lang), explainOpen, onToggleExplain, lang, insights: model.insights }, (card) => {
		const top = Math.max(model.goal / 7, ...model.days.map((d) => d.minutes ?? 0));
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
		foot.createSpan({ cls: `ghs-foot-value${model.remaining === 0 ? " ghs-foot-good" : ""}`, text });
		if (model.goalWeeks > 0) card.createDiv({ cls: "ghs-card-note", text: t(model.youth ? "panelIntensityGoalPersonalYouth" : "panelIntensityGoalPersonal", lang).replace("{n}", String(model.goalWeeks)) });
	});
}
