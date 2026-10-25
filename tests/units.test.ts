// Why it matters: imperial users get their distance and weight converted before it is written into
// their notes. A wrong factor, or a mutated input, silently corrupts what the sync caches and writes.
import { describe, expect, it } from "vitest";
import { convertToImperial } from "../src/units";
import type { HealthData } from "../src/providers/provider";

const data = (): HealthData => ({
	metrics: { steps: 8000, distance_km: 10, weight_kg: 80 },
	activities: { running: "10 km · 50min", cycling: "2x 20.5 km · 90min" },
	trainings: [
		{ type: "running", category: "running", distance_km: 10, duration_min: 50 },
		{ type: "yoga", category: "gym", duration_min: 30 },
	],
});

describe("convertToImperial", () => {
	it("converts distance to miles and weight to pounds with one decimal, renaming the keys", () => {
		const out = convertToImperial(data());
		expect(out.metrics).toEqual({ steps: 8000, distance_mi: 6.2, weight_lbs: 176.4 });
	});

	it("rewrites kilometres inside activity strings and leaves the rest alone", () => {
		const out = convertToImperial(data());
		expect(out.activities).toEqual({ running: "6.2 mi · 50min", cycling: "2x 12.7 mi · 90min" });
	});

	it("converts a training's distance and keeps entries without a distance as they are", () => {
		const out = convertToImperial(data());
		expect(out.trainings).toEqual([
			{ type: "running", category: "running", duration_min: 50, distance_mi: 6.2 },
			{ type: "yoga", category: "gym", duration_min: 30 },
		]);
	});

	it("does not mutate its input", () => {
		const input = data();
		convertToImperial(input);
		expect(input).toEqual(data());
	});

	it("leaves metrics alone when there is no distance or weight, and tolerates missing trainings", () => {
		const out = convertToImperial({ metrics: { steps: 1 }, activities: {} });
		expect(out).toEqual({ metrics: { steps: 1 }, activities: {}, trainings: undefined });
	});

	it("handles a zero distance", () => {
		const out = convertToImperial({ metrics: { distance_km: 0 }, activities: {} });
		expect(out.metrics).toEqual({ distance_mi: 0 });
	});
});
