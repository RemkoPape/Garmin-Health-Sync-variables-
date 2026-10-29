import { setIcon } from "obsidian";
import { t } from "../../i18n/t";
import { formatNumber, formatSigned } from "../format";
import type { HabitInfo } from "../../providers/garmin/lifestyle";
import type { DayIndex } from "../index";
import { MIN_GROUP, computeHabits, type Dot, type Effect, type HabitRow, type Measure } from "../habits";
import { habitInsights } from "../insights/lifestyle";
import { renderCard } from "./shell";

export interface HabitsModel {
	/** The habits that are shown as rows. */
	habits: HabitRow[];
	/** The habits the user hid: they are shown as small squares at the bottom, and left out of the light bulb. */
	hidden: HabitRow[];
}

export function computeHabitsCard(index: DayIndex, date: string, names: Record<string, HabitInfo>, hiddenKeys: string[] = []): HabitsModel {
	const rows = computeHabits(index, date, names);
	return { habits: rows.filter((r) => !hiddenKeys.includes(r.key)), hidden: rows.filter((r) => hiddenKeys.includes(r.key)) };
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

/** A week's mean this much above or below the weeks before gets an arrow. */
const TREND_SHARE = 0.15;

/** How the week stands: the mean a day of a counted habit (with an arrow against the weeks before), the days of the week for a yes or no habit, and the run of days with it. */
function meta(row: HabitRow, lang: string): string {
	const parts: string[] = [];
	if (row.kind === "count" && row.week) {
		const arrow = row.usual === null ? "" : row.week.mean >= row.usual * (1 + TREND_SHARE) ? " ↑" : row.week.mean <= row.usual * (1 - TREND_SHARE) ? " ↓" : "";
		parts.push(`${t("panelHabitsMean", lang).replace("{mean}", formatNumber(row.week.mean, lang, 1))}${arrow}`);
	} else if (row.week) parts.push(t("panelHabitsWeekDays", lang).replace("{n}", String(row.week.days)));
	if (row.streak >= 2) parts.push(t("panelHabitsStreak", lang).replace("{n}", String(row.streak)));
	return parts.join(" · ");
}

/** The amount of each of the last days as small columns, for a counted habit. */
function columns(parent: HTMLElement, daily: (number | null)[]): void {
	const top = Math.max(1, ...daily.map((v) => v ?? 0));
	const el = parent.createDiv({ cls: "ghs-habit-columns" });
	for (const v of daily) {
		const col = el.createSpan({ cls: `ghs-habit-col${v === null ? " ghs-habit-col-unknown" : v === 0 ? " ghs-habit-col-zero" : ""}` });
		if (v !== null && v > 0) col.setCssProps({ "--ghs-h": `${Math.max(12, (v / top) * 100)}%` });
	}
}

/** How close the comparison is to the days it needs, as a thin bar. */
function progress(parent: HTMLElement, row: HabitRow): void {
	const share = (Math.min(row.with, MIN_GROUP) + Math.min(row.without, MIN_GROUP)) / (2 * MIN_GROUP);
	const bar = parent.createDiv({ cls: "ghs-habit-progress", attr: { role: "img", "aria-label": `${Math.min(row.with, MIN_GROUP)}/${MIN_GROUP} · ${Math.min(row.without, MIN_GROUP)}/${MIN_GROUP}` } });
	bar.createDiv({ cls: "ghs-habit-progress-fill" }).setCssProps({ "--ghs-w": `${share * 100}%` });
}

function habitRow(parent: HTMLElement, row: HabitRow, lang: string, hide: (key: string, hide: boolean) => void): void {
	const el = parent.createDiv({ cls: "ghs-habit" });
	const head = el.createDiv({ cls: "ghs-habit-head" });
	const name = head.createSpan({ cls: "ghs-habit-name" });
	// what the day has: a tick, a cross, or nothing before it was logged; a counted habit shows its amount
	if (row.today !== null) name.createSpan({ cls: row.today > 0 ? "ghs-habit-yes" : "ghs-habit-no", text: row.today > 0 ? "✓ " : "✗ " });
	name.createSpan({ text: row.name });
	if (row.kind === "count" && row.today !== null && row.today > 0) name.createEl("b", { text: ` ×${formatNumber(row.today, lang, 0)}` });
	head.createSpan({ cls: "ghs-habit-note", text: meta(row, lang) });
	// hiding is done here, not in the settings: the habit goes to a small square at the bottom of the card
	const label = t("panelHabitsHide", lang).replace("{habit}", row.name);
	const button = head.createEl("button", { cls: "clickable-icon ghs-habit-hide", attr: { "aria-label": label, title: label } });
	setIcon(button, "eye-off");
	button.addEventListener("click", () => hide(row.key, true));
	if (row.kind === "count") columns(el, row.daily);
	else strip(el, row.strip);
	if (row.hrv === null && row.resting_hr === null) {
		progress(el, row);
		return;
	}
	if (row.hrv) effectRow(el, t("panelHabitsHrv", lang), "hrv", row.hrv, lang);
	if (row.resting_hr) effectRow(el, t("panelHabitsRhr", lang), "resting_hr", row.resting_hr, lang);
}

/** What does not fit on the card: the counts behind a habit. */
function factsOf(h: HabitRow, lang: string): string[] {
	const out = [t("panelHabitsFactDays", lang).replace("{habit}", h.name).replace("{n}", String(h.logged)).replace("{yes}", String(h.with + (h.today !== null && h.today > 0 ? 1 : 0))).replace("{no}", String(h.without + (h.today === 0 ? 1 : 0)))];
	if (h.kind === "count" && h.week) {
		out.push(t("panelHabitsFactWeek", lang).replace("{habit}", h.name).replace("{mean}", formatNumber(h.week.mean, lang, 1)).replace("{total}", formatNumber(h.week.total, lang, 0)));
		if (h.usual !== null) out.push(t("panelHabitsFactUsual", lang).replace("{habit}", h.name).replace("{usual}", formatNumber(h.usual, lang, 1)));
	}
	if (h.hrv === null && h.resting_hr === null) out.push(t("panelHabitsProgress", lang).replace("{habit}", h.name).replace(/\{min\}/g, String(MIN_GROUP)).replace("{n}", String(h.with)).replace("{m}", String(h.without)));
	return out;
}

/** The first letters of the first word of each name: one letter, and two or three only for the habits whose shorter label another habit shares. */
export function squareLabels(names: string[]): string[] {
	const words = names.map((n) => Array.from(n.trim().split(/[\s/·–-]+/)[0]!));
	const prefix = (word: string[], length: number): string => word.slice(0, length).join("").toUpperCase();
	return words.map((word) => {
		for (let length = 1; length < 3; length++) {
			const label = prefix(word, length);
			if (words.filter((w) => prefix(w, length) === label).length === 1) return label;
		}
		return prefix(word, 3);
	});
}

/** The state of a habit on the shown day, for the colour of its square and for its label: yes, no, or not logged. */
function state(row: HabitRow): Dot {
	return row.today === null ? "unknown" : row.today > 0 ? "yes" : "no";
}

/** The hidden habits as small squares in the colour of their day; a tap shows the habit again. */
function hiddenSquares(card: HTMLElement, hidden: HabitRow[], lang: string, hide: (key: string, hide: boolean) => void): void {
	const box = card.createDiv({ cls: "ghs-habit-hidden" });
	box.createSpan({ cls: "ghs-habit-note", text: t("panelHabitsHiddenHint", lang) });
	const squares = box.createDiv({ cls: "ghs-habit-squares" });
	const states = { yes: "panelHabitsLogged", no: "panelHabitsNo", unknown: "panelHabitsNotLogged" } as const;
	const letters = squareLabels(hidden.map((r) => r.name));
	hidden.forEach((row, i) => {
		const label = `${t("panelHabitsShow", lang).replace("{habit}", row.name)} · ${t(states[state(row)], lang)}`;
		const square = squares.createEl("button", { cls: `ghs-habit-square ghs-habit-square-${state(row)}`, text: letters[i], attr: { "aria-label": label, title: label } });
		square.addEventListener("click", () => hide(row.key, false));
	});
}

export function renderHabits(parent: HTMLElement, model: HabitsModel, lang: string, explainOpen: boolean, onToggleExplain: () => void, hide: (key: string, hide: boolean) => void): void {
	renderCard(parent, { title: t("panelHabitsTitle", lang), value: undefined, explain: t("panelHabitsExplain", lang), groups: model.habits.map((h) => ({ title: h.name, insights: habitInsights(h, lang), facts: factsOf(h, lang) })), explainOpen, onToggleExplain, lang, insights: [] }, (card) => {
		if (model.habits.length === 0 && model.hidden.length === 0) {
			card.createDiv({ cls: "ghs-card-note", text: t("panelHabitsEmpty", lang) });
			return;
		}
		for (const h of model.habits) habitRow(card, h, lang, hide);
		if (model.habits.length > 0) {
			const legend = card.createDiv({ cls: "ghs-habit-legend" });
			for (const [dot, key] of [["yes", "panelHabitsLogged"], ["no", "panelHabitsNo"], ["unknown", "panelHabitsNotLogged"]] as const) {
				const item = legend.createSpan();
				item.createSpan({ cls: `ghs-habit-dot ghs-habit-dot-${dot}` });
				item.createSpan({ text: ` ${t(key, lang)}` });
			}
			if (model.habits.some((h) => h.hrv || h.resting_hr)) legend.createSpan({ text: t("panelHabitsBarsHint", lang) });
		}
		if (model.hidden.length > 0) hiddenSquares(card, model.hidden, lang, hide);
	});
}
