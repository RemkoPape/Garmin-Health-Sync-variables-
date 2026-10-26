import { t } from "../../i18n/t";
import { formatNumber } from "../format";
import type { DayIndex } from "../index";
import { heartRateHistory, intensityStep } from "../load";
import { isRecovery, type Session } from "../sessions";
import { formatMinutes } from "./sleep-card";
import { renderCard } from "./shell";

const KM_PER_MILE = 1.609344;

export interface SessionsModel {
	/** Whether a note exists for the day; without one there is nothing to say. */
	hasNote: boolean;
	sessions: (Session & { step: number | null; recovery: boolean })[];
	location: string | null;
}

export function computeSessions(index: DayIndex, date: string): SessionsModel {
	const history = heartRateHistory(index, date);
	return {
		hasNote: index.hasNote(date),
		sessions: index.sessions(date).map((s) => ({ ...s, step: intensityStep(s, history), recovery: isRecovery(s) })),
		location: index.location(date),
	};
}

/** "mountain_biking" -> "Mountain biking". */
function label(type: string): string {
	const words = type.replace(/_/g, " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

export function renderSessions(parent: HTMLElement, model: SessionsModel, lang: string, imperial: boolean, explainOpen: boolean, onToggleExplain: () => void): void {
	const total = model.sessions.reduce((a, s) => a + s.minutes, 0);
	const value = model.hasNote ? formatNumber(total, lang, 0) : null;
	renderCard(parent, { title: t("panelSessionsTitle", lang), value, unit: "min", explain: t("panelSessionsExplain", lang), explainOpen, onToggleExplain, lang }, (card) => {
		if (!model.hasNote) return;
		if (model.sessions.length === 0) {
			card.createDiv({ cls: "ghs-card-note", text: t("panelNoSession", lang) });
			return;
		}
		for (const s of model.sessions) {
			const tile = card.createDiv({ cls: `ghs-session ${s.recovery ? "ghs-session-recovery" : `ghs-step-border-${s.step ?? "none"}`}` });
			const head = tile.createDiv({ cls: "ghs-session-head" });
			head.createSpan({ cls: "ghs-session-type", text: `${label(s.type)}${s.count > 1 ? ` ×${s.count}` : ""}` });
			if (s.recovery) head.createSpan({ cls: "ghs-session-tag", text: t("panelRecovery", lang) });
			const facts: string[] = [formatMinutes(s.minutes)];
			if (s.km !== null) facts.push(imperial ? `${formatNumber(s.km / KM_PER_MILE, lang)} mi` : `${formatNumber(s.km, lang)} km`);
			if (s.avgHr !== null) facts.push(t("panelAvgHr", lang).replace("{hr}", String(s.avgHr)));
			if (s.kcal !== null) facts.push(t("panelKcal", lang).replace("{n}", formatNumber(s.kcal, lang, 0)));
			tile.createDiv({ cls: "ghs-session-facts", text: facts.join(" · ") });
		}
		if (model.location) card.createDiv({ cls: "ghs-card-note", text: `📍 ${model.location}` });
	});
}
