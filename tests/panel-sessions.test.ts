// Why it matters: every training card starts from the sessions in the daily notes. They come in two shapes
// (display keys and a machine-readable list) that can be mixed in one history, and a misread unit, a merged
// session count or a breathwork session counted as load would change what the cards advise.
import { describe, expect, it } from "vitest";
import { parseSessions, isRecovery } from "../src/panel/sessions";

describe("parseSessions from display keys", () => {
	it("reads minutes, distance, heart rate, calories and the number of merged sessions", () => {
		const [s] = parseSessions({ running: "3x · 5.5 km · 46min · Ø142 bpm · 409 kcal" });
		expect(s).toEqual({ type: "running", category: "running", count: 3, minutes: 46, km: 5.5, avgHr: 142, kcal: 409 });
	});

	it("accepts every part being optional as long as there are minutes or a distance", () => {
		expect(parseSessions({ yoga: "30min" })[0]).toMatchObject({ minutes: 30, km: null, avgHr: null, kcal: null, count: 1 });
		expect(parseSessions({ walking: "2 km" })[0]).toMatchObject({ minutes: 0, km: 2 });
	});

	it("converts miles to kilometres", () => {
		const [s] = parseSessions({ running: "3.1 mi · 30min" });
		expect(s!.km).toBeCloseTo(4.989, 2);
	});

	it("reads notes written with the ohs_ prefix", () => {
		expect(parseSessions({ ohs_cycling: "20 km · 50min" })[0]).toMatchObject({ type: "cycling", category: "cycling", km: 20 });
	});

	it("ignores metrics, the location, the list itself and anything that is not an activity string", () => {
		const out = parseSessions({
			hrv: "55min", sleep_duration: "6h 13min", ohs_steps: "10min", trainings: "30min", workout_location: "45min",
			title: "Daily note", mood: "good", tags: ["a"], running: "5 km · foo", empty: "", cardio: "3x · 409 kcal",
		});
		expect(out).toEqual([]);
	});

	it("keeps the order of the keys", () => {
		expect(parseSessions({ running: "30min", yoga: "20min" }).map((s) => s.type)).toEqual(["running", "yoga"]);
	});
});

describe("parseSessions from the machine-readable list", () => {
	it("takes numbers and category from the list and the session count from the display key", () => {
		const out = parseSessions({
			running: "2x · 12 km · 90min",
			trainings: [{ type: "running", category: "running", distance_km: 12, duration_min: 90, avg_hr: 150, calories: 800 }],
		});
		expect(out).toEqual([{ type: "running", category: "running", count: 2, minutes: 90, km: 12, avgHr: 150, kcal: 800 }]);
	});

	it("defaults the count to one without a display key and falls back to the key's category", () => {
		const [s] = parseSessions({ trainings: [{ type: "hiking", duration_min: 120 }] });
		expect(s).toEqual({ type: "hiking", category: "outdoor", count: 1, minutes: 120, km: null, avgHr: null, kcal: null });
	});

	it("reads imperial entries and the prefixed list", () => {
		const [s] = parseSessions({ ohs_trainings: [{ type: "running", distance_mi: 3.1, duration_min: 30 }] });
		expect(s!.km).toBeCloseTo(4.989, 2);
	});

	it("skips entries that are not objects or have no type, and ignores values that are not numbers", () => {
		const out = parseSessions({ trainings: ["x", null, { duration_min: 30 }, { type: "yoga", duration_min: "30", avg_hr: Number.NaN }] });
		expect(out).toEqual([{ type: "yoga", category: "gym", count: 1, minutes: 0, km: null, avgHr: null, kcal: null }]);
	});

	it("falls back to the display keys when the list is not a list", () => {
		expect(parseSessions({ trainings: "none", yoga: "30min" }).map((s) => s.type)).toEqual(["yoga"]);
	});
});

describe("isRecovery", () => {
	const base = { count: 1, minutes: 10, km: null, avgHr: null, kcal: null };
	it("counts breathwork, meditation and the recovery category", () => {
		expect(isRecovery({ ...base, type: "breathwork", category: "other" })).toBe(true);
		expect(isRecovery({ ...base, type: "meditation", category: "other" })).toBe(true);
		expect(isRecovery({ ...base, type: "stretching", category: "recovery" })).toBe(true);
		expect(isRecovery({ ...base, type: "running", category: "running" })).toBe(false);
	});
});
