import { normalizeActivityKey, getActivityCategory } from "../../activity-keys";
import type { TrainingEntry } from "../provider";

/** Converts seconds to "Xh Ymin" format */
export function secondsToHoursMin(seconds: number | null | undefined): string | null {
	if (seconds == null || seconds <= 0) return null;
	// Round the total first, then split: rounding the minutes on their own turns 3599 s into "0h 60min".
	const totalMinutes = Math.round(seconds / 60);
	return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}min`;
}

/** Rounds to one decimal place */
function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

/** Safe access to nested properties */
function get(obj: Record<string, unknown>, path: string): unknown {
	const parts = path.split(".");
	let current: unknown = obj;
	for (const part of parts) {
		if (current == null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function asRecord(value: unknown): Record<string, unknown> {
	if (value != null && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return {};
}

function firstRecord(value: unknown): Record<string, unknown> {
	if (Array.isArray(value)) {
		return asRecord(value[0]);
	}
	return asRecord(value);
}

/** Maps Garmin daily summary to normalized metrics */
export function mapDailySummary(data: Record<string, unknown>, enabled: Set<string>): Record<string, number | string> {
	const result: Record<string, number | string> = {};

	const mappings: [string, string, ((v: unknown) => number)?][] = [
		["steps", "totalSteps"],
		["resting_hr", "restingHeartRate"],
		["stress", "averageStressLevel"],
		["calories_total", "totalKilocalories"],
		["calories_active", "activeKilocalories"],
		["distance_km", "totalDistanceMeters", (v) => round1(Number(v) / 1000)],
		["floors", "floorsAscended", (v) => Math.round(Number(v))],
	];

	for (const [key, field, transform] of mappings) {
		if (!enabled.has(key)) continue;
		const raw = data[field];
		if (raw == null) continue;
		// Garmin sends -1 or -2 for "no stress reading" (watch off, too much movement): not a level
		if (key === "stress" && Number(raw) <= 0) continue;

		if (transform) {
			result[key] = transform(raw);
		} else {
			result[key] = Number(raw);
		}
	}

	// Intensity minutes are moderate + vigorous. Garmin may send only one of them (a missing moderate
	// value next to 30 vigorous minutes still means 30), so this is not a plain field mapping.
	if (enabled.has("intensity_min")) {
		const moderate = data["moderateIntensityMinutes"];
		const vigorous = data["vigorousIntensityMinutes"];
		if (moderate != null || vigorous != null) {
			result["intensity_min"] = (Number(moderate) || 0) + (Number(vigorous) || 0);
		}
	}

	// Stress minutes: time stressed (medium and high stress) and time at rest, from durations in seconds. Garmin may
	// leave one band out, so a missing band counts as 0 as long as at least one is there.
	if (enabled.has("stress_high")) {
		const medium = data["mediumStressDuration"];
		const high = data["highStressDuration"];
		if (medium != null || high != null) result["stress_high"] = Math.round(((Number(medium) || 0) + (Number(high) || 0)) / 60);
	}
	if (enabled.has("recovery_high")) {
		const rest = data["restStressDuration"];
		if (rest != null) result["recovery_high"] = Math.round(Number(rest) / 60);
	}

	return result;
}

/** Maps Garmin sleep data to normalized metrics */
export function mapSleepData(data: Record<string, unknown>, enabled: Set<string>): Record<string, number | string> {
	const result: Record<string, number | string> = {};

	if (enabled.has("sleep_score")) {
		const score = get(data, "sleepScores.overall.value") ?? data["overallSleepScore"];
		if (score != null) result["sleep_score"] = Number(score);
	}

	if (enabled.has("sleep_duration")) {
		const seconds = data["sleepTimeSeconds"];
		if (seconds != null) {
			const formatted = secondsToHoursMin(Number(seconds));
			if (formatted) result["sleep_duration"] = formatted;
		}
	}

	const sleepPhases: [string, string][] = [
		["sleep_deep", "deepSleepSeconds"],
		["sleep_light", "lightSleepSeconds"],
		["sleep_rem", "remSleepSeconds"],
		["sleep_awake", "awakeSleepSeconds"],
	];

	for (const [key, field] of sleepPhases) {
		if (!enabled.has(key)) continue;
		const seconds = data[field];
		if (seconds == null) continue;
		const formatted = secondsToHoursMin(Number(seconds));
		if (formatted) result[key] = formatted;
	}

	// Garmin's "Local" timestamps are epoch milliseconds of the local wall-clock time read as if it were UTC,
	// so the UTC fields of the date are the clock time the user saw.
	const sleepTimes: [string, string][] = [
		["sleep_start", "sleepStartTimestampLocal"],
		["sleep_end", "sleepEndTimestampLocal"],
	];
	for (const [key, field] of sleepTimes) {
		if (!enabled.has(key)) continue;
		const ms = Number(data[field]);
		if (!Number.isFinite(ms) || ms <= 0) continue;
		const d = new Date(ms);
		result[key] = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
	}

	return result;
}

/** Maps HRV data: the night's value only, so a night without a reading stays a gap instead of showing the 7-day average as if it was measured. */
export function mapHrvData(data: Record<string, unknown>, enabled: Set<string>): Record<string, number | string> {
	const result: Record<string, number | string> = {};
	if (!enabled.has("hrv")) return result;

	const hrvValue = get(data, "hrvSummary.lastNightAvg") ?? data["hrvStatus"];
	if (hrvValue != null) result["hrv"] = Math.round(Number(hrvValue));

	return result;
}

/**
 * Maps the Garmin daily body battery report (one object per day).
 *
 * `body_battery` is Garmin's `charged` value: the sum of all body battery
 * gains over the day (mostly the overnight recharge), not the current level.
 * `body_battery_min` / `body_battery_max` are taken from the level time series.
 */
export function mapBodyBattery(data: Record<string, unknown>, enabled: Set<string>): Record<string, number | string> {
	const result: Record<string, number | string> = {};
	if (Object.keys(data).length === 0) return result;

	if (enabled.has("body_battery")) {
		const charged = data["charged"];
		if (typeof charged === "number" && Number.isFinite(charged)) result["body_battery"] = charged;
	}

	const wantMin = enabled.has("body_battery_min");
	const wantMax = enabled.has("body_battery_max");
	if (wantMin || wantMax) {
		const levels = extractBodyBatteryLevels(data);
		if (levels.length > 0) {
			// A loop instead of Math.min(...levels): spreading a huge array throws a RangeError.
			let min = levels[0]!;
			let max = min;
			for (const level of levels) {
				if (level < min) min = level;
				if (level > max) max = level;
			}
			if (wantMin) result["body_battery_min"] = min;
			if (wantMax) result["body_battery_max"] = max;
		}
	}

	return result;
}

/**
 * Reads the body battery levels from `bodyBatteryValuesArray`, an array of
 * `[timestamp, level]` rows. The column index of the level is taken from
 * `bodyBatteryValueDescriptorDTOList` when present and defaults to 1.
 */
function extractBodyBatteryLevels(data: Record<string, unknown>): number[] {
	const rows = data["bodyBatteryValuesArray"];
	if (!Array.isArray(rows)) return [];

	let levelIndex = 1;
	const descriptors = data["bodyBatteryValueDescriptorDTOList"];
	if (Array.isArray(descriptors)) {
		for (const d of descriptors) {
			if (d != null && typeof d === "object"
				&& (d as Record<string, unknown>)["bodyBatteryValueDescriptorKey"] === "bodyBatteryLevel"
				&& typeof (d as Record<string, unknown>)["bodyBatteryValueDescriptorIndex"] === "number") {
				levelIndex = (d as Record<string, unknown>)["bodyBatteryValueDescriptorIndex"] as number;
				break;
			}
		}
	}

	const levels: number[] = [];
	for (const row of rows as unknown[]) {
		if (!Array.isArray(row)) continue;
		const level: unknown = (row as unknown[])[levelIndex];
		if (typeof level === "number" && Number.isFinite(level)) levels.push(level);
	}
	return levels;
}

/** Maps SpO2 data */
export function mapSpO2(data: Record<string, unknown>, enabled: Set<string>): Record<string, number | string> {
	const result: Record<string, number | string> = {};
	if (!enabled.has("spo2")) return result;

	// Garmin writes the field `averageSpO2` (capital O), seen in a real answer of an iPhone sync; the night's own average is `avgSleepSpO2`.
	// The spellings the first versions guessed stay, in case another region or firmware sends them.
	const avg = data["averageSpO2"] ?? data["avgSleepSpO2"] ?? data["averageSpo2"] ?? get(data, "allDaySpO2.averageSpo2");
	if (avg != null && Number(avg) > 0) result["spo2"] = Number(avg);

	return result;
}

/** Maps the day's water intake and the intake goal, both in ml. The goal is only kept next to an intake. */
export function mapHydration(data: Record<string, unknown>, enabled: Set<string>): Record<string, number | string> {
	const result: Record<string, number | string> = {};
	const intake = Number(data["valueInML"] ?? data["valueInMl"]);
	if (!(intake > 0)) return result;
	if (enabled.has("hydration_ml")) result["hydration_ml"] = Math.round(intake);
	const goal = Number(data["goalInML"] ?? data["goalInMl"]);
	if (enabled.has("hydration_goal_ml") && goal > 0) result["hydration_goal_ml"] = Math.round(goal);
	return result;
}

/** Maps respiration data */
export function mapRespiration(data: Record<string, unknown>, enabled: Set<string>): Record<string, number | string> {
	const result: Record<string, number | string> = {};
	if (!enabled.has("respiration_rate")) return result;

	const avg = data["avgWakingRespirationValue"];
	if (avg != null && Number(avg) > 0) result["respiration_rate"] = Number(avg);

	return result;
}

/** Maps weight data */
export function mapWeight(data: Record<string, unknown>, enabled: Set<string>): Record<string, number | string> {
	const result: Record<string, number | string> = {};

	const entries = data["dailyWeightSummaries"] ?? data["dateWeightList"];
	if (!Array.isArray(entries) || entries.length === 0) return result;

	const latest = entries[entries.length - 1] as Record<string, unknown> | undefined;
	if (!latest) return result;

	if (enabled.has("weight_kg")) {
		const weight = latest["weight"] ?? get(latest, "weight");
		if (weight != null) result["weight_kg"] = round1(Number(weight) / 1000);
	}

	if (enabled.has("body_fat_pct")) {
		const fat = latest["bodyFat"];
		if (fat != null) result["body_fat_pct"] = round1(Number(fat));
	}

	return result;
}

/** Maps Training Readiness */
export function mapTrainingReadiness(data: Record<string, unknown>, enabled: Set<string>): Record<string, number | string> {
	const result: Record<string, number | string> = {};
	if (!enabled.has("training_readiness")) return result;

	const score = data["score"] ?? data["trainingReadinessScore"];
	if (score != null) result["training_readiness"] = Math.round(Number(score));

	return result;
}

/** Maps Training Status */
export function mapTrainingStatus(data: Record<string, unknown> | Record<string, unknown>[], enabled: Set<string>): Record<string, number | string> {
	const result: Record<string, number | string> = {};
	if (!enabled.has("training_status") && !enabled.has("vo2_max")) return result;

	const entry = firstRecord(data);
	const generic = asRecord(entry["generic"]);

	if (enabled.has("training_status")) {
		const status = entry["currentTrainingStatusPhrase"]
			?? entry["trainingStatusPhrase"]
			?? generic["currentTrainingStatusPhrase"]
			?? generic["trainingStatusPhrase"];
		if (typeof status === "string") result["training_status"] = status;
		else if (typeof status === "number") result["training_status"] = String(status);
	}

	if (enabled.has("vo2_max")) {
		const vo2Max = generic["vo2MaxValue"]
			?? entry["vo2MaxValue"]
			?? generic["vo2MaxPreciseValue"]
			?? entry["vo2MaxPreciseValue"]
			?? generic["maxMet"]
			?? entry["maxMet"]
			?? generic["maxMetValue"]
			?? entry["maxMetValue"];
		if (vo2Max != null && Number.isFinite(Number(vo2Max))) {
			result["vo2_max"] = round1(Number(vo2Max));
		}
	}

	return result;
}

/** Result of mapActivities: human-readable + structured */
export interface ActivityResult {
	/** Human-readable key-value pairs (e.g. hiking: "8.2 km · 157min") */
	display: Record<string, string>;
	/** Structured training data for machine-readable output */
	trainings: TrainingEntry[];
	/** Start coordinates of the first activity with GPS (for reverse geocoding) */
	startLocation: { lat: number; lon: number } | null;
}

/** Maps Garmin activities to normalized training strings */
export function mapActivities(activities: Record<string, unknown>[]): ActivityResult {
	const grouped: Record<string, { count: number; distanceKm: number; durationMin: number; avgHr: number; hrCount: number; calories: number }> = {};
	let startLocation: { lat: number; lon: number } | null = null;

	for (const act of activities) {
		// Normalize typeKey from API (e_bike_fitness → e_bike, etc.)
		const typeKeyValue = get(act, "activityType.typeKey");
		const rawKey = typeof typeKeyValue === "string" ? typeKeyValue : "workout";
		const typeName = normalizeActivityKey(rawKey);

		if (!grouped[typeName]) {
			grouped[typeName] = { count: 0, distanceKm: 0, durationMin: 0, avgHr: 0, hrCount: 0, calories: 0 };
		}

		const group = grouped[typeName];
		group.count++;
		group.distanceKm += (Number(act["distance"]) || 0) / 1000;
		group.durationMin += Math.round((Number(act["duration"]) || 0) / 60);
		group.calories += Math.round(Number(act["calories"]) || 0);

		const hr = Number(act["averageHR"]) || 0;
		if (hr > 0) {
			group.avgHr += hr;
			group.hrCount++;
		}

		// Record the first activity with GPS coordinates
		if (!startLocation) {
			const latRaw = act["startLatitude"];
			const lonRaw = act["startLongitude"];
			const blank = (v: unknown): boolean => v == null || (typeof v === "string" && v.trim() === "");
			if (!blank(latRaw) && !blank(lonRaw)) {
				const lat = Number(latRaw);
				const lon = Number(lonRaw);
				if (!isNaN(lat) && !isNaN(lon)) {
					startLocation = { lat, lon };
				}
			}
		}
	}

	const display: Record<string, string> = {};
	const trainings: TrainingEntry[] = [];

	for (const [type, data] of Object.entries(grouped)) {
		// Human-readable String
		const parts: string[] = [];
		if (data.count > 1) parts.push(`${data.count}x`);
		if (data.distanceKm > 0) parts.push(`${round1(data.distanceKm)} km`);
		if (data.durationMin > 0) parts.push(`${data.durationMin}min`);
		if (data.hrCount > 0) parts.push(`Ø${Math.round(data.avgHr / data.hrCount)} bpm`);
		if (data.calories > 0) parts.push(`${data.calories} kcal`);

		if (parts.length > 0) {
			display[type] = parts.join(" · ");
		}

		// Structured training entry
		const entry: TrainingEntry = {
			type,
			category: getActivityCategory(type),
		};
		if (data.distanceKm > 0) entry.distance_km = round1(data.distanceKm);
		if (data.durationMin > 0) entry.duration_min = data.durationMin;
		if (data.hrCount > 0) entry.avg_hr = Math.round(data.avgHr / data.hrCount);
		if (data.calories > 0) entry.calories = data.calories;
		trainings.push(entry);
	}

	return { display, trainings, startLocation };
}
