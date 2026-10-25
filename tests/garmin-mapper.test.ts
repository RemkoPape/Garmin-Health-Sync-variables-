// Why it matters: the mappers turn Garmin's JSON into the values written into a user's notes. A wrong
// field, unit or rounding rule is wrong health data in their vault, and every sync repeats it.
import { describe, expect, it } from "vitest";
import {
	mapActivities,
	mapBodyBattery,
	mapDailySummary,
	mapHrvData,
	mapRespiration,
	mapSleepData,
	mapSpO2,
	mapTrainingReadiness,
	mapTrainingStatus,
	mapWeight,
	secondsToHoursMin,
} from "../src/providers/garmin/garmin-mapper";

const all = (...keys: string[]): Set<string> => new Set(keys);

describe("secondsToHoursMin", () => {
	it.each([
		[null, null],
		[undefined, null],
		[0, null],
		[-60, null],
	])("returns nothing for %s", (input, expected) => {
		expect(secondsToHoursMin(input)).toBe(expected);
	});

	it.each([
		[60, "0h 1min"],
		[3540, "0h 59min"],
		[3600, "1h 0min"],
		[3660, "1h 1min"],
		[27000, "7h 30min"],
		[86400, "24h 0min"],
	])("formats %i s as %s", (seconds, expected) => {
		expect(secondsToHoursMin(seconds)).toBe(expected);
	});
});

describe("mapDailySummary", () => {
	const summary = {
		totalSteps: 8123,
		restingHeartRate: 52,
		averageStressLevel: 31,
		totalKilocalories: 2400.7,
		activeKilocalories: 650,
		totalDistanceMeters: 6543,
		floorsAscended: 11.6,
		moderateIntensityMinutes: 20,
		vigorousIntensityMinutes: 15,
	};
	const every = all("steps", "resting_hr", "stress", "calories_total", "calories_active", "distance_km", "floors", "intensity_min");

	it("maps every field with the documented conversions", () => {
		expect(mapDailySummary(summary, every)).toEqual({
			steps: 8123,
			resting_hr: 52,
			stress: 31,
			calories_total: 2400.7,
			calories_active: 650,
			distance_km: 6.5,
			floors: 12,
			intensity_min: 35,
		});
	});

	it("maps only the enabled metrics", () => {
		expect(mapDailySummary(summary, all("steps"))).toEqual({ steps: 8123 });
		expect(mapDailySummary(summary, all())).toEqual({});
	});

	it("skips fields Garmin did not send (null or absent) but keeps a real zero", () => {
		expect(mapDailySummary({ totalSteps: null, restingHeartRate: 0 }, all("steps", "resting_hr"))).toEqual({ resting_hr: 0 });
		expect(mapDailySummary({}, every)).toEqual({});
	});

	it("rounds distance to one decimal", () => {
		expect(mapDailySummary({ totalDistanceMeters: 1049 }, all("distance_km"))).toEqual({ distance_km: 1 });
		expect(mapDailySummary({ totalDistanceMeters: 1051 }, all("distance_km"))).toEqual({ distance_km: 1.1 });
		expect(mapDailySummary({ totalDistanceMeters: 0 }, all("distance_km"))).toEqual({ distance_km: 0 });
	});

	it("adds up moderate and vigorous intensity minutes, treating a missing vigorous value as 0", () => {
		expect(mapDailySummary({ moderateIntensityMinutes: 12 }, all("intensity_min"))).toEqual({ intensity_min: 12 });
		expect(mapDailySummary({ moderateIntensityMinutes: 0, vigorousIntensityMinutes: 5 }, all("intensity_min"))).toEqual({ intensity_min: 5 });
	});
});

