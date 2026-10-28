import { t } from "../../i18n/t";
import { localDateString } from "../../dates";
import { formatNumber } from "../format";
import type { DayIndex } from "../index";
import { average } from "../stats";
import { computeTrend, type Trend } from "../trend";
import { longFacts, longView, type LongView } from "../longview";
import { minutesBetween } from "../load";
import { renderCard } from "./shell";
import type { Insight } from "../insights/registry";

/** Days with a logged intake among the 7 before the shown day for a usual intake. */
export const HYDRATION_MIN_DAYS = 3;
const WINDOW_DAYS = 7;
/** The glass the "about n glasses" is counted in. */
export const GLASS_ML = 250;
/** The day's drinking is spread over these waking hours. */
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 22;

export interface HydrationModel {
	/** What the data suggests, filled in by the panel (see insights/). */
	insights: Insight[];
	trend: Trend | null;
	/** Water logged on the day, in ml. */
	intake: number | null;
	/** The goal of the day, or the average goal of the days before when the day has none. */
	goal: number | null;
	/** The average logged intake of the days before, null with fewer than HYDRATION_MIN_DAYS. */
	usual: number | null;
	/** The shown day is today, so the day is not over. */
	today: boolean;
	/** The part of the goal that is due by now when the intake is spread over the waking day, today only. */
	pace: number | null;
	long: LongView | null;
	/** Minutes of training on the day (recovery sessions left out). */
	trained: number;
}

/** The part of the waking day (7:00 to 22:00) that has passed at `now`, 0 to 1. */
export function dayFraction(now: Date): number {
	const hour = now.getHours() + now.getMinutes() / 60;
	return Math.min(1, Math.max(0, (hour - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR)));
}

/** The intake the person aims at on a day: the goal Garmin holds for it, else the average goal of the week before. */
function goalOf(index: DayIndex, date: string): number | null {
	return positive(index.value("hydration_goal_ml", date)) ?? positive(average(index, "hydration_goal_ml", date, WINDOW_DAYS, 1));
}

/** A goal or an average of 0 is nothing to measure against. */
const positive = (n: number | null): number | null => (n !== null && n > 0 ? n : null);

/** How much of the aim a day reached (1 is all of it), or null without an intake or an aim. */
export function hydrationShare(index: DayIndex, date: string): number | null {
	const intake = index.value("hydration_ml", date);
	const aim = goalOf(index, date) ?? positive(average(index, "hydration_ml", date, WINDOW_DAYS, HYDRATION_MIN_DAYS));
	return intake === null || aim === null ? null : intake / aim;
}

export function computeHydration(index: DayIndex, date: string): HydrationModel {
	const now = new Date();
	const today = date === localDateString(now);
	const goal = goalOf(index, date);
	return {
		insights: [],
		trend: computeTrend((d) => index.value("hydration_ml", d), date),
		intake: index.value("hydration_ml", date),
		goal,
		usual: positive(average(index, "hydration_ml", date, WINDOW_DAYS, HYDRATION_MIN_DAYS)),
		today,
		pace: today && goal !== null ? goal * dayFraction(now) : null,
		long: longView((d) => index.value("hydration_ml", d), date),
		trained: minutesBetween(index, date, date),
	};
}

/** Litres with one decimal ("1.8 L"). */
export const litres = (ml: number, lang: string): string => `${formatNumber(ml / 1000, lang, 1)} L`;

/** The numbers of the card that are too much for the card: the goal in glasses and the usual intake. */
function hydrationFacts(model: HydrationModel, lang: string): string[] {
	const facts: string[] = [];
	if (model.goal !== null) facts.push(t("panelHydrationFactGoal", lang).replace("{amount}", litres(model.goal, lang)).replace("{glasses}", String(Math.round(model.goal / GLASS_ML))));
	if (model.usual !== null) facts.push(t("panelHydrationFactUsual", lang).replace("{amount}", litres(model.usual, lang)));
	return [...facts, ...longFacts(model.long, (n) => litres(n, lang), lang)];
}

export function renderHydration(parent: HTMLElement, model: HydrationModel, lang: string, explainOpen: boolean, onToggleExplain: () => void): void {
	const { intake } = model;
	const value = intake === null ? null : formatNumber(intake / 1000, lang, 1);
	renderCard(parent, { title: t("panelHydrationTitle", lang), value, unit: "L", unitKeepCase: true, explain: t("panelHydrationExplain", lang), explainOpen, onToggleExplain, lang, insights: model.insights, facts: hydrationFacts(model, lang), trend: { trend: model.trend, format: (n) => litres(n, lang) } }, (card) => {
		const mark = model.goal ?? model.usual;
		// an intake of 0 is no reading
		if (intake === null || intake <= 0 || mark === null) return;
		const domain = Math.max(mark * 1.25, intake * 1.05);
		const bar = card.createDiv({ cls: "ghs-range ghs-range-labelled ghs-weekly ghs-hydration-bar", attr: { role: "img", "aria-label": `${litres(intake, lang)} / ${litres(mark, lang)}` } });
		bar.createDiv({ cls: "ghs-weekly-track" }).createDiv({ cls: "ghs-weekly-seg" }).setCssProps({ "--ghs-w": `${(intake / domain) * 100}%` });
		bar.createDiv({ cls: "ghs-tick ghs-tick-solid" }).setCssProps({ "--ghs-x": `${(mark / domain) * 100}%` });
		const labels = bar.createDiv({ cls: "ghs-range-labels" });
		labels.createSpan({ cls: "ghs-tick-label", text: `${t(model.goal === null ? "panelHydrationUsual" : "panelHydrationGoal", lang)} ${litres(mark, lang)}` }).setCssProps({ "--ghs-x": `${(mark / domain) * 100}%` });
		// the foot counts what is left to the goal; without a goal there is nothing to reach
		if (model.goal === null) return;
		const left = Math.round(model.goal - intake);
		const foot = card.createDiv({ cls: "ghs-foot" });
		foot.createSpan({ cls: "ghs-foot-label", text: t(model.today ? "panelHydrationFootToday" : "panelHydrationFoot", lang) });
		foot.createSpan({
			cls: `ghs-foot-value${left <= 0 ? " ghs-foot-good" : ""}`,
			text: left <= 0 ? t("panelHydrationDone", lang) : t("panelHydrationToGo", lang).replace("{amount}", litres(left, lang)).replace("{glasses}", String(Math.max(1, Math.round(left / GLASS_ML)))),
		});
	});
}
