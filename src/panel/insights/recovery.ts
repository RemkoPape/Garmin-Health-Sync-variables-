import { formatMinutes } from "../cards/sleep-card";
import { windowValues } from "../stats";
import { shiftDate } from "../../dates";
import { MAX_INSIGHTS, type Insight } from "./registry";
import type { Signals } from "./signals";

const hours = (minutes: number): string => String(minutes / 60);
const pct = (share: number): string => String(Math.round(Math.abs(share) * 100));
/** A training load this far above the person's norm counts as a spike (the 'strain' zone starts at 1.3). */
const SPIKE_RATIO = 1.3;
const SLEEP_DEBT_MIN = 120;

export function hrvInsights(s: Signals): Insight[] {
	const z = s.z("hrv");
	if (z === null) return [];
	const out: Insight[] = [];
	if (z < -1) {
		const { ratio } = s.load();
		const { debt, need } = s.sleep();
		if (ratio !== null && ratio > SPIKE_RATIO) out.push({ id: "hrv_low_load", params: { pct: pct(ratio - 1) } });
		if (debt !== null && debt >= SLEEP_DEBT_MIN) out.push({ id: "hrv_low_sleep", params: { debt: formatMinutes(debt), need: hours(need) } });
		if ((s.z("stress") ?? 0) > 1) out.push({ id: "hrv_low_stress" });
		if ((s.z("resting_hr") ?? 0) > 1) out.push({ id: "hrv_low_illness" });
		if (out.length === 0) out.push({ id: "unexplained" });
	} else if (z > 1) {
		const { ratio } = s.load();
		if (ratio !== null && ratio < 1) out.push({ id: "hrv_high_light_load", params: { pct: pct(1 - ratio) } });
	} else {
		out.push({ id: "hrv_in_range" });
	}
	return out.slice(0, MAX_INSIGHTS);
}

export function restingHrInsights(s: Signals): Insight[] {
	const z = s.z("resting_hr");
	if (z === null) return [];
	const out: Insight[] = [];
	if (z > 1) {
		const { ratio } = s.load();
		const { debt } = s.sleep();
		if (ratio !== null && ratio > SPIKE_RATIO) out.push({ id: "rhr_high_load", params: { pct: pct(ratio - 1) } });
		if (debt !== null && debt >= SLEEP_DEBT_MIN) out.push({ id: "rhr_high_sleep", params: { debt: formatMinutes(debt) } });
		if ((s.z("hrv") ?? 0) < -1 || (s.z("respiration_rate") ?? 0) > 1) out.push({ id: "rhr_high_illness" });
		if (out.length === 0) out.push({ id: "unexplained" });
	} else if (z < -1) {
		out.push({ id: "rhr_low_fitness" });
	} else {
		out.push({ id: "rhr_in_range" });
	}
	return out.slice(0, MAX_INSIGHTS);
}

/** Nights of the last 7 (the shown one included) with an average SpO2 below this count as low. */
const SPO2_LOW_NIGHT = 92;
const SPO2_REPEATED_NIGHTS = 3;

export function spo2Insights(s: Signals): Insight[] {
	const value = s.index.value("spo2", s.date);
	if (value === null) return [];
	const z = s.z("spo2");
	const out: Insight[] = [];
	const recent = windowValues(s.index, "spo2", shiftDate(s.date, 1), 7);
	const lowNights = recent.filter((v) => v < SPO2_LOW_NIGHT).length;
	const low = value < 94 || (z !== null && z < -1);
	if (lowNights >= SPO2_REPEATED_NIGHTS) out.push({ id: "spo2_low_repeated", params: { n: String(lowNights) } });
	if (low && (s.z("respiration_rate") ?? 0) > 1) out.push({ id: "spo2_low_with_breathing" });
	if (low && out.length === 0) out.push({ id: "spo2_low_single" });
	if (!low && value >= 95) out.push({ id: "spo2_ok" });
	return out.slice(0, MAX_INSIGHTS);
}

/** Breaths a minute above the person's usual that count as raised on their own. */
const BREATHING_RISE = 1.5;

export function breathingInsights(s: Signals): Insight[] {
	const z = s.z("respiration_rate");
	const delta = s.delta("respiration_rate");
	if (z === null || delta === null) return [];
	if (z > 1 || delta >= BREATHING_RISE) return [{ id: (s.z("resting_hr") ?? 0) > 1 ? "breathing_up_illness" : "breathing_up_alone" }];
	return z < -1 ? [] : [{ id: "breathing_ok" }];
}
