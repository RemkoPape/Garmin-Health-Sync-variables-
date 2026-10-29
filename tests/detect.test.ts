// Why it matters: a second device has the notes but not the plugin's settings. Reading the setup from the notes
// saves the user from an empty panel and from a first sync that writes a second set of properties next to the first,
// but a wrong guess (a note of something else, a blank template, a mix of prefixes) must never change settings.
import { describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { applyDetection, detectGarminData } from "../src/detect";
import { DEFAULT_SETTINGS, type HealthSyncSettings } from "../src/settings";

const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };
const GARMIN = { steps: 8000, resting_hr: 52, hrv: 48 };

function vaultWith(notes: Record<string, Record<string, unknown>>): never {
	const app = new App();
	for (const [path, fm] of Object.entries(notes)) {
		app.vault.seed(path, "---\n---\n");
		app.metadataCache.frontmatter.set(path, fm);
	}
	return app as never;
}
const fresh = (): HealthSyncSettings => ({ ...DEFAULT_SETTINGS, enabledMetrics: { ...DEFAULT_SETTINGS.enabledMetrics } });

describe("detectGarminData", () => {
	it("finds nothing in an empty vault, in notes without properties and in notes of something else", () => {
		expect(detectGarminData(new App() as never, settings)).toBeNull();
		expect(detectGarminData(vaultWith({ "2026-10-22.md": {} }), settings)).toBeNull();
		expect(detectGarminData(vaultWith({ "meeting.md": GARMIN, "2026-10-22.md": { mood: "good" } }), settings)).toBeNull();
	});

	it("needs three Garmin properties in a daily note: one steps property is no sync", () => {
		expect(detectGarminData(vaultWith({ "2026-10-22.md": { steps: 8000, resting_hr: 52 } }), settings)).toBeNull();
		expect(detectGarminData(vaultWith({ "2026-10-22.md": GARMIN }), settings)).toMatchObject({ notes: 1, metrics: ["hrv", "resting_hr", "steps"] });
	});

	it("takes only notes named by date, in any folder while none is set and only below it when one is", () => {
		const notes = { "Journal/2026-10-22.md": GARMIN, "Other/2026-10-21.md": { ...GARMIN, floors: 4 }, "Other/summary.md": { ...GARMIN, spo2: 96 } };
		expect(detectGarminData(vaultWith(notes), settings)).toMatchObject({ notes: 2, metrics: ["floors", "hrv", "resting_hr", "steps"] });
		expect(detectGarminData(vaultWith(notes), { ...settings, dailyNotePath: "Journal" })).toMatchObject({ notes: 1, metrics: ["hrv", "resting_hr", "steps"] });
	});

	it("ignores blank properties of a template, and values of the wrong kind", () => {
		const blank = { steps: null, resting_hr: "", hrv: "  ", sleep_score: Number.NaN, spo2: undefined };
		expect(detectGarminData(vaultWith({ "2026-10-22.md": blank }), settings)).toBeNull();
		const mixed = { ...GARMIN, floors: null, spo2: "" };
		expect(detectGarminData(vaultWith({ "2026-10-22.md": mixed }), settings)!.metrics).toEqual(["hrv", "resting_hr", "steps"]);
	});

	it("does not take a workout or any other property for a metric", () => {
		const fm = { ...GARMIN, running: "30min · Ø150 bpm", trainings: [{ type: "running" }], workout_location: "Park", mood: "ok" };
		expect(detectGarminData(vaultWith({ "2026-10-22.md": fm }), settings)!.metrics).toEqual(["hrv", "resting_hr", "steps"]);
	});

	it("collects the metrics of all notes", () => {
		const found = detectGarminData(vaultWith({ "2026-10-22.md": GARMIN, "2026-10-21.md": { steps: 1, sleep_duration: "7h 0min", sleep_score: 80 } }), settings)!;
		expect(found.notes).toBe(2);
		expect(found.metrics).toEqual(["hrv", "resting_hr", "sleep_duration", "sleep_score", "steps"]);
	});

	it("reads the prefix only when every Garmin property has it", () => {
		const prefixed = { ohs_steps: 8000, ohs_resting_hr: 52, ohs_hrv: 48 };
		expect(detectGarminData(vaultWith({ "2026-10-22.md": prefixed }), settings)).toMatchObject({ prefix: true, metrics: ["hrv", "resting_hr", "steps"] });
		expect(detectGarminData(vaultWith({ "2026-10-22.md": GARMIN }), settings)!.prefix).toBe(false);
		expect(detectGarminData(vaultWith({ "2026-10-22.md": prefixed, "2026-10-21.md": GARMIN }), settings)!.prefix).toBe(false);
		expect(detectGarminData(vaultWith({ "2026-10-22.md": { ...prefixed, hydration_ml: 1500 } }), settings)!.prefix).toBe(false);
	});

	it("reads imperial units when the notes hold miles or pounds and no kilometres or kilograms", () => {
		const found = detectGarminData(vaultWith({ "2026-10-22.md": { ...GARMIN, distance_mi: 3.1, weight_lbs: 170 } }), settings)!;
		expect(found.imperial).toBe(true);
		expect(found.metrics).toEqual(["distance_km", "hrv", "resting_hr", "steps", "weight_kg"]);
		expect(detectGarminData(vaultWith({ "2026-10-22.md": { ...GARMIN, distance_km: 5 } }), settings)!.imperial).toBe(false);
		expect(detectGarminData(vaultWith({ "2026-10-22.md": { ...GARMIN, distance_mi: 3.1 }, "2026-10-21.md": { ...GARMIN, weight_kg: 80 } }), settings)!.imperial).toBe(false);
	});

	it("finds habits of the lifestyle log by their numbers, also with the prefix, and only in a note that has Garmin data", () => {
		expect(detectGarminData(vaultWith({ "2026-10-22.md": { ...GARMIN, lifestyle_alcohol: 0 } }), settings)!.lifestyle).toBe(true);
		expect(detectGarminData(vaultWith({ "2026-10-22.md": { ...GARMIN, ohs_lifestyle_coffee: 3 } }), settings)!.lifestyle).toBe(true);
		expect(detectGarminData(vaultWith({ "2026-10-22.md": { ...GARMIN, lifestyle_mood: "good" } }), settings)!.lifestyle).toBe(false);
		expect(detectGarminData(vaultWith({ "2026-10-22.md": { lifestyle_alcohol: 1 } }), settings)).toBeNull();
		expect(detectGarminData(vaultWith({ "2026-10-22.md": { lifestyle_alcohol: 1, lifestyle_coffee: 2, lifestyle_run: 1 } }), settings)).toBeNull();
	});

	it("does not count the habit keys as metrics", () => {
		expect(detectGarminData(vaultWith({ "2026-10-22.md": { ...GARMIN, lifestyle_alcohol: 1 } }), settings)!.metrics).toEqual(["hrv", "resting_hr", "steps"]);
	});
});

