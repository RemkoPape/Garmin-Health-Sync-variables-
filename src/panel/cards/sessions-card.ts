import { t } from "../../i18n/t";
import { formatNumber } from "../format";
import type { DayIndex } from "../index";
import { heartRateHistory, intensityStep } from "../load";
import { isRecovery, type Session } from "../sessions";
import { maxHeartRate, zoneOf, type Zone } from "../zones";
import { formatMinutes } from "./sleep-card";
import { renderCard } from "./shell";
import type { Insight } from "../insights/registry";

const KM_PER_MILE = 1.609344;

export interface SessionsModel {
	/** What the data suggests, filled in by the panel (see insights/). */
	insights: Insight[];
	/** Estimated maximum heart rate from the birth year, null when it is not set. */
	maxHr: number | null;
	/** Whether a note exists for the day; without one there is nothing to say. */
	hasDay: boolean;
	sessions: (Session & { step: number | null; recovery: boolean; zone: Zone | null })[];
	location: string | null;
}

export function computeSessions(index: DayIndex, date: string, birthYear: number | null): SessionsModel {
	const history = heartRateHistory(index, date);
	const maxHr = birthYear === null ? null : maxHeartRate(Number(date.slice(0, 4)) - birthYear);
	return {
		insights: [],
		maxHr,
		hasDay: index.hasDay(date),
		sessions: index.sessions(date).map((s) => ({ ...s, step: intensityStep(s, history), recovery: isRecovery(s), zone: maxHr === null || s.avgHr === null ? null : zoneOf(s.avgHr, maxHr) })),
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
	const value = model.hasDay ? formatNumber(total, lang, 0) : null;
	renderCard(parent, { title: t("panelSessionsTitle", lang), value, unit: "min", explain: model.maxHr === null ? t("panelSessionsExplain", lang) : `${t("panelSessionsExplain", lang)} ${t("panelSessionsExplainZones", lang)}`, explainOpen, onToggleExplain, lang, insights: model.insights }, (card) => {
		if (!model.hasDay) return;
		if (model.sessions.length === 0) {
			card.createDiv({ cls: "ghs-card-note", text: t("panelNoSession", lang) });
			return;
		}
		for (const s of model.sessions) {
			// with a birth year the border is the heart rate zone of the average; otherwise how hard it was for you
			const colour = s.zone === null ? (s.step ?? "none") : s.zone === 0 ? "none" : s.zone - 1;
			const tile = card.createDiv({ cls: `ghs-session ${s.recovery ? "ghs-session-recovery" : `ghs-step-border-${colour}`}` });
			const head = tile.createDiv({ cls: "ghs-session-head" });
			head.createSpan({ cls: "ghs-session-type", text: `${label(s.type)}${s.count > 1 ? ` ×${s.count}` : ""}` });
			if (s.recovery) head.createSpan({ cls: "ghs-session-tag", text: t("panelRecovery", lang) });
			else if (s.zone !== null) head.createSpan({ cls: "ghs-session-tag ghs-zone-tag", text: s.zone === 0 ? t("panelZoneBelow", lang) : t("panelZoneN", lang).replace("{n}", String(s.zone)) });
			const facts: string[] = [formatMinutes(s.minutes)];
			if (s.km !== null) facts.push(imperial ? `${formatNumber(s.km / KM_PER_MILE, lang)} mi` : `${formatNumber(s.km, lang)} km`);
			if (s.avgHr !== null) facts.push(t("panelAvgHr", lang).replace("{hr}", String(s.avgHr)));
			if (s.kcal !== null) facts.push(t("panelKcal", lang).replace("{n}", formatNumber(s.kcal, lang, 0)));
			tile.createDiv({ cls: "ghs-session-facts", text: facts.join(" · ") });
			if (s.zone !== null) {
				const bar = tile.createDiv({ cls: "ghs-zonebar", attr: { role: "img", "aria-label": String(s.zone) } });
				for (let z = 1; z <= 5; z++) bar.createDiv({ cls: `ghs-zonebar-part ghs-step-${z - 1}${z === s.zone ? " ghs-zonebar-current" : ""}` });
			}
		}
		if (model.maxHr !== null) {
			card.createDiv({ cls: "ghs-card-note", text: t("panelZonesBasis", lang).replace("{max}", String(model.maxHr)) });
		} else if (model.sessions.some((s) => s.avgHr !== null)) {
			card.createDiv({ cls: "ghs-card-note", text: t("panelZonesHint", lang) });
		}
		if (model.location) card.createDiv({ cls: "ghs-card-note", text: `📍 ${model.location}` });
	});
}