describe("mapSleepData", () => {
	const sleep = {
		sleepScores: { overall: { value: 82 } },
		sleepTimeSeconds: 27000,
		deepSleepSeconds: 5400,
		lightSleepSeconds: 14400,
		remSleepSeconds: 6000,
		awakeSleepSeconds: 1200,
	};
	const every = all("sleep_score", "sleep_duration", "sleep_deep", "sleep_light", "sleep_rem", "sleep_awake");

	it("maps score, duration and the four phases", () => {
		expect(mapSleepData(sleep, every)).toEqual({
			sleep_score: 82,
			sleep_duration: "7h 30min",
			sleep_deep: "1h 30min",
			sleep_light: "4h 0min",
			sleep_rem: "1h 40min",
			sleep_awake: "0h 20min",
		});
	});

	it("falls back to overallSleepScore when the nested score is missing", () => {
		expect(mapSleepData({ overallSleepScore: 77 }, all("sleep_score"))).toEqual({ sleep_score: 77 });
		expect(mapSleepData({ sleepScores: { overall: {} }, overallSleepScore: 70 }, all("sleep_score"))).toEqual({ sleep_score: 70 });
	});

	it("maps only the enabled metrics", () => {
		expect(mapSleepData(sleep, all("sleep_rem"))).toEqual({ sleep_rem: "1h 40min" });
		expect(mapSleepData(sleep, all())).toEqual({});
	});

	it("writes no duration for a zero or missing value (a phase Garmin did not record)", () => {
		expect(mapSleepData({ sleepTimeSeconds: 0, deepSleepSeconds: 0 }, all("sleep_duration", "sleep_deep"))).toEqual({});
		expect(mapSleepData({}, every)).toEqual({});
	});
});

describe("mapHrvData", () => {
	it("prefers last night's average, then the weekly average, then hrvStatus", () => {
		const on = all("hrv");
		expect(mapHrvData({ hrvSummary: { lastNightAvg: 48.6, weeklyAvg: 40 } }, on)).toEqual({ hrv: 49 });
		expect(mapHrvData({ hrvSummary: { weeklyAvg: 40.4 } }, on)).toEqual({ hrv: 40 });
		expect(mapHrvData({ hrvStatus: 55 }, on)).toEqual({ hrv: 55 });
		expect(mapHrvData({}, on)).toEqual({});
	});

	it("does nothing when HRV is not enabled", () => {
		expect(mapHrvData({ hrvSummary: { lastNightAvg: 48 } }, all("steps"))).toEqual({});
	});
});

describe("mapBodyBattery", () => {
	const day = {
		charged: 63,
		bodyBatteryValueDescriptorDTOList: [
			{ bodyBatteryValueDescriptorKey: "timestamp", bodyBatteryValueDescriptorIndex: 0 },
			{ bodyBatteryValueDescriptorKey: "bodyBatteryStatus", bodyBatteryValueDescriptorIndex: 1 },
			{ bodyBatteryValueDescriptorKey: "bodyBatteryLevel", bodyBatteryValueDescriptorIndex: 2 },
		],
		bodyBatteryValuesArray: [
			[1, "MEASURED", 40],
			[2, "MEASURED", 95],
			[3, "MEASURED", 12],
			[4, "MEASURED", null],
		],
	};

	it("reports charged as body_battery and min/max from the level column named by the descriptor", () => {
		expect(mapBodyBattery(day, all("body_battery", "body_battery_min", "body_battery_max"))).toEqual({
			body_battery: 63,
			body_battery_min: 12,
			body_battery_max: 95,
		});
	});

	it("defaults the level column to index 1 without a usable descriptor", () => {
		const rows = { bodyBatteryValuesArray: [[1, 30], [2, 80]] };
		const on = all("body_battery_min", "body_battery_max");
		expect(mapBodyBattery(rows, on)).toEqual({ body_battery_min: 30, body_battery_max: 80 });
		expect(mapBodyBattery({ ...rows, bodyBatteryValueDescriptorDTOList: "nope" }, on)).toEqual({ body_battery_min: 30, body_battery_max: 80 });
		const noLevel = [null, { bodyBatteryValueDescriptorKey: "other", bodyBatteryValueDescriptorIndex: 0 }, { bodyBatteryValueDescriptorKey: "bodyBatteryLevel", bodyBatteryValueDescriptorIndex: "1" }];
		expect(mapBodyBattery({ ...rows, bodyBatteryValueDescriptorDTOList: noLevel }, on)).toEqual({ body_battery_min: 30, body_battery_max: 80 });
	});

	it("skips rows and levels that are not numbers", () => {
		const rows = { bodyBatteryValuesArray: ["junk", [1, "x"], [2, NaN], [3, 50]] };
		expect(mapBodyBattery(rows, all("body_battery_min", "body_battery_max"))).toEqual({ body_battery_min: 50, body_battery_max: 50 });
	});

	it("writes nothing for an empty payload, a missing array or no levels", () => {
		const on = all("body_battery", "body_battery_min", "body_battery_max");
		expect(mapBodyBattery({}, on)).toEqual({});
		expect(mapBodyBattery({ bodyBatteryValuesArray: "nope" }, on)).toEqual({});
		expect(mapBodyBattery({ bodyBatteryValuesArray: [] }, on)).toEqual({});
	});

	it("ignores a charged value that is not a finite number", () => {
		expect(mapBodyBattery({ charged: "63" }, all("body_battery"))).toEqual({});
		expect(mapBodyBattery({ charged: Infinity }, all("body_battery"))).toEqual({});
	});

	it("maps only what is enabled", () => {
		expect(mapBodyBattery(day, all("body_battery_max"))).toEqual({ body_battery_max: 95 });
		expect(mapBodyBattery(day, all("steps"))).toEqual({});
	});
});

