// Why it matters: the sessions card is where a user sees what the watch recorded. A name must read right in their
// language, a newer Garmin key must not show a suffix, and an activity nobody named must still be shown, not hidden.
import { describe, expect, it } from "vitest";
import { activityLabel, stripGarminSuffix } from "../src/activity-names";
import { getActivityCategory } from "../src/activity-keys";

describe("activityLabel", () => {
	it("names an activity in each of the six languages", () => {
		expect(["en", "de", "es", "fr", "ja", "zh"].map((l) => activityLabel("running", l))).toEqual(["Running", "Laufen", "Carrera", "Course à pied", "ランニング", "跑步"]);
	});

	it("reads a key with Garmin's suffix like the plain key", () => {
		expect(stripGarminSuffix("kayaking_v2")).toBe("kayaking");
		expect(stripGarminSuffix("skate_skiing_ws")).toBe("skate_skiing");
		expect(activityLabel("kayaking_v2", "de")).toBe("Kajakfahren");
	});

	it("shows an activity without a name as readable text, in every language, and an unknown language in English", () => {
		expect(activityLabel("curling_on_mars_v2", "ja")).toBe("Curling on mars");
		expect(activityLabel("running", "xx")).toBe("Running");
	});

	it("has a filled name in every language for the sports the watches send", () => {
		const keys = ["running", "trail_running", "treadmill_running", "indoor_running", "street_running", "track_running", "virtual_run", "cycling", "road_biking", "mountain_biking", "gravel_cycling", "indoor_cycling", "virtual_ride", "e_bike", "e_mtb", "walking", "indoor_walking", "hiking", "mountaineering", "rock_climbing", "indoor_climbing", "bouldering", "lap_swimming", "swimming", "open_water_swimming", "strength_training", "gym_equipment", "yoga", "pilates", "hiit", "cardio", "indoor_cardio", "elliptical", "stair_stepper", "stair_climbing", "rowing", "indoor_rowing", "skiing", "cross_country_skiing", "backcountry_skiing", "snowboarding", "snowshoeing", "kayaking", "paddling", "sup", "surfing", "sailing", "kiteboarding", "windsurfing", "tennis", "padel", "pickleball", "badminton", "squash", "table_tennis", "golf", "soccer", "basketball", "volleyball", "rugby", "hockey", "ice_hockey", "cricket", "boxing", "martial_arts", "jump_rope", "dancing", "horseback_riding", "ice_skating", "inline_skating", "skating", "meditation", "breathwork", "stretching", "mobility", "multi_sport", "triathlon", "workout", "treadmill", "pool_swimming"];
		for (const key of keys) {
			const names = ["en", "de", "es", "fr", "ja", "zh"].map((l) => activityLabel(key, l));
			expect(names.every((n) => n.trim() !== ""), key).toBe(true);
			expect(getActivityCategory(key)).toBeTruthy();
		}
	});
});
