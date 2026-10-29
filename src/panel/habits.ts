import { shiftDate } from "../dates";
import type { DayIndex } from "./index";
import type { HabitInfo } from "../providers/garmin/lifestyle";
import { baseline, windowValues, type Baseline } from "./stats";

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
/** A counted habit with no day without it is compared by amount: from this many nights with an entry, at this many different amounts. */
export const MIN_DOSE_DAYS = 14;
export const MIN_DISTINCT = 3;
/** The rank correlation of the amount with the night after it must reach this, next to the same t as above. */
const MIN_RHO = 0.3;
/** The smallest spread per measure, so a very steady person does not get razor-thin limits (as in the other cards). */
const SD_FLOOR = { hrv: 2, resting_hr: 1.5 };
/** The mean of the weeks before needs this many days with an entry. */
const MIN_USUAL_ENTRIES = 5;
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
	/** Welch's t, for ranking (for a comparison by amount: the t of the rank correlation). */
	t: number;
	/** The comparison is by amount (a counted habit): `diff` is the change of the night per one more, `with` the nights compared and `without` 0. */
	dose: boolean;
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
	/** Days with the habit in a row up to the shown day (up to the day before when the shown day has no entry yet). */
	streak: number;
	/** Days of the last 90 with an entry, yes or no. */
	logged: number;
	/** The last 7 days: the days with an entry, the days the habit was done, the amount in total and the mean per day with an entry. Null without an entry. */
	week: { entries: number; days: number; total: number; mean: number } | null;
	/** The mean per day with an entry of the 4 weeks before those 7 days, from 5 days with an entry. */
	usual: number | null;
	/** The amount of each of the last 14 days (null: no entry), oldest first. */
	daily: (number | null)[];
	hrv: Effect | null;
	resting_hr: Effect | null;
}

function mean(values: number[]): number {
	return values.reduce((a, b) => a + b, 0) / values.length;
}

function variance(values: number[], m: number): number {
	return values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1);
}

/** What every habit shares: the usual value before a night and the usual spread of a measure, worked out once per night and measure instead of once per habit. */
interface Context {
	usual(measure: Measure, night: string): Baseline | null;
	spread(measure: Measure): number;
}

/** Ranks of the values, equal values sharing the mean of their places. */
function ranks(values: number[]): number[] {
	const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
	const out = new Array<number>(values.length).fill(0);
	for (let start = 0; start < order.length; ) {
		let end = start;
		while (end + 1 < order.length && order[end + 1]!.v === order[start]!.v) end++;
		for (let k = start; k <= end; k++) out[order[k]!.i] = (start + end) / 2 + 1;
		start = end + 1;
	}
	return out;
}

/** How the night after a counted habit changes with the amount, or null with too few nights, or too few different amounts. For a habit that has no days without it, where the two groups cannot be compared. */
function doseOf(ctx: Context, index: DayIndex, measure: Measure, days: { day: string; value: number }[]): Effect | null {
	const x: number[] = [];
	const y: number[] = [];
	for (const { day, value } of days) {
		const night = shiftDate(day, 1);
		const observed = index.value(measure, night);
		const usual = ctx.usual(measure, night);
		if (observed === null || usual === null) continue;
		x.push(value);
		y.push(observed - usual.mean);
	}
	if (x.length < MIN_DOSE_DAYS || new Set(x).size < MIN_DISTINCT) return null;
	// Spearman's rank correlation (counts are skewed and small), its t for the evidence and the plain slope for the size
	const rx = ranks(x);
	const ry = ranks(y);
	const mx = mean(rx);
	const my = mean(ry);
	let sxy = 0;
	let sxx = 0;
	let syy = 0;
	rx.forEach((r, i) => {
		sxy += (r - mx) * (ry[i]! - my);
		sxx += (r - mx) ** 2;
		syy += (ry[i]! - my) ** 2;
	});
	const rho = syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
	// a perfect correlation would divide by zero: the denominator is kept above a tiny floor, so t is large but finite
	const t = rho * Math.sqrt((x.length - 2) / Math.max(1e-9, 1 - rho * rho));
	const meanX = mean(x);
	const meanY = mean(y);
	const slope = x.reduce((sum, v, i) => sum + (v - meanX) * (y[i]! - meanY), 0) / x.reduce((sum, v) => sum + (v - meanX) ** 2, 0);
	const better = measure === "hrv" ? slope > 0 : slope < 0;
	return { dose: true, diff: slope, with: x.length, without: 0, better, share: Math.max(-1, Math.min(1, measure === "hrv" ? rho : -rho)), clear: Math.abs(t) >= MIN_T && Math.abs(rho) >= MIN_RHO, t };
}

/** How the nights after the habit differ from the nights after a day without it, or null without enough days of both. */
function effectOf(ctx: Context, index: DayIndex, measure: Measure, days: { day: string; value: number }[]): Effect | null {
	const withHabit: number[] = [];
	const without: number[] = [];
	for (const { day, value: amount } of days) {
		const on = amount > 0;
		const night = shiftDate(day, 1);
		const value = index.value(measure, night);
		const usual = ctx.usual(measure, night);
		if (value === null || usual === null) continue;
		(on ? withHabit : without).push(value - usual.mean);
	}
	if (withHabit.length < MIN_GROUP || without.length < MIN_GROUP) return null;
	const spread = ctx.spread(measure);
	const mw = mean(withHabit);
	const mo = mean(without);
	const diff = mw - mo;
	const error = Math.sqrt(variance(withHabit, mw) / withHabit.length + variance(without, mo) / without.length);
	const t = error === 0 ? 0 : diff / error;
	const better = measure === "hrv" ? diff > 0 : diff < 0;
	const share = Math.max(-1, Math.min(1, (measure === "hrv" ? diff : -diff) / (2 * spread)));
	return { dose: false, diff, with: withHabit.length, without: without.length, better, share, clear: Math.abs(t) >= MIN_T && Math.abs(diff) >= MIN_SHIFT * spread, t };
}

