// Why it matters: activity keys become property names in the user's notes and the category drives the
// machine-readable trainings. A changed key renames a property in every future note.
import { describe, expect, it } from "vitest";
import { getActivityCategory, normalizeActivityKey } from "../src/activity-keys";

describe("normalizeActivityKey", () => {
	it.each([
		["e_bike_fitness", "e_bike"],
		["e_bike_mountain", "e_mtb"],
		["resort_skiing_snowboarding", "skiing"],
		["backcountry_skiing_snowboarding", "backcountry_skiing"],
		["stand_up_paddleboarding", "sup"],
		["fitness_equipment", "gym_equipment"],
	])("shortens Garmin's verbose key %s to %s", (raw, expected) => {
		expect(normalizeActivityKey(raw)).toBe(expected);
	});

	it("passes known short keys through unchanged", () => {
		expect(normalizeActivityKey("running")).toBe("running");
	});

	it("lower-cases unknown keys and joins words with underscores", () => {
		expect(normalizeActivityKey("Some New Sport")).toBe("some_new_sport");
		expect(normalizeActivityKey("PADEL")).toBe("padel");
		expect(normalizeActivityKey("a   b")).toBe("a_b");
	});
});

describe("getActivityCategory", () => {
	it.each([
		["cycling", "cycling"],
		["e_mtb", "cycling"],
		["trail_running", "running"],
		["indoor_walking", "walking"],
		["hiking", "outdoor"],
		["open_water_swimming", "swimming"],
		["snowboarding", "winter"],
		["sup", "water"],
		["yoga", "gym"],
		["martial_arts", "gym"],
		["padel", "racket"],
		["soccer", "team"],
		["golf", "other"],
	])("puts %s in %s", (key, category) => {
		expect(getActivityCategory(key)).toBe(category);
	});

	it("falls back to other for an unknown activity", () => {
		expect(getActivityCategory("curling_on_mars")).toBe("other");
	});

	it("gives every cleaned-up key a real category (none falls through to 'other' by accident)", () => {
		for (const cleaned of ["e_bike", "e_mtb", "skiing", "backcountry_skiing", "sup", "gym_equipment"]) {
			expect(getActivityCategory(cleaned), cleaned).not.toBe("other");
		}
	});
});
