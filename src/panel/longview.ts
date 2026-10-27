import { shiftDate } from "../dates";
import { t } from "../i18n/t";

/** The year looked at, and the two windows compared inside it. */
const YEAR_DAYS = 365;
const RECENT_DAYS = 90;
/** Days with a value needed for the year, and for each of the two windows to be compared. */
const MIN_YEAR_VALUES = 60;
const MIN_WINDOW_VALUES = 20;

/** What the last year of a metric looks like, from the history notes and the daily notes together. */
export interface LongView {
	/** Days with a value in the year. */
	days: number;
	avg: number;
	min: number;
	max: number;
	/** Average of the last 90 days and of the 90 days before them; null unless both have enough values. */
	recent: number | null;
	prior: number | null;
}

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

/** The last year up to `date`, or null with fewer than 60 days of values. `read` gives a day's value or null. */
export function longView(read: (day: string) => number | null, date: string): LongView | null {
	const year: number[] = [];
	const recent: number[] = [];
	const prior: number[] = [];
	for (let i = 0; i < YEAR_DAYS; i++) {
		const v = read(shiftDate(date, -i));
		if (v === null) continue;
		year.push(v);
		if (i < RECENT_DAYS) recent.push(v);
		else if (i < 2 * RECENT_DAYS) prior.push(v);
	}
	if (year.length < MIN_YEAR_VALUES) return null;
	const compare = recent.length >= MIN_WINDOW_VALUES && prior.length >= MIN_WINDOW_VALUES;
	return { days: year.length, avg: mean(year), min: Math.min(...year), max: Math.max(...year), recent: compare ? mean(recent) : null, prior: compare ? mean(prior) : null };
}

/** The lines of the year for the box under the light bulb; empty without a long view. `format` writes a value with its unit. */
export function longFacts(view: LongView | null, format: (value: number) => string, lang: string): string[] {
	if (!view) return [];
	const lines = [t("panelLongRange", lang).replace("{n}", String(view.days)).replace("{avg}", format(view.avg)).replace("{min}", format(view.min)).replace("{max}", format(view.max))];
	if (view.recent !== null && view.prior !== null) lines.push(t("panelLongChange", lang).replace("{recent}", format(view.recent)).replace("{prior}", format(view.prior)));
	return lines;
}
