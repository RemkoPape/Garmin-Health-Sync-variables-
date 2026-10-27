// Why it matters: hiding a property from a note's header is only right for what the panel really shows. Hiding
// a value the panel does not draw, or while the panel is off, would take it out of sight with nothing in its place.
import { describe, expect, it } from "vitest";
import { visualisedKeys } from "../src/panel/visualised";

describe("visualisedKeys", () => {
	it("is empty while the panel is off", () => {
		expect(visualisedKeys({ panelEnabled: false, panelCards: {} }).size).toBe(0);
	});

	it("holds the metrics of every card that is on, with the details a card also draws", () => {
		const keys = visualisedKeys({ panelEnabled: true, panelCards: {} });
		for (const key of ["hrv", "resting_hr", "sleep_duration", "sleep_start", "stress_high", "calories_total", "vo2_max", "weight_kg", "body_fat_pct", "intensity_min", "floors", "training_status"]) expect(keys.has(key), key).toBe(true);
	});

	it("also holds the imperial names of distance and weight", () => {
		const keys = visualisedKeys({ panelEnabled: true, panelCards: {} });
		expect(keys.has("distance_mi")).toBe(true);
		expect(keys.has("weight_lbs")).toBe(true);
	});

	it("holds the activities, the training list and the place when a card draws sessions, and not otherwise", () => {
		const on = visualisedKeys({ panelEnabled: true, panelCards: {} });
		for (const key of ["running", "cycling", "walking", "hiking", "trainings", "workout_location"]) expect(on.has(key), key).toBe(true);
		const off = visualisedKeys({ panelEnabled: true, panelCards: { sessions: false, weekly: false, load: false } });
		for (const key of ["running", "trainings", "workout_location"]) expect(off.has(key), key).toBe(false);
		expect(visualisedKeys({ panelEnabled: true, panelCards: { sessions: false, load: false } }).has("running")).toBe(true); // the weekly card still uses them
	});

	it("leaves out what only switched off cards would show", () => {
		const keys = visualisedKeys({ panelEnabled: true, panelCards: { hrv: false, today: false, vo2: false } });
		expect(keys.has("hrv")).toBe(false);
		expect(keys.has("vo2_max")).toBe(false);
		expect(keys.has("resting_hr")).toBe(true);
	});
});
