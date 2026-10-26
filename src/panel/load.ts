import { shiftDate, weekStart } from "../dates";
import type { DayIndex } from "./index";
import { isRecovery, type Session } from "./sessions";
import { percentileRank } from "./stats";

/** Intensity steps, easy to hard, from where a session's heart rate ranks among the user's recent sessions. */
export type Step = 0 | 1 | 2 | 3 | 4;
const STEP_FACTORS = [0.6, 0.8, 1.0, 1.2, 1.4];
const HISTORY_DAYS = 90;
const MAX_HISTORY = 90;
/** Sessions with a heart rate needed before intensity is shown at all. */
export const MIN_SESSIONS_FOR_INTENSITY = 10;
/** A previous week counts when at least this many of its days have a note. */
const MIN_NOTES_PER_WEEK = 4;
export const CHRONIC_WEEKS = 4;

/** The heart rates of the last 90 non-recovery sessions before `date`, for ranking. */
export function heartRateHistory(index: DayIndex, date: string): number[] {
	const out: number[] = [];
	for (let i = 1; i <= HISTORY_DAYS && out.length < MAX_HISTORY; i++) {
		for (const s of index.sessions(shiftDate(date, -i))) {
			if (!isRecovery(s) && s.avgHr !== null) out.push(s.avgHr);
		}
	}
	return out;
}

/** The intensity step of a session, or null without a heart rate or with too little history. */
export function intensityStep(session: Session, history: number[]): Step | null {
	if (session.avgHr === null || isRecovery(session) || history.length < MIN_SESSIONS_FOR_INTENSITY) return null;
	const p = percentileRank(session.avgHr, history);
	return p < 0.2 ? 0 : p < 0.4 ? 1 : p < 0.6 ? 2 : p < 0.8 ? 3 : 4;
}

/** Minutes times the factor of the session's intensity (1.0 while intensity is unknown). */
export function sessionLoad(session: Session, history: number[]): number {
	const step = intensityStep(session, history);
	return session.minutes * (step === null ? 1 : STEP_FACTORS[step]!);
}

/** Minutes of non-recovery sessions from `from` to `to`, both included. */
export function minutesBetween(index: DayIndex, from: string, to: string): number {
	let total = 0;
	for (let day = from; day <= to; day = shiftDate(day, 1)) {
		for (const s of index.sessions(day)) if (!isRecovery(s)) total += s.minutes;
	}
	return total;
}

/** Monday of each of the previous complete weeks (up to four, nearest first) that have enough notes to be trusted. */
function previousWeekStarts(index: DayIndex, date: string): string[] {
	const thisWeek = weekStart(date);
	const out: string[] = [];
	for (let i = 1; i <= CHRONIC_WEEKS; i++) {
		const start = shiftDate(thisWeek, -7 * i);
		let notes = 0;
		for (let d = 0; d < 7; d++) if (index.hasNote(shiftDate(start, d))) notes++;
		if (notes >= MIN_NOTES_PER_WEEK) out.push(start);
	}
	return out;
}

/** Minutes of each of the previous complete weeks that have enough notes, nearest first. */
export function previousWeeks(index: DayIndex, date: string): number[] {
	return previousWeekStarts(index, date).map((start) => minutesBetween(index, start, shiftDate(start, 6)));
}

/** Sports whose weekly distance is tracked next to the minutes. */
export const DISTANCE_CATEGORIES = ["running", "cycling"] as const;
export type DistanceCategory = (typeof DISTANCE_CATEGORIES)[number];

/** Kilometres of one category from `from` to `to`, both included. */
export function kmBetween(index: DayIndex, from: string, to: string, category: DistanceCategory): number {
	let total = 0;
	for (let day = from; day <= to; day = shiftDate(day, 1)) {
		for (const s of index.sessions(day)) if (s.category === category && s.km !== null) total += s.km;
	}
	return total;
}

/** Kilometres of one category in each of the previous complete weeks that have enough notes. */
export function previousWeeksKm(index: DayIndex, date: string, category: DistanceCategory): number[] {
	return previousWeekStarts(index, date).map((start) => kmBetween(index, start, shiftDate(start, 6), category));
}

/** The sum of a numeric metric in each of the previous complete weeks that have enough notes, nearest first. */
export function previousWeekSums(index: DayIndex, date: string, key: string): number[] {
	return previousWeekStarts(index, date).map((start) => {
		let sum = 0;
		for (let d = 0; d < 7; d++) sum += index.value(key, shiftDate(start, d)) ?? 0;
		return sum;
	});
}
