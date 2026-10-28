import { shiftDate } from "../dates";
import type { DayIndex } from "./index";
import { baseline, windowValues } from "./stats";

/** Habits with a logged value on one of this many days up to the shown day are listed; a habit that is not logged any more drops off the card. */
export const ACTIVE_DAYS = 30;
/** The days before the shown day that are compared. */
const EFFECT_DAYS = 90;
/** A difference is only worked out from this many days with the habit and this many without it. */
export const MIN_GROUP = 8;
/** The usual value of a night is the mean of this many days before it, from MIN_USUAL of them. */
const USUAL_DAYS = 28;
const MIN_USUAL = 7;
/** Welch's t of at least this (stricter than 2: several habits and two measures are tested at once) and a difference of at least this share of the usual spread make a pattern. */
const MIN_T = 2.5;
const MIN_SHIFT = 0.3;
/** The smallest spread per measure, so a very steady person does not get razor-thin limits (as in the other cards). */
const SD_FLOOR = { hrv: 2, resting_hr: 1.5 };
/** The days of the dot strip. */
export const STRIP_DAYS = 14;

export type Measure = keyof typeof SD_FLOOR;
export type Dot = "yes" | "no" | "unknown";

export interface Effect {
	/** The night after the habit against the night after a day without it, in the unit of the measure (ms, bpm). */
	diff: number;
	/** Days with the habit, days without it. */
	with: number;
	without: number;
	/** Whether the night after the habit is the better one (higher HRV, lower resting heart rate). */
	better: boolean;
	/** -1 to 1, the difference in usual spreads halved; positive is a better night. */
	share: number;
	/** A pattern: large enough against the day-to-day swing. Otherwise the difference is shown as no clear one. */
	clear: boolean;
	/** Welch's t, for ranking. */
	t: number;
}

export interface HabitRow {
	key: string;
	name: string;
	kind: "check" | "count";
	strip: Dot[];
	/** Days with the habit logged (above 0) and days logged as no, up to the day before the shown one. */
	with: number;
	without: number;
	/** What the habit was on the shown day: null when it was not logged. */
	today: number | null;
	hrv: Effect | null;
	resting_hr: Effect | null;
}

function mean(values: number[]): number {
	return values.reduce((a, b) => a + b, 0) / values.length;
}

function variance(values: number[], m: number): number {
	return values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1);
}

/** How the nights after the habit differ from the nights after a day without it, or null without enough days of both. */
function effectOf(index: DayIndex, measure: Measure, days: { day: string; on: boolean }[], date: string): Effect | null {
	const withHabit: number[] = [];
	const without: number[] = [];
	for (const { day, on } of days) {
		const night = shiftDate(day, 1);
		const value = index.value(measure, night);
		const usual = baseline(windowValues(index, measure, night, USUAL_DAYS), MIN_USUAL, SD_FLOOR[measure]);
		if (value === null || usual === null) continue;
		(on ? withHabit : without).push(value - usual.mean);
	}
	if (withHabit.length < MIN_GROUP || without.length < MIN_GROUP) return null;
	// the nights compared lie inside this window and there are at least 16 of them, so the usual spread exists
	const spread = baseline(windowValues(index, measure, date, EFFECT_DAYS + 1), MIN_USUAL, SD_FLOOR[measure])!.sd;
	const mw = mean(withHabit);
	const mo = mean(without);
	const diff = mw - mo;
	const error = Math.sqrt(variance(withHabit, mw) / withHabit.length + variance(without, mo) / without.length);
	const t = error === 0 ? 0 : diff / error;
	const better = measure === "hrv" ? diff > 0 : diff < 0;
	const share = Math.max(-1, Math.min(1, (measure === "hrv" ? diff : -diff) / (2 * spread)));
	return { diff, with: withHabit.length, without: without.length, better, share, clear: Math.abs(t) >= MIN_T && Math.abs(diff) >= MIN_SHIFT * spread, t };
}

/**
 * The habits of the lifestyle log with the nights after them. A habit on day D is compared with the HRV and the resting
 * heart rate of day D+1 (the night after it), each against its own usual value of the 4 weeks before that night. Days
 * on which a habit was not logged are left out: an entry that is missing does not say that it was not done. The most
 * recent day compared is the day before the shown one, so a night that has not happened yet never counts.
 */
export function computeHabits(index: DayIndex, date: string, names: Record<string, { name: string; kind: "check" | "count" }>): HabitRow[] {
	const rows: HabitRow[] = [];
	for (const [key, habit] of Object.entries(names)) {
		let active = false;
		for (let i = 0; i < ACTIVE_DAYS && !active; i++) active = index.value(key, shiftDate(date, -i)) !== null;
		if (!active) continue;
		const days: { day: string; on: boolean }[] = [];
		let withDays = 0;
		let withoutDays = 0;
		for (let i = 1; i <= EFFECT_DAYS; i++) {
			const day = shiftDate(date, -i);
			const v = index.value(key, day);
			if (v === null) continue;
			days.push({ day, on: v > 0 });
			if (v > 0) withDays++;
			else withoutDays++;
		}
		const strip: Dot[] = [];
		for (let i = STRIP_DAYS - 1; i >= 0; i--) {
			const v = index.value(key, shiftDate(date, -i));
			strip.push(v === null ? "unknown" : v > 0 ? "yes" : "no");
		}
		rows.push({ key, name: habit.name, kind: habit.kind, strip, with: withDays, without: withoutDays, today: index.value(key, date), hrv: effectOf(index, "hrv", days, date), resting_hr: effectOf(index, "resting_hr", days, date) });
	}
	// habits with a pattern first, the strongest on top; the rest by name
	const strength = (r: HabitRow): number => Math.max(...[r.hrv, r.resting_hr].map((e) => (e?.clear ? Math.abs(e.t) : 0)));
	return rows.sort((a, b) => strength(b) - strength(a) || a.name.localeCompare(b.name));
}
