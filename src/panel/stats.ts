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

/** Mean and standard deviation, or null with fewer than `min` values. A very stable user still gets a band of at least `sdFloor`. */
export function baseline(values: number[], min: number, sdFloor: number): Baseline | null {
	const n = values.length;
	if (n < min) return null;
	const mean = values.reduce((a, b) => a + b, 0) / n;
	const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
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
