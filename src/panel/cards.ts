import type { TranslationKeys } from "../i18n/en";
import { computeBattery, renderBattery } from "./cards/battery-card";
import { computeLoad, renderLoad } from "./cards/load-card";
import { computeBody, renderBody } from "./cards/body-card";
import { computeFloors, renderFloors } from "./cards/floors-card";
import { computeIntensity, renderIntensity } from "./cards/intensity-card";
import { BREATHING_CARD, HRV_CARD, RESTING_HR_CARD, SPO2_CARD, computeRange, renderRange, type RangeCardSpec } from "./cards/range-card";
import { computeSleep, renderSleep } from "./cards/sleep-card";
import { computeSessions, renderSessions } from "./cards/sessions-card";
import { computeStages, renderStages } from "./cards/stages-card";
import { computeSteps, renderSteps } from "./cards/steps-card";
import { computeStress, renderStress } from "./cards/stress-card";
import { computeVo2, renderVo2 } from "./cards/vo2-card";
import { computeWeekly, renderWeekly } from "./cards/weekly-card";
import type { DayIndex } from "./index";

export type SectionId = "recovery" | "sleep" | "energy" | "movement" | "fitness" | "training";

export interface CardContext {
	parent: HTMLElement;
	index: DayIndex;
	date: string;
	lang: string;
	/** The notes use miles and pounds. */
	imperial: boolean;
	/** From the settings, for the heart rate zones. */
	birthYear: number | null;
	explainOpen: boolean;
	onToggleExplain: () => void;
}

export interface PanelCard {
	id: string;
	title: TranslationKeys;
	section: SectionId;
	/** Frontmatter metrics the card reads; the card is empty when none of them is synced. No metrics = always available (activities have no switch). */
	metrics: string[];
	/** Shown at half width next to the next half-width card. */
	half?: boolean;
	render: (ctx: CardContext) => void;
}

const range = (spec: RangeCardSpec, section: SectionId): PanelCard => ({
	id: spec.id,
	title: spec.title,
	section,
	metrics: [spec.key],
	half: spec.half,
	render: (c) => renderRange(c.parent, spec, computeRange(spec, c.index, c.date), c.lang, c.explainOpen, c.onToggleExplain),
});

/** Every card of the panel in display order. Ids are stable: they are stored in the settings. */
export const PANEL_CARDS: PanelCard[] = [
	range(HRV_CARD, "recovery"),
	range(RESTING_HR_CARD, "recovery"),
	range(SPO2_CARD, "recovery"),
	range(BREATHING_CARD, "recovery"),
	{ id: "sleep", title: "panelSleepTitle", section: "sleep", metrics: ["sleep_duration"], render: (c) => renderSleep(c.parent, computeSleep(c.index, c.date), c.lang, c.explainOpen, c.onToggleExplain) },
	{ id: "stages", title: "panelStagesTitle", section: "sleep", metrics: ["sleep_deep", "sleep_rem", "sleep_light", "sleep_awake"], render: (c) => renderStages(c.parent, computeStages(c.index, c.date), c.lang, c.explainOpen, c.onToggleExplain) },
	{ id: "battery", title: "panelBatteryTitle", section: "energy", metrics: ["body_battery_max"], render: (c) => renderBattery(c.parent, computeBattery(c.index, c.date), c.lang, c.explainOpen, c.onToggleExplain) },
	{ id: "stress", title: "panelStressTitle", section: "energy", metrics: ["stress"], render: (c) => renderStress(c.parent, computeStress(c.index, c.date), c.lang, c.explainOpen, c.onToggleExplain) },
	{ id: "steps", title: "panelStepsTitle", section: "movement", metrics: ["steps"], render: (c) => renderSteps(c.parent, computeSteps(c.index, c.date), c.lang, c.explainOpen, c.onToggleExplain) },
	{ id: "intensity", title: "panelIntensityTitle", section: "movement", metrics: ["intensity_min"], render: (c) => renderIntensity(c.parent, computeIntensity(c.index, c.date), c.lang, c.explainOpen, c.onToggleExplain) },
	{ id: "floors", title: "panelFloorsTitle", section: "movement", metrics: ["floors"], render: (c) => renderFloors(c.parent, computeFloors(c.index, c.date), c.lang, c.explainOpen, c.onToggleExplain) },
	{ id: "vo2", title: "panelVo2Title", section: "fitness", metrics: ["vo2_max"], render: (c) => renderVo2(c.parent, computeVo2(c.index, c.date), c.lang, c.explainOpen, c.onToggleExplain) },
	{ id: "body", title: "panelBodyTitle", section: "fitness", metrics: ["weight_kg", "body_fat_pct"], render: (c) => renderBody(c.parent, computeBody(c.index, c.date), c.lang, c.explainOpen, c.onToggleExplain) },
	{ id: "load", title: "panelLoadTitle", section: "training", metrics: [], render: (c) => renderLoad(c.parent, computeLoad(c.index, c.date), c.lang, c.explainOpen, c.onToggleExplain) },
	{ id: "weekly", title: "panelWeeklyTitle", section: "training", metrics: [], render: (c) => renderWeekly(c.parent, computeWeekly(c.index, c.date), c.lang, c.imperial, c.explainOpen, c.onToggleExplain) },
	{ id: "sessions", title: "panelSessionsTitle", section: "training", metrics: [], render: (c) => renderSessions(c.parent, computeSessions(c.index, c.date, c.birthYear), c.lang, c.imperial, c.explainOpen, c.onToggleExplain) },
];

export const SECTION_TITLES: Record<SectionId, TranslationKeys> = {
	recovery: "panelSectionRecovery",
	sleep: "panelSectionSleep",
	energy: "panelSectionEnergy",
	movement: "panelSectionMovement",
	fitness: "panelSectionFitness",
	training: "panelSectionTraining",
};
