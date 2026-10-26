import { t } from "../../i18n/t";
import { shiftDate } from "../../dates";
import { formatNumber } from "../format";
import type { DayIndex } from "../index";
import { renderCard } from "./shell";

const NIGHTS = 7;
/** Fewest nights with data before the debt is shown at all. */
export const SLEEP_MIN_NIGHTS = 5;
/** Sleep need until it can be learned from the user's own history (7 h). */
const NEED_MIN = 420;
const MAX_CATCH_UP_MIN = 60;
const TARGET_STEP_MIN = 15;

export interface SleepModel {
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
	for (let i = 0; i < NIGHTS; i++) {
		const m = index.minutes("sleep_duration", shiftDate(date, -i));
		if (m === null) continue;
		have++;
		debt += Math.max(0, NEED_MIN - m);
	}
	const ready = have >= SLEEP_MIN_NIGHTS;
	const target = ready ? Math.floor((NEED_MIN + Math.min(debt / 4, MAX_CATCH_UP_MIN)) / TARGET_STEP_MIN) * TARGET_STEP_MIN : null;
	return { minutes: index.minutes("sleep_duration", date), score: index.value("sleep_score", date), have, debt: ready ? debt : null, target };
}

/** "7 h 30 min": plain units that read the same in every supported language. */
export function formatMinutes(total: number): string {
	const h = Math.floor(total / 60);
	const m = Math.round(total % 60);
	return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function renderSleep(parent: HTMLElement, model: SleepModel, lang: string, explainOpen: boolean, onToggleExplain: () => void): void {
	const value = model.minutes === null ? null : formatMinutes(model.minutes);
	renderCard(parent, { title: t("panelSleepTitle", lang), value, explain: t("panelSleepExplain", lang), explainOpen, onToggleExplain, lang }, (card) => {
		if (model.debt === null || model.target === null) {
			card.createDiv({
				cls: "ghs-card-note",
				text: t("panelLocked", lang).replace("{need}", String(SLEEP_MIN_NIGHTS)).replace("{have}", String(model.have)),
			});
			return;
		}
		card.createDiv({
			cls: "ghs-card-note",
			text: model.debt === 0 ? t("panelSleepNoDebt", lang) : t("panelSleepDebt", lang).replace("{debt}", formatMinutes(model.debt)),
		});
		card.createDiv({ cls: "ghs-card-action", text: t("panelSleepTonight", lang).replace("{target}", formatMinutes(model.target)) });
		if (model.have < NIGHTS) {
			card.createDiv({ cls: "ghs-card-note ghs-card-warning", text: t("panelSleepPartial", lang).replace("{have}", String(model.have)) });
		}
		if (model.score !== null) {
			card.createDiv({ cls: "ghs-card-note", text: t("panelSleepScore", lang).replace("{score}", formatNumber(model.score, lang)) });
		}
	});
}