describe("mapSpO2 and mapRespiration", () => {
	it("reads the average from either SpO2 location", () => {
		expect(mapSpO2({ averageSpo2: 96 }, all("spo2"))).toEqual({ spo2: 96 });
		expect(mapSpO2({ allDaySpO2: { averageSpo2: 94 } }, all("spo2"))).toEqual({ spo2: 94 });
	});

	it("treats 0 as no reading", () => {
		expect(mapSpO2({ averageSpo2: 0 }, all("spo2"))).toEqual({});
		expect(mapRespiration({ avgWakingRespirationValue: 0 }, all("respiration_rate"))).toEqual({});
	});

	it("does nothing when not enabled or when the field is absent", () => {
		expect(mapSpO2({ averageSpo2: 96 }, all())).toEqual({});
		expect(mapSpO2({}, all("spo2"))).toEqual({});
		expect(mapRespiration({ avgWakingRespirationValue: 14.2 }, all())).toEqual({});
		expect(mapRespiration({}, all("respiration_rate"))).toEqual({});
	});

	it("maps respiration", () => {
		expect(mapRespiration({ avgWakingRespirationValue: 14.2 }, all("respiration_rate"))).toEqual({ respiration_rate: 14.2 });
	});
});

describe("mapWeight", () => {
	const on = all("weight_kg", "body_fat_pct");

	it("converts grams to kilograms with one decimal and takes the latest entry", () => {
		const data = { dailyWeightSummaries: [{ weight: 81000, bodyFat: 20 }, { weight: 80349, bodyFat: 19.46 }] };
		expect(mapWeight(data, on)).toEqual({ weight_kg: 80.3, body_fat_pct: 19.5 });
	});

	it("also reads dateWeightList", () => {
		expect(mapWeight({ dateWeightList: [{ weight: 70000 }] }, on)).toEqual({ weight_kg: 70 });
	});

	it("maps only what is enabled", () => {
		const data = { dailyWeightSummaries: [{ weight: 70000, bodyFat: 18 }] };
		expect(mapWeight(data, all("body_fat_pct"))).toEqual({ body_fat_pct: 18 });
		expect(mapWeight(data, all())).toEqual({});
	});

	it("writes nothing for no entries, a non-array, or an unusable latest entry", () => {
		expect(mapWeight({}, on)).toEqual({});
		expect(mapWeight({ dailyWeightSummaries: [] }, on)).toEqual({});
		expect(mapWeight({ dailyWeightSummaries: "x" }, on)).toEqual({});
		expect(mapWeight({ dailyWeightSummaries: [undefined] }, on)).toEqual({});
		expect(mapWeight({ dailyWeightSummaries: [{ weight: null, bodyFat: null }] }, on)).toEqual({});
	});
});

