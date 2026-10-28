/** The prefix of the keys the habits of Garmin's lifestyle log get in notes and history: `lifestyle_late_caffeine`. */
export const LIFESTYLE_PREFIX = "lifestyle_";

/** A habit of the lifestyle log: a yes or no, or a count (cups, drinks). */
export type HabitKind = "check" | "count";

export interface Habit {
	/** The key of the habit in notes and history. */
	key: string;
	/** The name the user gave it in Garmin Connect. */
	name: string;
	kind: HabitKind;
	/** 1 or 0 for a yes or no, the amount for a count; null when the habit was not touched that day (never 0: no entry is not "no"). */
	value: number | null;
}

/** "Late caffeine" -> "late_caffeine"; names without a Latin letter or digit come back empty. */
function slug(name: string): string {
	return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

function asNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The habits of one day from Garmin's answer of the lifestyle log (`dailyLogsReport`). The structure comes from
 * projects that read the same endpoint, not from Garmin's documentation: an entry has a name, a `measurementType`
 * ("QUANTITY" counts, anything else is a yes or no), a `logStatus` ("YES" or "NO"; missing = untouched) and, for a
 * count, `details` with an `amount` per kind of drink or food.
 */
export function parseHabits(data: Record<string, unknown>): Habit[] {
	const report = data["dailyLogsReport"];
	if (!Array.isArray(report)) return [];
	const habits: Habit[] = [];
	const used = new Set<string>();
	report.forEach((entry: unknown, index) => {
		if (entry == null || typeof entry !== "object") return;
		const e = entry as Record<string, unknown>;
		const name = typeof e["name"] === "string" ? e["name"].trim() : "";
		if (name === "") return;
		const id = typeof e["behaviourId"] === "number" || typeof e["behaviourId"] === "string" ? String(e["behaviourId"]) : String(index);
		let key = LIFESTYLE_PREFIX + (slug(name) || `habit_${id}`);
		// two habits that read the same must not share one key
		if (used.has(key)) key = `${key}_${id}`;
		used.add(key);
		const kind: HabitKind = e["measurementType"] === "QUANTITY" ? "count" : "check";
		let value: number | null = null;
		if (e["logStatus"] === "NO") value = 0;
		else if (e["logStatus"] === "YES") {
			// a count is the sum of what was logged; a yes without an amount counts as one
			const amounts = kind === "count" && Array.isArray(e["details"]) ? (e["details"] as unknown[]).reduce<number>((sum, d) => sum + asNumber((d as Record<string, unknown> | null)?.["amount"]), 0) : 0;
			value = amounts > 0 ? amounts : 1;
		}
		habits.push({ key, name, kind, value });
	});
	return habits;
}

/** What was logged for the day, every habit that was touched: the lifestyle log has one switch, there is no choice per habit. */
export function mapLifestyle(data: Record<string, unknown>): Record<string, number> {
	const result: Record<string, number> = {};
	for (const habit of parseHabits(data)) if (habit.value !== null) result[habit.key] = habit.value;
	return result;
}
