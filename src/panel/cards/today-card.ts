import { t } from "../../i18n/t";
import type { TranslationKeys } from "../../i18n/en";
import { formatNumber } from "../format";
import type { Insight } from "../insights/registry";
import { Signals } from "../insights/signals";
import { windowValues } from "../stats";
import type { DayIndex } from "../index";
import { computeBattery } from "./battery-card";
import { computeStress } from "./stress-card";
import { renderCard } from "./shell";

/** Days of HRV, resting heart rate and sleep needed for an own score, and for a reliable one. */
export const TODAY_MIN_DAYS = 5;
export const TODAY_RELIABLE_DAYS = 21;

export type FlagId = "hrv" | "rhr" | "sleep" | "battery" | "stress" | "breathing" | "spo2" | "load";
export type Verdict = "hard" | "planned" | "easy" | "rest";
/** 0 poor (0-24), 1 low (25-49), 2 moderate (50-74), 3 high (75-94), 4 prime (95-100). */
export type Band = 0 | 1 | 2 | 3 | 4;

const BANDS: { upTo: number; name: TranslationKeys }[] = [
	{ upTo: 25, name: "panelBandPoor" },
	{ upTo: 50, name: "panelBandLow" },
	{ upTo: 75, name: "panelBandModerate" },
	{ upTo: 95, name: "panelBandHigh" },
	{ upTo: Infinity, name: "panelBandPrime" },
];

/** What the flags found, for the interpretation: the sleep debt, how far the battery peak fell short, the load spike. */
export interface TodayFacts {
	debt: number | null;
	batteryGap: number | null;
	loadRatio: number | null;
}

