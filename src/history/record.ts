import { METRICS } from "../metrics";
import type { HealthData } from "../providers/provider";
import { isActivityEntry } from "../panel/sessions";
import { FETCHED_KEY, type DayRecord } from "./format";

const PREFIX = "ohs_";
const METRIC_KEYS = new Set(METRICS.map((m) => m.key));
/** What a note in imperial units holds instead of kilometres and kilograms. */
const IMPERIAL_KEYS = new Set(["distance_mi", "weight_lbs"]);

/** What a fetched day is kept as: the values as they came from Garmin (metric), the training list always, and which metrics were asked for. */
export function recordFromData(data: HealthData, requested: string[]): DayRecord {
	const record: DayRecord = { ...data.metrics, ...data.activities };
	if (data.trainings && data.trainings.length > 0) record["trainings"] = data.trainings;
	record[FETCHED_KEY] = [...requested].sort();
	return record;
}

/** The part of a daily note's frontmatter that is Garmin data (metrics, activities, training list), or null when there is none. Has no list of requested metrics: it is not known what the note was fetched with. */
export function recordFromNote(frontmatter: Record<string, unknown>): DayRecord | null {
	const record: DayRecord = {};
	for (const [rawKey, value] of Object.entries(frontmatter)) {
		const key = rawKey.startsWith(PREFIX) ? rawKey.slice(PREFIX.length) : rawKey;
		const data = METRIC_KEYS.has(key) || IMPERIAL_KEYS.has(key) ? typeof value === "number" || typeof value === "string" : key === "trainings" ? Array.isArray(value) : isActivityEntry(key, value);
		if (data) record[key] = value;
	}
	return Object.keys(record).length === 0 ? null : record;
}