describe("applyDetection", () => {
	const found = { notes: 3, metrics: ["floors", "steps"], prefix: false, imperial: false, lifestyle: false };

	it("switches the found metrics and the side panel on and leaves every other setting as it is", () => {
		const s = fresh();
		const before = { ...s.enabledMetrics };
		applyDetection(s, found);
		expect(s.enabledMetrics["floors"]).toBe(true);
		expect(s.panelEnabled).toBe(true);
		for (const [key, on] of Object.entries(before)) if (key !== "floors") expect(s.enabledMetrics[key], key).toBe(on);
		expect(s.usePrefix).toBe(false);
		expect(s.unitSystem).toBe("metric");
		expect(s.enabledMetrics["lifestyle_log"]).toBe(false);
	});

	it("never switches a metric off", () => {
		const s = fresh();
		applyDetection(s, { ...found, metrics: [] });
		expect(s.enabledMetrics).toEqual(fresh().enabledMetrics);
	});

	it("takes the prefix, the units and the lifestyle log from the notes", () => {
		const s = fresh();
		applyDetection(s, { ...found, prefix: true, imperial: true, lifestyle: true });
		expect(s.usePrefix).toBe(true);
		expect(s.unitSystem).toBe("imperial");
		expect(s.enabledMetrics["lifestyle_log"]).toBe(true);
	});
});
