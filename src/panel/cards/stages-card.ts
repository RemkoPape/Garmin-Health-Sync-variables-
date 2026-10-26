import type { TranslationKeys } from "../../i18n/en";
import { t } from "../../i18n/t";
import { formatMinutes } from "./sleep-card";
import type { DayIndex } from "../index";
import { baseline, windowValues, zScore, type Baseline } from "../stats";
import { renderCard } from "./shell";

export const STAGES_MIN_NIGHTS = 14;
const WINDOW_DAYS = 30;
const SD_FLOOR_MIN = 8;

type StageId = "deep" | "rem" | "light" | "awake";

interface StageSpec {
	id: StageId;
	key: string;
	label: TranslationKeys;
	/** The deviation that matters: "low" for deep and REM, "high" for awake. */
	flag: "low" | "high" | null;
	action: TranslationKeys | null;
}

const STAGES: StageSpec[] = [
	{ id: "deep", key: "sleep_deep", label: "panelStageDeep", flag: "low", action: "panelStagesDeepLow" },
	{ id: "rem", key: "sleep_rem", label: "panelStageRem", flag: "low", action: "panelStagesRemLow" },
	{ id: "light", key: "sleep_light", label: "panelStageLight", flag: null, action: null },
	{ id: "awake", key: "sleep_awake", label: "panelStageAwake", flag: "high", action: "panelStagesAwakeHigh" },
];

export interface StageModel {
	spec: StageSpec;
	minutes: number;
	baseline: Baseline | null;
	/** Distance from the usual amount, in standard deviations and minutes; null without a baseline. */
	deviation: { z: number; minutes: number } | null;
}

export interface StagesModel {
	/** Null when the night has no stage data. */
	stages: StageModel[] | null;
	/** The stage whose deviation to the usual is worth an action, if any. */
	flagged: StageModel | null;
}

export function computeStages(index: DayIndex, date: string): StagesModel {
	const stages: StageModel[] = [];
	for (const spec of STAGES) {
		const minutes = index.minutes(spec.key, date);
		if (minutes === null) continue;
		const b = baseline(windowValues(index, spec.key, date, WINDOW_DAYS, true), STAGES_MIN_NIGHTS, SD_FLOOR_MIN);
		stages.push({ spec, minutes, baseline: b, deviation: b ? { z: zScore(minutes, b), minutes: Math.round(minutes - b.mean) } : null });
	}
	// the most deviant stage in the direction that matters, beyond one standard deviation
	const badness = (s: StageModel): number => (s.deviation === null || s.spec.flag === null ? 0 : s.spec.flag === "low" ? -s.deviation.z : s.deviation.z);
	let flagged: StageModel | null = null;
	for (const s of stages) if (badness(s) > 1 && (flagged === null || badness(s) > badness(flagged))) flagged = s;
	return { stages: stages.length === STAGES.length ? stages : null, flagged };
}

export function renderStages(parent: HTMLElement, model: StagesModel, lang: string, explainOpen: boolean, onToggleExplain: () => void): void {
	renderCard(parent, { title: t("panelStagesTitle", lang), value: model.stages === null ? null : undefined, explain: t("panelStagesExplain", lang), explainOpen, onToggleExplain, lang }, (card) => {
		if (model.stages === null) return;
		const total = model.stages.reduce((a, s) => a + s.minutes, 0);
		const stack = card.createDiv({ cls: "ghs-stack", attr: { role: "img" } });
		for (const s of model.stages) stack.createDiv({ cls: `ghs-stack-part ghs-stage-${s.spec.id}` }).setCssProps({ "--ghs-w": `${(s.minutes / total) * 100}%` });
		for (const s of model.stages) {
			const row = card.createDiv({ cls: "ghs-stage-row" });
			row.createSpan({ cls: "ghs-stage-label", text: t(s.spec.label, lang) });
			const track = row.createDiv({ cls: "ghs-stage-track" });
			// the personal mean sits in the middle; the track runs from 0 to twice the mean
			const top = s.baseline ? s.baseline.mean * 2 : Math.max(s.minutes * 2, 1);
			track.createDiv({ cls: `ghs-stage-fill ghs-stage-${s.spec.id}` }).setCssProps({ "--ghs-w": `${Math.min(100, (s.minutes / top) * 100)}%` });
			if (s.baseline) track.createDiv({ cls: "ghs-stage-mean" });
			const value = row.createSpan({ cls: "ghs-stage-value", text: formatMinutes(s.minutes) });
			if (s.deviation && Math.abs(s.deviation.z) > 1) {
				const delta = s.deviation.minutes;
				value.createSpan({ cls: "ghs-chip-delta ghs-chip-delta-down", text: ` · ${delta < 0 ? "−" : "+"}${Math.abs(delta)}` });
			}
		}
		if (model.flagged?.spec.action) {
			const foot = card.createDiv({ cls: "ghs-foot" });
			foot.createSpan({ cls: "ghs-foot-label", text: t("panelTonight", lang) });
			foot.createSpan({ cls: "ghs-foot-value", text: t(model.flagged.spec.action, lang) });
		}
	});
}