/**
 * The habits to list: the ones Garmin has sent (their names and last listing are right), and the ones the notes hold that
 * it has not, named from their keys. A habit only the notes know has no last listing, so it takes the latest one of the
 * others: it is dropped by the 30 days without an entry, not by a listing it never had.
 */
export function knownHabits(saved: Record<string, HabitInfo>, inNotes: Record<string, HabitInfo>): Record<string, HabitInfo> {
	const latest = Object.values(saved).reduce((last, h) => (h.last > last ? h.last : last), "");
	const merged: Record<string, HabitInfo> = {};
	for (const [key, habit] of Object.entries(inNotes)) merged[key] = { ...habit, last: latest };
	return { ...merged, ...saved };
}

/**
 * The habits of the lifestyle log with the nights after them. A habit on day D is compared with the HRV and the resting
 * heart rate of day D+1 (the night after it), each against its own usual value of the 4 weeks before that night. Days
 * on which a habit was not logged are left out: an entry that is missing does not say that it was not done. The most
 * recent day compared is the day before the shown one, so a night that has not happened yet never counts.
 */
export function computeHabits(index: DayIndex, date: string, names: Record<string, HabitInfo>): HabitRow[] {
	const rows: HabitRow[] = [];
	const usualCache = new Map<string, Baseline | null>();
	const spreadCache = new Map<Measure, number>();
	const ctx: Context = {
		usual: (measure, night) => {
			const id = `${measure}|${night}`;
			if (!usualCache.has(id)) usualCache.set(id, baseline(windowValues(index, measure, night, USUAL_DAYS), MIN_USUAL, SD_FLOOR[measure]));
			return usualCache.get(id)!;
		},
		// the nights compared lie inside this window and there are at least 16 of them, so the usual spread exists
		spread: (measure) => {
			if (!spreadCache.has(measure)) spreadCache.set(measure, baseline(windowValues(index, measure, date, EFFECT_DAYS + 1), MIN_USUAL, SD_FLOOR[measure])!.sd);
			return spreadCache.get(measure)!;
		},
	};
	// Garmin lists every habit that is set up in the app on every day, so a habit that was last listed before the others has been dropped there
	const newest = Object.values(names).reduce((latest, h) => (h.last > latest ? h.last : latest), "");
	for (const [key, habit] of Object.entries(names)) {
		// a habit Garmin dropped is gone from the days after its last one; the days before it still show it
		if (habit.last < newest && date > habit.last) continue;
		let active = false;
		for (let i = 0; i < ACTIVE_DAYS && !active; i++) active = index.value(key, shiftDate(date, -i)) !== null;
		if (!active) continue;
		const days: { day: string; value: number }[] = [];
		let withDays = 0;
		let withoutDays = 0;
		for (let i = 1; i <= EFFECT_DAYS; i++) {
			const day = shiftDate(date, -i);
			const v = index.value(key, day);
			if (v === null) continue;
			days.push({ day, value: v });
			if (v > 0) withDays++;
			else withoutDays++;
		}
		const strip: Dot[] = [];
		for (let i = STRIP_DAYS - 1; i >= 0; i--) {
			const v = index.value(key, shiftDate(date, -i));
			strip.push(v === null ? "unknown" : v > 0 ? "yes" : "no");
		}
		const today = index.value(key, date);
		let streak = 0;
		for (let i = today === null ? 1 : 0; i <= EFFECT_DAYS; i++) {
			const v = index.value(key, shiftDate(date, -i));
			if (v === null || v <= 0) break;
			streak++;
		}
		let weekEntries = 0;
		let weekDays = 0;
		let weekTotal = 0;
		for (let i = 0; i < 7; i++) {
			const v = index.value(key, shiftDate(date, -i));
			if (v === null) continue;
			weekEntries++;
			weekTotal += v;
			if (v > 0) weekDays++;
		}
		let beforeEntries = 0;
		let beforeTotal = 0;
		for (let i = 7; i < 7 + USUAL_DAYS; i++) {
			const v = index.value(key, shiftDate(date, -i));
			if (v === null) continue;
			beforeEntries++;
			beforeTotal += v;
		}
		const daily: (number | null)[] = [];
		for (let i = STRIP_DAYS - 1; i >= 0; i--) daily.push(index.value(key, shiftDate(date, -i)));
		rows.push({ key, name: habit.name, kind: habit.kind, strip, with: withDays, without: withoutDays, today, streak, logged: withDays + withoutDays + (today === null ? 0 : 1), week: weekEntries === 0 ? null : { entries: weekEntries, days: weekDays, total: weekTotal, mean: weekTotal / weekEntries }, usual: beforeEntries >= MIN_USUAL_ENTRIES ? beforeTotal / beforeEntries : null, daily, hrv: effectOf(ctx, index, "hrv", days) ?? (habit.kind === "count" ? doseOf(ctx, index, "hrv", days) : null), resting_hr: effectOf(ctx, index, "resting_hr", days) ?? (habit.kind === "count" ? doseOf(ctx, index, "resting_hr", days) : null) });
	}
	// habits with a pattern first, the strongest on top; the rest by name
	const strength = (r: HabitRow): number => Math.max(...[r.hrv, r.resting_hr].map((e) => (e?.clear ? Math.abs(e.t) : 0)));
	return rows.sort((a, b) => strength(b) - strength(a) || a.name.localeCompare(b.name));
}
