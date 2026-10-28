import { t } from "../../i18n/t";
import { formatNumber, formatSigned } from "../format";
import type { DayIndex } from "../index";
import { MIN_GROUP, computeHabits, type Dot, type Effect, type HabitRow, type Measure } from "../habits";
import type { Insight } from "../insights/registry";
import { renderCard } from "./shell";

export interface HabitsModel {
	/** What the data suggests, filled in by the panel (see insights/). */
	insights: Insight[];
	habits: HabitRow[];
}

export function computeHabitsCard(index: DayIndex, date: string, names: Record<string, { name: string; kind: "check" | "count" }>): HabitsModel {
	return { insights: [], habits: computeHabits(index, date, names) };
}

const UNITS: Record<Measure, string> = { hrv: "ms", resting_hr: "bpm" };

/** One bar from the middle: right is a better night, green for a clear pattern, orange for a clear worse one, grey without. */
function effectRow(parent: HTMLElement, label: string, measure: Measure, effect: Effect, lang: string): void {
	const tone = !effect.clear ? "flat" : effect.better ? "good" : "bad";
	const row = parent.createDiv({ cls: "ghs-habit-effect" });
	row.createSpan({ cls: "ghs-habit-effect-label", text: label });
	const bar = row.createDiv({ cls: "ghs-habit-bar", attr: { role: "img", "aria-label": `${label} ${formatSigned(effect.diff, lang, 0)} ${UNITS[measure]}` } });
	const width = Math.abs(effect.share) * 50;
	bar.createDiv({ cls: `ghs-habit-fill ghs-habit-fill-${tone} ${effect.share >= 0 ? "ghs-habit-fill-right" : "ghs-habit-fill-left"}` }).setCssProps({ "--ghs-w": `${width}%` });
	row.createSpan({ cls: `ghs-habit-value ghs-habit-value-${tone}`, text: `${formatSigned(effect.diff, lang, 0)} ${UNITS[measure]}` });
}

function strip(parent: HTMLElement, dots: Dot[]): void {
	const el = parent.createDiv({ cls: "ghs-habit-strip" });
	for (const dot of dots) el.createSpan({ cls: `ghs-habit-dot ghs-habit-dot-${dot}` });
}

function habitRow(parent: HTMLElement, row: HabitRow, lang: string): void {
	const el = parent.createDiv({ cls: "ghs-habit" });
	const head = el.createDiv({ cls: "ghs-habit-head" });
	head.createSpan({ cls: "ghs-habit-name", text: row.name });
	head.createSpan({ cls: "ghs-habit-note", text: t("panelHabitsCounts", lang).replace("{n}", String(row.with)).replace("{m}", String(row.without)) });
	strip(el, row.strip);
	if (row.hrv === null && row.resting_hr === null) {
		el.addClass("ghs-habit-thin");
		el.createDiv({ cls: "ghs-habit-note", text: t("panelHabitsThin", lang).replace(/\{min\}/g, String(MIN_GROUP)).replace("{n}", String(row.with)).replace("{m}", String(row.without)) });
		return;
	}
	if (row.hrv) effectRow(el, t("panelHabitsHrv", lang), "hrv", row.hrv, lang);
	if (row.resting_hr) effectRow(el, t("panelHabitsRhr", lang), "resting_hr", row.resting_hr, lang);
}

export function renderHabits(parent: HTMLElement, model: HabitsModel, lang: string, explainOpen: boolean, onToggleExplain: () => void): void {
	renderCard(parent, { title: t("panelHabitsTitle", lang), value: undefined, explain: t("panelHabitsExplain", lang), explainOpen, onToggleExplain, lang, insights: model.insights }, (card) => {
		if (model.habits.length === 0) {
			card.createDiv({ cls: "ghs-card-note", text: t("panelHabitsEmpty", lang) });
			return;
		}
		card.createDiv({ cls: "ghs-habit-note", text: t("panelHabitsSub", lang) });
		const logged = model.habits.filter((h) => h.today !== null);
		if (logged.length > 0) {
			const tags = card.createDiv({ cls: "ghs-habit-tags" });
			for (const h of logged) {
				const on = h.today! > 0;
				const tag = tags.createSpan({ cls: "ghs-habit-tag" });
				tag.createSpan({ cls: on ? "ghs-habit-yes" : "ghs-habit-no", text: on ? "✓" : "✗" });
				tag.createSpan({ text: ` ${h.name}` });
				if (h.kind === "count" && on) tag.createEl("b", { text: ` ×${formatNumber(h.today!, lang, 0)}` });
			}
		}
		for (const h of model.habits) habitRow(card, h, lang);
		const legend = card.createDiv({ cls: "ghs-habit-legend" });
		for (const [dot, key] of [["yes", "panelHabitsLogged"], ["no", "panelHabitsNo"], ["unknown", "panelHabitsNotLogged"]] as const) {
			const item = legend.createSpan();
			item.createSpan({ cls: `ghs-habit-dot ghs-habit-dot-${dot}` });
			item.createSpan({ text: ` ${t(key, lang)}` });
		}
		legend.createSpan({ text: t("panelHabitsBarsHint", lang) });
	});
}
