import { t } from "../../i18n/t";
import { shiftDate } from "../../dates";
import { weekdayInitial } from "../format";
import type { DayIndex } from "../index";
import { computeTrend, type Trend } from "../trend";
import { renderCard } from "./shell";

const NIGHTS = 7;
/** Fewest nights with data before the debt is shown at all. */
export const SLEEP_MIN_NIGHTS = 5;
/** Sleep need until it can be learned from the user's own history (7 h). */
const NEED_MIN = 420;
const MAX_CATCH_UP_MIN = 60;
const TARGET_STEP_MIN = 15;

export interface SleepNight {
	date: string;
	minutes: number | null;
}

export interface SleepModel {
	trend: Trend | null;
	/** The last seven nights, oldest first, the shown day last. */
	nights: SleepNight[];
	/** Last night's sleep in minutes. */
	minutes: number | null;
	score: number | null;
	/** Nights with a duration among the last seven (the shown one included). */
	have: number;
	/** Minutes slept short of the need over those nights, or null while too few nights exist. */
	debt: number | null;
	/** Suggested sleep tonight in minutes: the need plus a quarter of the debt, at most one hour extra. */
	target: number | null;
}

export function computeSleep(index: DayIndex, date: string): SleepModel {
	let have = 0;
	let debt = 0;
	const nights: SleepNight[] = [];
	for (let i = NIGHTS - 1; i >= 0; i--) {
		const day = shiftDate(date, -i);
		const m = index.minutes("sleep_duration", day);
		nights.push({ date: day, minutes: m });
		if (m === null) continue;
		have++;
		debt += Math.max(0, NEED_MIN - m);
	}
	const ready = have >= SLEEP_MIN_NIGHTS;
	const target = ready ? Math.floor((NEED_MIN + Math.min(debt / 4, MAX_CATCH_UP_MIN)) / TARGET_STEP_MIN) * TARGET_STEP_MIN : null;
	return { trend: computeTrend((d) => index.minutes("sleep_duration", d), date), nights, minutes: index.minutes("sleep_duration", date), score: index.value("sleep_score", date), have, debt: ready ? debt : null, target };
}

/** "7 h 30 min": plain units that read the same in every supported language. */
export function formatMinutes(total: number): string {
	const h = Math.floor(total / 60);
	const m = Math.round(total % 60);
	return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Seven bars, one per night, against a dashed line at the need; the shown night is the light one. */
function nightsChart(parent: HTMLElement, nights: SleepNight[], lang: string): void {
	const top = Math.max(NEED_MIN * 1.2, ...nights.map((n) => n.minutes ?? 0));
	const chart = parent.createDiv({ cls: "ghs-nights" });
	chart.createDiv({ cls: "ghs-nights-need" }).setCssProps({ "--ghs-y": `${(NEED_MIN / top) * 100}%` });
	chart.createSpan({ cls: "ghs-nights-need-label", text: `${NEED_MIN / 60} h` }).setCssProps({ "--ghs-y": `${(NEED_MIN / top) * 100}%` });
	nights.forEach((n, i) => {
		const col = chart.createDiv({ cls: "ghs-night" });
		const bar = col.createDiv({ cls: `ghs-night-bar${i === nights.length - 1 ? " ghs-night-bar-last" : ""}${n.minutes === null ? " ghs-night-bar-missing" : ""}` });
		bar.setCssProps({ "--ghs-h": `${((n.minutes ?? 0) / top) * 100}%` });
		col.createSpan({ cls: "ghs-night-day", text: weekdayInitial(n.date, lang) });
	});
}

export function renderSleep(parent: HTMLElement, model: SleepModel, lang: string, explainOpen: boolean, onToggleExplain: () => void): void {
	const value = model.minutes === null ? null : formatMinutes(model.minutes);
	const unit = model.minutes !== null && model.score !== null ? `· ${Math.round(model.score)}` : undefined;
	renderCard(parent, { title: t("panelSleepTitle", lang), value, unit, explain: t("panelSleepExplain", lang), explainOpen, onToggleExplain, lang, trend: { trend: model.trend, format: (n) => formatMinutes(n) } }, (card) => {
		if (model.debt === null || model.target === null) {
			card.createDiv({
				cls: "ghs-card-note",
				text: t("panelLocked", lang).replace("{need}", String(SLEEP_MIN_NIGHTS)).replace("{have}", String(model.have)),
			});
			return;
		}
		nightsChart(card, model.nights, lang);
		card.createDiv({
			cls: "ghs-card-note",
			text: model.debt === 0 ? t("panelSleepNoDebt", lang) : t("panelSleepDebt", lang).replace("{debt}", formatMinutes(model.debt)),
		});
		card.createDiv({ cls: "ghs-card-action", text: t("panelSleepTonight", lang).replace("{target}", formatMinutes(model.target)) });
		if (model.have < NIGHTS) {
			card.createDiv({ cls: "ghs-card-note ghs-card-warning", text: t("panelSleepPartial", lang).replace("{have}", String(model.have)) });
		}
	});
}
