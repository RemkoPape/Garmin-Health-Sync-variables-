/** Age range in which a birth year is believed; anything else is treated as not set. */
const MIN_AGE = 10;
const MAX_AGE = 100;

/** The birth year as a usable number, or null for a blank, a non-number or an unlikely age. */
export function parseBirthYear(input: unknown, currentYear: number): number | null {
	const n = typeof input === "number" ? input : typeof input === "string" && /^\d{4}$/.test(input.trim()) ? Number(input.trim()) : NaN;
	return Number.isInteger(n) && currentYear - n >= MIN_AGE && currentYear - n <= MAX_AGE ? n : null;
}

/** Estimated maximum heart rate by Tanaka (208 - 0.7 x age), which fits adults better than 220 - age. */
export function maxHeartRate(age: number): number {
	return Math.round(208 - 0.7 * age);
}

/** Heart rate zone 0 (below 50 percent of the maximum) to 5 (90 percent and above). */
export type Zone = 0 | 1 | 2 | 3 | 4 | 5;

export function zoneOf(heartRate: number, max: number): Zone {
	const p = heartRate / max;
	return p < 0.5 ? 0 : p < 0.6 ? 1 : p < 0.7 ? 2 : p < 0.8 ? 3 : p < 0.9 ? 4 : 5;
}