describe("mapTrainingReadiness", () => {
	it("rounds the score from either field", () => {
		expect(mapTrainingReadiness({ score: 71.6 }, all("training_readiness"))).toEqual({ training_readiness: 72 });
		expect(mapTrainingReadiness({ trainingReadinessScore: 40 }, all("training_readiness"))).toEqual({ training_readiness: 40 });
		expect(mapTrainingReadiness({}, all("training_readiness"))).toEqual({});
		expect(mapTrainingReadiness({ score: 71 }, all())).toEqual({});
	});
});

describe("mapTrainingStatus", () => {
	const on = all("training_status", "vo2_max");

	it("reads the status phrase and VO2 max from a flat object", () => {
		expect(mapTrainingStatus({ currentTrainingStatusPhrase: "PRODUCTIVE", vo2MaxValue: 51.26 }, on)).toEqual({
			training_status: "PRODUCTIVE",
			vo2_max: 51.3,
		});
	});

	it("reads the nested generic object and the first element of an array", () => {
		const nested = { generic: { trainingStatusPhrase: "MAINTAINING", vo2MaxPreciseValue: 48 } };
		expect(mapTrainingStatus(nested, on)).toEqual({ training_status: "MAINTAINING", vo2_max: 48 });
		expect(mapTrainingStatus([nested, { vo2MaxValue: 1 }], on)).toEqual({ training_status: "MAINTAINING", vo2_max: 48 });
	});

	it("falls back through the alternative VO2 max fields", () => {
		expect(mapTrainingStatus({ vo2MaxValue: 50 }, all("vo2_max"))).toEqual({ vo2_max: 50 });
		expect(mapTrainingStatus({ maxMet: 12.34 }, all("vo2_max"))).toEqual({ vo2_max: 12.3 });
		expect(mapTrainingStatus({ generic: { maxMetValue: 9 } }, all("vo2_max"))).toEqual({ vo2_max: 9 });
	});

	it("turns a numeric status phrase into a string and ignores other types", () => {
		expect(mapTrainingStatus({ trainingStatusPhrase: 7 }, all("training_status"))).toEqual({ training_status: "7" });
		expect(mapTrainingStatus({ trainingStatusPhrase: {} }, all("training_status"))).toEqual({});
	});

	it("ignores a non-numeric VO2 max and maps only what is enabled", () => {
		expect(mapTrainingStatus({ vo2MaxValue: "n/a" }, all("vo2_max"))).toEqual({});
		expect(mapTrainingStatus({ currentTrainingStatusPhrase: "X", vo2MaxValue: 50 }, all("training_status"))).toEqual({ training_status: "X" });
		expect(mapTrainingStatus({ vo2MaxValue: 50 }, all("steps"))).toEqual({});
	});

	it("tolerates an empty array, null elements and non-object input", () => {
		expect(mapTrainingStatus([], on)).toEqual({});
		expect(mapTrainingStatus([null as never], on)).toEqual({});
		expect(mapTrainingStatus({ generic: "x" }, on)).toEqual({});
	});
});

