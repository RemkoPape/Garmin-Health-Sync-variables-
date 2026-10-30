import { getActivityCategory } from "../activity-keys";
import { METRICS } from "../metrics";

const KM_PER_MILE = 1.609344;
/** Sessions that restore rather than load: left out of the weekly load and the load balance. */
const RECOVERY_TYPES = new Set(["breathwork", "meditation"]);
const PREFIX = "ohs_";
const METRIC_KEYS = new Set(METRICS.map((m) => m.key));
/** Frontmatter keys the sync writes that are not activities. */
const NOT_ACTIVITIES = new Set(["trainings", "workout_location"]);

export interface Session {
	type: string;
	category: string;
	/** Several sessions of one type on a day are merged into one entry. */
	count: number;
	minutes: number;
	/** Always kilometres, whatever the unit system of the notes. */
	km: number | null;
	avgHr: number | null;
	kcal: number | null;
}

export function isRecovery(s: Session): boolean {
	return s.category === "recovery" || RECOVERY_TYPES.has(s.type);
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** "4x · 5 km · 46min · Ø142 bpm · 409 kcal", every part optional, minutes or distance required. */
function parseDisplay(type: string, text: string): Session | null {
	let count = 1;
	let minutes = 0;
	let km: number | null = null;
	let avgHr: number | null = null;
	let kcal: number | null = null;
	let known = 0;
	for (const part of text.split(" · ")) {
		let m: RegExpExecArray | null;
		if ((m = /^(\d+)x$/.exec(part))) count = Number(m[1]);
		else if ((m = /^(\d+(?:\.\d+)?) (km|mi)$/.exec(part))) km = Number(m[1]) * (m[2] === "mi" ? KM_PER_MILE : 1);
		else if ((m = /^(\d+)min$/.exec(part))) minutes = Number(m[1]);
		else if ((m = /^Ø(\d+) bpm$/.exec(part))) avgHr = Number(m[1]);
		else if ((m = /^(\d+) kcal$/.exec(part))) kcal = Number(m[1]);
		else return null;
		known++;
	}
	if (known === 0 || (minutes === 0 && km === null)) return null;
	return { type, category: getActivityCategory(type), count, minutes, km, avgHr, kcal };
}

/** Whether a frontmatter entry is a session written by the sync ("running": "30min · Ø150 bpm"). */
export function isActivityEntry(key: string, value: unknown): boolean {
	return !METRIC_KEYS.has(key) && !NOT_ACTIVITIES.has(key) && typeof value === "string" && parseDisplay(key, value) !== null;
}

/**
 * The sessions of one day, resolved per note and never from a setting: the setting may have changed part-way
 * through the history. A machine-readable `trainings` list gives the numbers and the category; the per-type
 * display keys give the session count and are the only source when there is no list.
 */
export function parseSessions(fm: Record<string, unknown>): Session[] {
	const display = new Map<string, Session>();
	for (const [rawKey, value] of Object.entries(fm)) {
		const key = rawKey.startsWith(PREFIX) ? rawKey.slice(PREFIX.length) : rawKey;
		if (METRIC_KEYS.has(key) || NOT_ACTIVITIES.has(key) || typeof value !== "string") continue;
		const session = parseDisplay(key, value);
		if (session) display.set(key, session);
	}
	const list = fm["trainings"] ?? fm[`${PREFIX}trainings`];
	if (!Array.isArray(list)) return [...display.values()];
	const out: Session[] = [];
	for (const raw of list) {
		if (typeof raw !== "object" || raw === null) continue;
		const e = raw as Record<string, unknown>;
		const type = typeof e["type"] === "string" ? e["type"] : null;
		if (type === null) continue;
		const km = num(e["distance_km"]) ?? (num(e["distance_mi"]) === null ? null : (e["distance_mi"] as number) * KM_PER_MILE);
		out.push({
			type,
			category: typeof e["category"] === "string" ? e["category"] : getActivityCategory(type),
			count: display.get(type)?.count ?? 1,
			minutes: num(e["duration_min"]) ?? 0,
			km,
			avgHr: num(e["avg_hr"]),
			kcal: num(e["calories"]),
		});
	}
	return out;
}
