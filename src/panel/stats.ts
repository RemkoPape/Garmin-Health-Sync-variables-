import { shiftDate } from "../dates";
import type { DayIndex } from "./index";

export interface Baseline {
	mean: number;
	sd: number;
	n: number;
}

/** Valid values of a metric on the `days` days before `date` (a "6h 13min" duration in minutes when `duration`). The shown day never pulls its own baseline. */
export function windowValues(index: DayIndex, key: string, date: string, days: number, duration = false): number[] {
	const out: number[] = [];
	for (let i = 1; i <= days; i++) {
		const day = shiftDate(date, -i);
		const v = duration ? index.minutes(key, day) : index.value(key, day);
		if (v !== null) out.push(v);
	}
	return out;
}

/** Days of the `days` before `date` on which both metrics have a value: what a score built on the two can rest on. */
export function pairedDays(index: DayIndex, keys: [string, string], date: string, days: number): number {
	let n = 0;
	for (let i = 1; i <= days; i++) {
		const day = shiftDate(date, -i);
		if (index.value(keys[0], day) !== null && index.value(keys[1], day) !== null) n++;
	}
	return n;
}

/** From this many values a value that lies far from the rest can be told from the usual spread. */
const MIN_FOR_OUTLIERS = 8;
/** A value this many robust spreads (1.4826 x the median absolute deviation, at least `sdFloor`) from the median is an outlier. */
const OUTLIER_SPREADS = 5;
/** More than this share of the values would have to go: then they are not outliers. */
const MAX_OUTLIER_SHARE = 0.25;

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Mean and standard deviation, or null with fewer than `min` values. A very stable user still gets a band of at least
 * `sdFloor`. With 8 values or more a value far outside the rest (a sensor error, the one day of a fever) is left out of the
 * mean and the spread, because a single such day would widen the range for weeks and move the mean; `n` counts the values used.
 */
export function baseline(values: number[], min: number, sdFloor: number): Baseline | null {
	if (values.length < min) return null;
	let used = values;
	if (values.length >= MIN_FOR_OUTLIERS) {
		const mid = median(values);
		const spread = Math.max(1.4826 * median(values.map((v) => Math.abs(v - mid))), sdFloor);
		const kept = values.filter((v) => Math.abs(v - mid) <= OUTLIER_SPREADS * spread);
		// a quarter or more of the values far from the middle is no handful of freak readings but two kinds of days (a new watch, a changed routine): all of them are the person's own, so none is left out
		if (kept.length >= values.length * (1 - MAX_OUTLIER_SHARE)) used = kept;
	}
	const n = used.length;
	const mean = used.reduce((a, b) => a + b, 0) / n;
	const variance = used.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
	return { mean, sd: Math.max(Math.sqrt(variance), sdFloor), n };
}

export function zScore(x: number, b: Baseline): number {
	return (x - b.mean) / b.sd;
}

/** Mean of the valid values on the `days` days before `date`, or null with fewer than `min`. */
export function average(index: DayIndex, key: string, date: string, days: number, min: number): number | null {
	const values = windowValues(index, key, date, days);
	return values.length < min ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Where `x` ranks among `values` (0 to 1): the values below it plus half of those equal to it, so a value that equals all the others is in the middle, not at the top. */
export function percentileRank(x: number, values: number[]): number {
	// nothing to rank among: the middle, not NaN
	if (values.length === 0) return 0.5;
	const below = values.filter((v) => v < x).length;
	const equal = values.filter((v) => v === x).length;
	return (below + equal / 2) / values.length;
}

/** Least-squares slope of y over x, in y per x; 0 when x does not vary. */
export function slope(points: { x: number; y: number }[]): number {
	const n = points.length;
	const mx = points.reduce((a, p) => a + p.x, 0) / n;
	const my = points.reduce((a, p) => a + p.y, 0) / n;
	const num = points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
	const den = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
	return den === 0 ? 0 : num / den;
}
