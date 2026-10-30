/** What one day holds: the same keys the sync writes into a daily note's frontmatter, without the prefix and in metric units. */
export type DayRecord = Record<string, unknown>;

/** Key under which a record lists the metrics that were requested when it was fetched (sorted). Imported records have none. */
export const FETCHED_KEY = "_m";

const LINE = /^(\d{4}-\d{2}-\d{2}) (\{.*\})\s*$/;

/** JSON with the keys of every object sorted, so the same data always gives the same text and two devices never fight over key order. */
function stable(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
	if (typeof value === "object" && value !== null) {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : 1));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

export function sameRecord(a: DayRecord, b: DayRecord): boolean {
	return stable(a) === stable(b);
}

/** Key by key, the incoming value wins; the lists of requested metrics are joined. */
export function mergeRecord(base: DayRecord | undefined, incoming: DayRecord): DayRecord {
	if (!base) return { ...incoming };
	const merged = { ...base, ...incoming };
	const a = base[FETCHED_KEY];
	const b = incoming[FETCHED_KEY];
	if (Array.isArray(a) && Array.isArray(b)) merged[FETCHED_KEY] = [...new Set([...(a as string[]), ...(b as string[])])].sort();
	return merged;
}

/**
 * The days of a month note. Every line that is `YYYY-MM-DD {json}` counts; anything else (the heading, a sync
 * conflict marker, a line damaged by hand) is ignored, so reading never fails. A date that appears twice is merged.
 */
export function parseMonth(text: string): Map<string, DayRecord> {
	const days = new Map<string, DayRecord>();
	for (const line of text.split("\n")) {
		const match = LINE.exec(line);
		if (!match) continue;
		let parsed: DayRecord;
		try {
			// the line pattern lets only {...} through, so a successful parse is always an object
			parsed = JSON.parse(match[2]!) as DayRecord;
		} catch {
			continue;
		}
		days.set(match[1]!, mergeRecord(days.get(match[1]!), parsed));
	}
	return days;
}

/** The note of one month: a marker property, one explanatory line and the days, oldest first, one JSON line each. */
export function serializeMonth(month: string, days: Map<string, DayRecord>): string {
	const lines = [...days.keys()].sort().map((date) => `${date} ${stable(days.get(date))}`);
	return [
		"---",
		"garmin-history: 1",
		"---",
		`Written by Garmin Health Sync: one line per day of ${month} with the values fetched from Garmin. The panel reads it when a daily note is missing or lacks a value. Safe to sync; edits may be overwritten.`,
		"",
		"```garmin-history",
		...lines,
		"```",
		"",
	].join("\n");
}
