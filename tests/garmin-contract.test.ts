// Why it matters: the mappers were written from memory of Garmin's answers, and one of them (SpO2) used a field name
// with the wrong capital letter, so it could never have mapped a value. These fixtures have the structure of real answers
// (copied from the diagnostics of an iPhone sync on 2026-10-28; every value is invented) and pin that each mapper finds the
// fields Garmin really sends. A new shape from a bug report belongs here.
import { describe, expect, it } from "vitest";
import { mapBodyBattery, mapDailySummary, mapHydration, mapRespiration, mapSleepData, mapSpO2, mapWeight } from "../src/providers/garmin/garmin-mapper";

const on = (...keys: string[]): Set<string> => new Set(keys);

describe("the daily summary of a real watch", () => {
	const summary = {
		userProfileId: 1, totalKilocalories: 2500, activeKilocalories: 600, bmrKilocalories: 1900, totalSteps: 9100, totalDistanceMeters: 7300,
		calendarDate: "2026-10-28", moderateIntensityMinutes: 20, vigorousIntensityMinutes: 10, floorsAscended: 7.4, restingHeartRate: 52,
		averageStressLevel: 31, stressDuration: 12000, restStressDuration: 18000, mediumStressDuration: 7000, highStressDuration: 600,
		totalStressDuration: 40000, lowStressDuration: 14000,
	};

	it("maps every metric of the group from the fields it sends", () => {
		const keys = ["steps", "resting_hr", "stress", "stress_high", "recovery_high", "calories_total", "calories_active", "distance_km", "floors", "intensity_min"];
		expect(mapDailySummary(summary, on(...keys))).toEqual({
			steps: 9100, resting_hr: 52, stress: 31, stress_high: 127, recovery_high: 300, calories_total: 2500, calories_active: 600, distance_km: 7.3, floors: 7, intensity_min: 30,
		});
	});
});

describe("blood oxygen of a real watch", () => {
	const spo2 = (patch: Record<string, unknown>) => ({
		userProfilePK: 1, calendarDate: "2026-10-28", averageSpO2: null, lowestSpO2: null, lastSevenDaysAvgSpO2: null, latestSpO2: null, avgSleepSpO2: null, avgTomorrowSleepSpO2: null,
		spO2ValueDescriptorsDTOList: null, spO2SingleValues: null, continuousReadingDTOList: null, spO2HourlyAverages: null, ...patch,
	});

	it("maps a day with a reading, and says nothing for a day where every field is null (a watch that did not measure)", () => {
		expect(mapSpO2(spo2({ averageSpO2: 95, lowestSpO2: 89, avgSleepSpO2: 94 }), on("spo2"))).toEqual({ spo2: 95 });
		expect(mapSpO2(spo2({}), on("spo2"))).toEqual({});
	});
});

describe("water intake of a real watch", () => {
	const water = (patch: Record<string, unknown>) => ({ userId: 1, calendarDate: "2026-10-28", valueInML: null, goalInML: 2500, dailyAverageinML: null, lastEntryTimestampLocal: null, sweatLossInML: null, activityIntakeInML: null, ...patch });

	it("maps the logged intake and the goal, and nothing for a day without a log (the goal alone is no intake)", () => {
		expect(mapHydration(water({ valueInML: 1800 }), on("hydration_ml", "hydration_goal_ml"))).toEqual({ hydration_ml: 1800, hydration_goal_ml: 2500 });
		expect(mapHydration(water({}), on("hydration_ml", "hydration_goal_ml"))).toEqual({});
	});
});

describe("breathing and body battery of a real watch", () => {
	it("maps the waking respiration rate", () => {
		const resp = { userProfilePK: 1, calendarDate: "2026-10-28", lowestRespirationValue: 9, highestRespirationValue: 24, avgWakingRespirationValue: 14, avgSleepRespirationValue: 12, respirationValuesArray: [[1, 14]] };
		expect(mapRespiration(resp, on("respiration_rate"))).toEqual({ respiration_rate: 14 });
	});

	it("maps the charge and the lowest and highest level from the list of readings", () => {
		const battery = { date: "2026-10-28", charged: 62, drained: 40, bodyBatteryValuesArray: [[1, 30], [2, 95], [3, 41]], bodyBatteryValueDescriptorDTOList: [{ bodyBatteryValueDescriptorIndex: 0, bodyBatteryValueDescriptorKey: "timestamp" }, { bodyBatteryValueDescriptorIndex: 1, bodyBatteryValueDescriptorKey: "bodyBatteryLevel" }] };
		expect(mapBodyBattery(battery, on("body_battery", "body_battery_min", "body_battery_max"))).toEqual({ body_battery: 62, body_battery_min: 30, body_battery_max: 95 });
	});
});

describe("weight of a real watch", () => {
	it("writes nothing for a day without a weigh-in: an empty list and an average of nulls", () => {
		const none = { startDate: "2026-10-28", endDate: "2026-10-28", dateWeightList: [], totalAverage: { from: 1, until: 2, weight: null, bmi: null, bodyFat: null } };
		expect(mapWeight(none, on("weight_kg", "body_fat_pct"))).toEqual({});
	});
});

describe("sleep of a real watch", () => {
	it("maps the duration, the stages, the score and the times from the daily sleep answer", () => {
		const sleep = {
			sleepTimeSeconds: 27000, deepSleepSeconds: 5400, lightSleepSeconds: 15000, remSleepSeconds: 5400, awakeSleepSeconds: 1200,
			sleepStartTimestampLocal: Date.UTC(2026, 9, 27, 23, 15), sleepEndTimestampLocal: Date.UTC(2026, 9, 28, 6, 45),
			sleepScores: { overall: { value: 81, qualifierKey: "GOOD" } },
		};
		const keys = ["sleep_duration", "sleep_score", "sleep_deep", "sleep_light", "sleep_rem", "sleep_awake", "sleep_start", "sleep_end"];
		expect(mapSleepData(sleep, on(...keys))).toEqual({ sleep_duration: "7h 30min", sleep_score: 81, sleep_deep: "1h 30min", sleep_light: "4h 10min", sleep_rem: "1h 30min", sleep_awake: "0h 20min", sleep_start: "23:15", sleep_end: "06:45" });
	});
});