export interface TodayModel {
	insights: Insight[];
	/** Own readiness score from 0 to 100, null while HRV, resting heart rate or sleep are missing. */
	score: number | null;
	band: Band | null;
	verdict: Verdict | null;
	flags: FlagId[];
	facts: TodayFacts;
	/** Garmin's own readiness for the day, if the watch provides it. */
	garmin: number | null;
	/** The fewest days of HRV and resting heart rate and nights of sleep, for the unlock message. */
	have: number;
	/** Days of both HRV and resting heart rate in the last 30 days. */
	baselineDays: number;
	/** The score rests on fewer than TODAY_RELIABLE_DAYS days of HRV and resting heart rate. */
	early: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Own readiness: 50 + 12 z(HRV) - 10 z(resting heart rate) - 6 h sleep debt (at most 4 h) + 0.25 (battery peak - usual), 0 to 100.
 * The two z terms are scaled by `trust`, which is below 1 while the usual range rests on fewer than 21 days: a young
 * range is noisy, so a far-out value should not push the score as hard.
 */
function scoreOf(hrvZ: number, rhrZ: number, debtMin: number, peakGap: number | null, trust: number): number {
	const raw = 50 + trust * (12 * clamp(hrvZ, -2.5, 2.5) - 10 * clamp(rhrZ, -2.5, 2.5)) - 6 * Math.min(debtMin / 60, 4) + (peakGap === null ? 0 : 0.25 * peakGap);
	return Math.round(clamp(raw, 0, 100));
}

/** The verdict follows the band and the number of flags; a pair of raised breathing and resting heart rate means rest. A low band alone means rest only once the usual range is reliable. */
function verdictOf(band: Band, flags: FlagId[], early: boolean): Verdict {
	if (flags.length >= 3 || (flags.includes("breathing") && flags.includes("rhr"))) return "rest";
	if (band <= 1) return early ? "easy" : "rest";
	if (band >= 3) return flags.length === 0 ? "hard" : flags.length === 1 ? "planned" : "easy";
	return flags.length === 0 ? "planned" : "easy";
}

export function computeToday(index: DayIndex, date: string, birthYear: number | null): TodayModel {
	const s = new Signals(index, date, birthYear);
	const sleep = s.sleep();
	const battery = computeBattery(index, date);
	const stress = computeStress(index, date);
	const hrvZ = s.z("hrv");
	const rhrZ = s.z("resting_hr");
	const baselineDays = Math.min(windowValues(index, "hrv", date, 30).length, windowValues(index, "resting_hr", date, 30).length);
	const loadRatio = s.load().ratio;
	const batteryGap = battery.max !== null && battery.usualPeak !== null ? battery.usualPeak - battery.max : null;
	// the debt is counted against the usual sleep of the person, not against the general need, which a person who never reaches it would owe every day
	const debt = sleep.personalDebt;
	const facts: TodayFacts = { debt, batteryGap, loadRatio };

	const flags: FlagId[] = [];
	if (hrvZ !== null && hrvZ < -1) flags.push("hrv");
	if (rhrZ !== null && rhrZ > 1) flags.push("rhr");
	if (debt !== null && debt > 120) flags.push("sleep");
	if (batteryGap !== null && batteryGap > 15) flags.push("battery");
	if (stress.level !== null && stress.week !== null && stress.level > stress.week + 10) flags.push("stress");
	if ((s.z("respiration_rate") ?? 0) > 1.5) flags.push("breathing");
	const spo2 = index.value("spo2", date);
	if (spo2 !== null && spo2 < 94) flags.push("spo2");
	if (loadRatio !== null && loadRatio > 1.5) flags.push("load");

	const garmin = index.value("training_readiness", date);
	const early = baselineDays < TODAY_RELIABLE_DAYS;
	const trust = Math.min(1, baselineDays / TODAY_RELIABLE_DAYS);
	const score = hrvZ !== null && rhrZ !== null && debt !== null ? scoreOf(hrvZ, rhrZ, debt, battery.usualPeak !== null && battery.max !== null ? battery.max - battery.usualPeak : null, trust) : null;
	const band = score === null ? null : ((BANDS.findIndex((b) => score < b.upTo) as Band));
	return { insights: [], score, band, verdict: band === null ? null : verdictOf(band, flags, early), flags, facts, garmin, have: Math.min(baselineDays, sleep.have), baselineDays, early };
}

const VERDICT_TEXT: Record<Verdict, TranslationKeys> = { hard: "panelVerdictHard", planned: "panelVerdictPlanned", easy: "panelVerdictEasy", rest: "panelVerdictRest" };

export function renderToday(parent: HTMLElement, model: TodayModel, lang: string, explainOpen: boolean, onToggleExplain: () => void): void {
	const own = model.score !== null && model.band !== null;
	const value = own ? String(model.score) : model.garmin !== null ? formatNumber(model.garmin, lang, 0) : undefined;
	const unit = own ? t(BANDS[model.band!]!.name, lang) : model.garmin !== null ? "Garmin" : undefined;
	renderCard(parent, { title: t("panelTodayTitle", lang), value, unit, explain: t("panelTodayExplain", lang), explainOpen, onToggleExplain, lang, insights: model.insights }, (card) => {
		if (!own) {
			card.createDiv({
				cls: "ghs-card-note",
				text: model.garmin !== null ? t("panelTodayBridge", lang) : model.have >= TODAY_MIN_DAYS ? t("panelTodayWaiting", lang) : t("panelLocked", lang).replace("{need}", String(TODAY_MIN_DAYS)).replace("{have}", String(model.have)),
			});
			return;
		}
		card.addClass(`ghs-card-verdict-${model.verdict}`);
		card.createDiv({ cls: "ghs-verdict", text: t(VERDICT_TEXT[model.verdict!], lang) });
		const bar = card.createDiv({ cls: "ghs-range ghs-readiness-bar", attr: { role: "img", "aria-label": `${model.score}` } });
		bar.createDiv({ cls: "ghs-range-track ghs-range-track-readiness" });
		bar.createDiv({ cls: "ghs-dot ghs-dot-neutral" }).setCssProps({ "--ghs-x": `${model.score}%` });
		if (model.garmin !== null) {
			const foot = card.createDiv({ cls: "ghs-foot" });
			foot.createSpan({ cls: "ghs-foot-label", text: t("panelTodayGarmin", lang) });
			foot.createSpan({ cls: "ghs-foot-value", text: formatNumber(model.garmin, lang, 0) });
		}
		if (model.early) {
			card.createDiv({ cls: "ghs-card-note ghs-card-warning", text: t("panelEarly", lang).replace("{have}", String(model.baselineDays)).replace("{need}", String(TODAY_RELIABLE_DAYS)) });
		}
	});
}
