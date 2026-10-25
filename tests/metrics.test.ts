// Why it matters: METRICS drives the settings toggles, the labels and which endpoints are fetched.
// A metric with no label shows a raw key in the settings; a label with no metric is dead text.
import { describe, expect, it } from "vitest";
import { METRICS, applyPrefix, getDefaultEnabledMetrics } from "../src/metrics";
import { en } from "../src/i18n/en";

describe("METRICS", () => {
	it("has unique keys", () => {
		const keys = METRICS.map((m) => m.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("has an English label for every metric", () => {
		const missing = METRICS.filter((m) => !(`metric_${m.key}` in en)).map((m) => m.key);
		expect(missing).toEqual([]);
	});

	it("has no metric_ label that does not belong to a metric (other than the imperial variants)", () => {
		const keys = new Set(METRICS.map((m) => `metric_${m.key}`));
		const imperial = new Set(["metric_distance_mi", "metric_weight_lbs"]);
		const orphans = Object.keys(en).filter((k) => k.startsWith("metric_") && !keys.has(k) && !imperial.has(k));
		expect(orphans).toEqual([]);
	});

	it("enables exactly the six standard metrics by default", () => {
		const defaults = METRICS.filter((m) => m.defaultEnabled).map((m) => m.key);
		expect(defaults).toEqual(["steps", "sleep_duration", "sleep_score", "resting_hr", "hrv", "stress"]);
		expect(METRICS.filter((m) => m.category === "standard").every((m) => m.defaultEnabled)).toBe(true);
		expect(METRICS.filter((m) => m.category === "extended").some((m) => m.defaultEnabled)).toBe(false);
	});
});

describe("getDefaultEnabledMetrics", () => {
	it("returns a fresh object with every metric, so callers cannot share and mutate it", () => {
		const a = getDefaultEnabledMetrics();
		const b = getDefaultEnabledMetrics();
		expect(Object.keys(a).sort()).toEqual(METRICS.map((m) => m.key).sort());
		a["steps"] = false;
		expect(b["steps"]).toBe(true);
	});
});

describe("applyPrefix", () => {
	it("prepends the prefix, or leaves the key alone when it is empty", () => {
		expect(applyPrefix("steps", "ohs_")).toBe("ohs_steps");
		expect(applyPrefix("steps", "")).toBe("steps");
	});
});