describe("mapActivities", () => {
	const run = (distance: number, duration: number, hr?: number, calories?: number, extra = {}) => ({
		activityType: { typeKey: "running" },
		distance,
		duration,
		averageHR: hr,
		calories,
		...extra,
	});

	it("formats one activity as km, minutes, average heart rate and calories", () => {
		const out = mapActivities([run(8200, 4710, 150, 600)]);
		expect(out.display).toEqual({ running: "8.2 km · 79min · Ø150 bpm · 600 kcal" });
		expect(out.trainings).toEqual([{ type: "running", category: "running", distance_km: 8.2, duration_min: 79, avg_hr: 150, calories: 600 }]);
	});

	it("groups activities of one type with a count, summing distance, time and calories", () => {
		const out = mapActivities([run(5000, 1800, 140, 300), run(3000, 1200, 160, 200)]);
		expect(out.display).toEqual({ running: "2x · 8 km · 50min · Ø150 bpm · 500 kcal" });
		expect(out.trainings[0]).toMatchObject({ distance_km: 8, duration_min: 50, avg_hr: 150, calories: 500 });
	});

	it("averages heart rate only over activities that have one", () => {
		const out = mapActivities([run(1000, 600, 100), run(1000, 600, undefined), run(1000, 600, 0)]);
		expect(out.display["running"]).toContain("Ø100 bpm");
	});

	it("keeps separate groups per type, normalising Garmin's key", () => {
		const out = mapActivities([
			{ activityType: { typeKey: "e_bike_fitness" }, distance: 20000, duration: 3600 },
			{ activityType: { typeKey: "Some New Sport" }, duration: 600 },
		]);
		expect(Object.keys(out.display)).toEqual(["e_bike", "some_new_sport"]);
		expect(out.trainings.map((t) => [t.type, t.category])).toEqual([["e_bike", "cycling"], ["some_new_sport", "other"]]);
	});

	it("files an activity with no type under workout", () => {
		expect(Object.keys(mapActivities([{ duration: 600 }]).display)).toEqual(["workout"]);
		expect(Object.keys(mapActivities([{ activityType: { typeKey: 5 }, duration: 600 }]).display)).toEqual(["workout"]);
	});

	it("rounds each activity's minutes before summing and ignores non-numeric values", () => {
		const out = mapActivities([{ activityType: { typeKey: "yoga" }, duration: 89, distance: "x", calories: null }]);
		expect(out.display).toEqual({ yoga: "1min" });
	});

	it("omits a type from the display when nothing was recorded, but still lists the training", () => {
		const out = mapActivities([{ activityType: { typeKey: "yoga" } }]);
		expect(out.display).toEqual({});
		expect(out.trainings).toEqual([{ type: "yoga", category: "gym" }]);
	});

	it("never puts undefined keys into a training entry (the dirty check depends on it)", () => {
		const out = mapActivities([{ activityType: { typeKey: "yoga" }, duration: 600 }]);
		expect(Object.keys(out.trainings[0]!).sort()).toEqual(["category", "duration_min", "type"]);
	});

	it("takes the start location from the first activity that has GPS", () => {
		const out = mapActivities([
			run(1000, 600),
			run(1000, 600, undefined, undefined, { startLatitude: 50.64, startLongitude: 7.23 }),
			run(1000, 600, undefined, undefined, { startLatitude: 1, startLongitude: 2 }),
		]);
		expect(out.startLocation).toEqual({ lat: 50.64, lon: 7.23 });
	});

	it("has no location without usable coordinates", () => {
		expect(mapActivities([run(1000, 600)]).startLocation).toBeNull();
		expect(mapActivities([run(1000, 600, undefined, undefined, { startLatitude: null, startLongitude: null })]).startLocation).toBeNull();
		expect(mapActivities([run(1000, 600, undefined, undefined, { startLatitude: "abc", startLongitude: 7 })]).startLocation).toBeNull();
		expect(mapActivities([run(1000, 600, undefined, undefined, { startLatitude: 50 })]).startLocation).toBeNull();
	});

	it("returns empty results for no activities", () => {
		expect(mapActivities([])).toEqual({ display: {}, trainings: [], startLocation: null });
	});
});

// ---------------------------------------------------------------------------
// 0.11.1 fixes (each written to fail first, see CHANGELOG)
// ---------------------------------------------------------------------------

describe("F1: durations never show 60 minutes", () => {
	it.each([
		[3599, "1h 0min"],
		[28785, "8h 0min"],
		[27030, "7h 31min"],
		[7170, "2h 0min"],
		[7169, "1h 59min"],
		[30, "0h 1min"],
	])("formats %i s as %s (total minutes are rounded first, then split)", (seconds, expected) => {
		expect(secondsToHoursMin(seconds)).toBe(expected);
	});

	it("applies to the sleep duration and the sleep phases that land in the note", () => {
		const out = mapSleepData({ sleepTimeSeconds: 28785, deepSleepSeconds: 3599 }, all("sleep_duration", "sleep_deep"));
		expect(out).toEqual({ sleep_duration: "8h 0min", sleep_deep: "1h 0min" });
	});

	it("never produces a 60min part for any whole number of seconds up to 24 hours", () => {
		for (let s = 1; s <= 86400; s += 7) {
			expect(secondsToHoursMin(s), String(s)).not.toMatch(/\b60min/);
		}
	});
});
