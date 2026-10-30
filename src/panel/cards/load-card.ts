import { shiftDate } from "../../dates";
import { t } from "../../i18n/t";
import type { TranslationKeys } from "../../i18n/en";
import { formatNumber } from "../format";
import type { DayIndex } from "../index";
import { CHRONIC_WEEKS, heartRateHistory, previousWeeks, sessionLoad } from "../load";
import { isRecovery } from "../sessions";
import { maxHrAt } from "../zones";
import { renderCard } from "./shell";
import type { Insight } from "../insights/registry";

const ACUTE_DAYS = 7;
const CHRONIC_DAYS = 28;
/** Days with a note or record needed in the 28 before a ratio is shown. */
const MIN_COVERED_DAYS = 14;
/** The bar spans these ratios; the zone borders sit at 0.8, 1.0, 1.3 and 1.5. */
const DOMAIN_LOW = 0.5;
const DOMAIN_HIGH = 1.8;

export type Zone = 0 | 1 | 2 | 3 | 4;

const ZONES: { upTo: number; name: TranslationKeys }[] = [
	{ upTo: 0.8, name: "panelZoneDetrain" },
	{ upTo: 1.0, name: "panelZoneMaintain" },
	{ upTo: 1.3, name: "panelZoneBuild" },
	{ upTo: 1.5, name: "panelZoneStrain" },
	{ upTo: Infinity, name: "panelZoneOverreach" },
];

export interface LoadModel {
	/** What the data suggests, filled in by the panel (see insights/). */
	insights: Insight[];
	/** Previous complete weeks with enough notes (0 to 4); the card needs one. */
	weeks: number;
	/** Acute (7 days) over chronic (weekly average of 28 days) load; null without chronic load. */
	ratio: number | null;
	zone: Zone | null;
	/** Garmin's own training status, shown as a label only. */
	garmin: string | null;
	/** Session intensity comes from heart rate zones (a birth year is set). */
	zones: boolean;
}

/** "PRODUCTIVE_2" -> "Productive". */
export function garminLabel(status: string): string {
	const words = status.replace(/_\d+$/, "").toLowerCase().replace(/_/g, " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

export function computeLoad(index: DayIndex, date: string, birthYear: number | null = null): LoadModel {
	const maxHr = maxHrAt(birthYear, date);
	const weeks = previousWeeks(index, date).length;
	const history = heartRateHistory(index, date);
	let acute = 0;
	let chronic = 0;
	// days of the 28 that have a note or history record: a window with few of them is not a month of training
	let covered = 0;
	for (let i = 0; i < CHRONIC_DAYS; i++) {
		if (index.hasDay(shiftDate(date, -i))) covered++;
		let day = 0;
		for (const s of index.sessions(shiftDate(date, -i))) if (!isRecovery(s)) day += sessionLoad(s, history, maxHr);
		if (i < ACUTE_DAYS) acute += day;
		chronic += day;
	}
	// the weekly average is taken over the days that are known, not over four weeks that may be half empty
	const weeklyAverage = covered === 0 ? 0 : chronic / (covered / 7);
	const ratio = weeks === 0 || covered < MIN_COVERED_DAYS || weeklyAverage === 0 ? null : acute / weeklyAverage;
	const zone = ratio === null ? null : (ZONES.findIndex((z) => ratio < z.upTo) as Zone);
	const status = index.text("training_status", date);
	return { insights: [], weeks, ratio, zone, garmin: status === null ? null : garminLabel(status), zones: maxHr !== null };
}

const pct = (r: number): number => Math.min(100, Math.max(0, ((r - DOMAIN_LOW) / (DOMAIN_HIGH - DOMAIN_LOW)) * 100));

export function renderLoad(parent: HTMLElement, model: LoadModel, lang: string, explainOpen: boolean, onToggleExplain: () => void): void {
	const value = model.ratio === null ? null : formatNumber(model.ratio, lang, 2);
	renderCard(parent, { title: t("panelLoadTitle", lang), value: model.ratio === null ? undefined : value, explain: model.zones ? `${t("panelLoadExplain", lang)} ${t("panelHardnessZones", lang)}` : t("panelLoadExplain", lang), explainOpen, onToggleExplain, lang, insights: model.insights }, (card) => {
		if (model.weeks === 0) {
			card.createDiv({ cls: "ghs-card-note", text: t("panelLoadLocked", lang) });
			return;
		}
		if (model.ratio === null || model.zone === null) {
			card.createDiv({ cls: "ghs-card-note", text: t("panelLoadStart", lang) });
			return;
		}
		const bar = card.createDiv({ cls: "ghs-range ghs-load-bar", attr: { role: "img", "aria-label": `${formatNumber(model.ratio, lang, 2)} · ${t(ZONES[model.zone]!.name, lang)}` } });
		bar.createDiv({ cls: "ghs-range-track ghs-range-track-load" });
		bar.createDiv({ cls: "ghs-dot ghs-dot-neutral" }).setCssProps({ "--ghs-x": `${pct(model.ratio)}%` });
		const names = card.createDiv({ cls: "ghs-zones" });
		ZONES.forEach((z, i) => names.createSpan({ cls: `ghs-zone-name${i === model.zone ? " ghs-zone-name-current" : ""}`, text: t(z.name, lang) }));
		const foot = card.createDiv({ cls: "ghs-foot" });
		foot.createSpan({ cls: "ghs-foot-label", text: t("panelLoadFoot", lang) });
		if (model.garmin) card.createDiv({ cls: "ghs-card-note", text: t("panelGarminStatus", lang).replace("{status}", model.garmin) });
		if (model.weeks < CHRONIC_WEEKS) {
			card.createDiv({ cls: "ghs-card-note ghs-card-warning", text: t("panelWeeksBasis", lang).replace("{have}", String(model.weeks)).replace("{need}", String(CHRONIC_WEEKS)) });
		}
	});
}

