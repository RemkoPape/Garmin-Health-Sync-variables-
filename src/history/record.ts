import { METRICS } from "../metrics";
import type { HealthData } from "../providers/provider";
import { LIFESTYLE_PREFIX } from "../providers/garmin/lifestyle";
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

/** The keys (without prefix) of a daily note's frontmatter that the sync wrote: the Garmin values, the activities, the training list and the workout place. */
export function garminKeys(frontmatter: Record<string, unknown>): Set<string> {
	const keys = new Set(Object.keys(recordFromNote(frontmatter) ?? {}));
	for (const key of Object.keys(frontmatter)) if ((key === "workout_location" || key === `${PREFIX}workout_location`) && typeof frontmatter[key] === "string") keys.add("workout_location");
	return keys;
}

/** The part of a daily note's frontmatter that is Garmin data (metrics, activities, training list), or null when there is none. Has no list of requested metrics: it is not known what the note was fetched with. */
export function recordFromNote(frontmatter: Record<string, unknown>): DayRecord | null {
	const record: DayRecord = {};
	for (const [rawKey, value] of Object.entries(frontmatter)) {
		const key = rawKey.startsWith(PREFIX) ? rawKey.slice(PREFIX.length) : rawKey;
		const data = METRIC_KEYS.has(key) || IMPERIAL_KEYS.has(key) ? typeof value === "number" || typeof value === "string" : key.startsWith(LIFESTYLE_PREFIX) ? typeof value === "number" : key === "trainings" ? Array.isArray(value) : isActivityEntry(key, value);
		if (data) record[key] = value;
	}
	return Object.keys(record).length === 0 ? null : record;
}
