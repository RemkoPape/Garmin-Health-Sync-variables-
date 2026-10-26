import type { TranslationKeys } from "../../i18n/en";
import { t } from "../../i18n/t";
import { formatNumber } from "../format";
import type { DayIndex } from "../index";
import { rangeBar } from "../range-bar";
import { renderCard } from "./shell";
import { baseline, windowValues, zScore, type Baseline } from "../stats";

/** Window and days needed for a reliable personal range (spec: about 21 of the last 30). */
export const RANGE_WINDOW_DAYS = 30;
export const RANGE_MIN_DAYS = 21;
/** From this many days on the range is shown, marked as an early estimate (new watch, few days of data). */
export const RANGE_EARLY_MIN_DAYS = 5;

type Tone = "ok" | "warn" | "bad";

/** A card that compares one daily metric with the personal average of the 30 days before the shown day. */
export interface RangeCardSpec {
	id: string;
	/** Frontmatter key, without prefix. */
	key: string;
	title: TranslationKeys;
	explain: TranslationKeys;
	unit: string;
	sided: "both" | "high";
	/** Smallest standard deviation used, so a very stable user does not get a razor-thin band. */
	sdFloor: number;
	tone: (value: number, b: Baseline) => Tone;
}

function twoSided(value: number, b: Baseline): Tone {
	const a = Math.abs(zScore(value, b));
	return a <= 1 ? "ok" : a < 2 ? "warn" : "bad";
}

/** Only a value above the usual is a warning; a lower resting heart rate is fine. */
function highIsBad(value: number, b: Baseline): Tone {
	const delta = value - b.mean;
	const z = zScore(value, b);
	return z > 2 || delta >= 5 ? "bad" : z > 1 || delta >= 3 ? "warn" : "ok";
}

export const HRV_CARD: RangeCardSpec = { id: "hrv", key: "hrv", title: "panelHrvTitle", explain: "panelHrvExplain", unit: "ms", sided: "both", sdFloor: 2, tone: twoSided };
export const RESTING_HR_CARD: RangeCardSpec = { id: "resting_hr", key: "resting_hr", title: "panelRestingHrTitle", explain: "panelRestingHrExplain", unit: "bpm", sided: "high", sdFloor: 1.5, tone: highIsBad };

export interface RangeModel {
	value: number | null;
	/** Days with a reading in the window. */
	have: number;
	baseline: Baseline | null;
	/** The range rests on fewer than RANGE_MIN_DAYS days and is likely inaccurate. */
	early: boolean;
	/** Distance from the personal mean in standard deviations. */
	z: number | null;
}

export function computeRange(spec: RangeCardSpec, index: DayIndex, date: string): RangeModel {
	const values = windowValues(index, spec.key, date, RANGE_WINDOW_DAYS);
	const b = baseline(values, RANGE_EARLY_MIN_DAYS, spec.sdFloor);
	const value = index.value(spec.key, date);
	return { value, have: values.length, baseline: b, early: values.length < RANGE_MIN_DAYS, z: value !== null && b ? zScore(value, b) : null };
}

/** A range card: the day's value against the personal range, with the explanation behind an (i) button. */
export function renderRange(parent: HTMLElement, spec: RangeCardSpec, model: RangeModel, lang: string, explainOpen: boolean, onToggleExplain: () => void): void {
	const value = model.value === null ? null : formatNumber(model.value, lang);
	renderCard(parent, { title: t(spec.title, lang), value, unit: spec.unit, explain: t(spec.explain, lang), explainOpen, onToggleExplain, lang }, (card) => {
		const b = model.baseline;
		if (!b) {
			card.createDiv({
				cls: "ghs-card-note",
				text: t("panelLocked", lang).replace("{need}", String(RANGE_EARLY_MIN_DAYS)).replace("{have}", String(model.have)),
			});
			return;
		}
		const label = t("panelUsualRange", lang)
			.replace("{low}", formatNumber(b.mean - b.sd, lang))
			.replace("{high}", formatNumber(b.mean + b.sd, lang))
			.replace("{unit}", spec.unit);
		if (model.value !== null) {
			rangeBar(card, { value: model.value, mean: b.mean, sd: b.sd, sided: spec.sided, tone: spec.tone(model.value, b), label, lang });
		} else {
			card.createDiv({ cls: "ghs-card-note", text: label });
		}
		if (model.early) {
			card.createDiv({
				cls: "ghs-card-note ghs-card-warning",
				text: t("panelEarly", lang).replace("{have}", String(model.have)).replace("{need}", String(RANGE_MIN_DAYS)),
			});
		}
	});
}
