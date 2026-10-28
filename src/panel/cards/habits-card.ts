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

/** The line that says where a habit stands: days logged and the run of days with it. */
function meta(row: HabitRow, lang: string): string {
	const parts = [t("panelHabitsDays", lang).replace("{n}", String(row.logged))];
	if (row.streak >= 2) parts.push(t("panelHabitsStreak", lang).replace("{n}", String(row.streak)));
	return parts.join(" · ");
}

function habitRow(parent: HTMLElement, row: HabitRow, lang: string): void {
	const el = parent.createDiv({ cls: "ghs-habit" });
	const head = el.createDiv({ cls: "ghs-habit-head" });
	const name = head.createSpan({ cls: "ghs-habit-name" });
	// what the day has: a tick, a cross, or nothing before it was logged; a counted habit shows its amount
	if (row.today !== null) name.createSpan({ cls: row.today > 0 ? "ghs-habit-yes" : "ghs-habit-no", text: row.today > 0 ? "✓ " : "✗ " });
	name.createSpan({ text: row.name });
	if (row.kind === "count" && row.today !== null && row.today > 0) name.createEl("b", { text: ` ×${formatNumber(row.today, lang, 0)}` });
	head.createSpan({ cls: "ghs-habit-note", text: meta(row, lang) });
	strip(el, row.strip);
	if (row.hrv === null && row.resting_hr === null) {
		el.createDiv({ cls: "ghs-habit-note", text: t("panelHabitsProgress", lang).replace(/\{min\}/g, String(MIN_GROUP)).replace("{n}", String(Math.min(row.with, MIN_GROUP))).replace("{m}", String(Math.min(row.without, MIN_GROUP))) });
		return;
	}
	if (row.hrv) effectRow(el, t("panelHabitsHrv", lang), "hrv", row.hrv, lang);
	if (row.resting_hr) effectRow(el, t("panelHabitsRhr", lang), "resting_hr", row.resting_hr, lang);
}

/** What does not fit on the card: the counts behind every habit. */
function facts(habits: HabitRow[], lang: string): string[] {
	const out: string[] = [];
	for (const h of habits) {
		out.push(t("panelHabitsFactDays", lang).replace("{habit}", h.name).replace("{n}", String(h.logged)).replace("{yes}", String(h.with + (h.today !== null && h.today > 0 ? 1 : 0))).replace("{no}", String(h.without + (h.today === 0 ? 1 : 0))));
		if (h.kind === "count" && h.week) out.push(t("panelHabitsFactWeek", lang).replace("{habit}", h.name).replace("{mean}", formatNumber(h.week.mean, lang, 1)).replace("{total}", formatNumber(h.week.total, lang, 0)).replace("{days}", String(h.week.days)));
	}
	return out;
}

export function renderHabits(parent: HTMLElement, model: HabitsModel, lang: string, explainOpen: boolean, onToggleExplain: () => void): void {
	renderCard(parent, { title: t("panelHabitsTitle", lang), value: undefined, explain: t("panelHabitsExplain", lang), facts: facts(model.habits, lang), explainOpen, onToggleExplain, lang, insights: model.insights }, (card) => {
		if (model.habits.length === 0) {
			card.createDiv({ cls: "ghs-card-note", text: t("panelHabitsEmpty", lang) });
			return;
		}
		for (const h of model.habits) habitRow(card, h, lang);
		const legend = card.createDiv({ cls: "ghs-habit-legend" });
		for (const [dot, key] of [["yes", "panelHabitsLogged"], ["no", "panelHabitsNo"], ["unknown", "panelHabitsNotLogged"]] as const) {
			const item = legend.createSpan();
			item.createSpan({ cls: `ghs-habit-dot ghs-habit-dot-${dot}` });
			item.createSpan({ text: ` ${t(key, lang)}` });
		}
		if (model.habits.some((h) => h.hrv || h.resting_hr)) legend.createSpan({ text: t("panelHabitsBarsHint", lang) });
	});
}
