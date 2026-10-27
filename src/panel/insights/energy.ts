import { computeBattery } from "../cards/battery-card";
import { computeStress } from "../cards/stress-card";
import { formatMinutes } from "../cards/sleep-card";
import { MAX_INSIGHTS, type Insight } from "./registry";
import type { Signals } from "./signals";

const LOW_PEAK_MARGIN = 10;
const SHORT_NIGHT_MARGIN_MIN = 45;
const RECHARGE_MARGIN = 5;

export function batteryInsights(s: Signals): Insight[] {
	const b = computeBattery(s.index, s.date);
	if (b.max === null) return [];
	const sleep = s.sleep();
	const out: Insight[] = [];
	if (b.usualPeak !== null && b.max < b.usualPeak - LOW_PEAK_MARGIN) {
		if (sleep.minutes !== null && sleep.minutes < sleep.need - SHORT_NIGHT_MARGIN_MIN) out.push({ id: "battery_low_sleep", params: { sleep: formatMinutes(sleep.minutes) } });
		if ((s.z("stress", s.yesterday()) ?? 0) > 1) out.push({ id: "battery_low_stress" });
		if ((s.load().ratio ?? 0) > 1.3) out.push({ id: "battery_low_load" });
		if (out.length === 0) out.push({ id: "unexplained" });
	}
	if (b.charged !== null && b.usualCharged !== null && b.charged >= b.usualCharged + RECHARGE_MARGIN && sleep.minutes !== null && sleep.minutes >= sleep.need - 15) {
		out.push({ id: "battery_recharge_good", params: { sleep: formatMinutes(sleep.minutes) } });
	}
	return out.slice(0, MAX_INSIGHTS);
}

/** Garmin's bands: above 50 is medium or high stress, up to 25 is rest. */
const STRESS_HIGH = 50;
const STRESS_CALM = 25;
const WEEK_MARGIN = 10;

export function stressInsights(s: Signals): Insight[] {
	const { level, week, stressed, recovering } = computeStress(s.index, s.date);
	if (level === null) return [];
	const sleep = s.sleep();
	const out: Insight[] = [];
	if (stressed !== null && recovering !== null && stressed > recovering) out.push({ id: "stress_more_stressed", params: { stressed: formatMinutes(stressed), recovering: formatMinutes(recovering) } });
	if (level > STRESS_HIGH) {
		if (sleep.minutes !== null && sleep.minutes < sleep.need - 60) out.push({ id: "stress_high_sleep", params: { sleep: formatMinutes(sleep.minutes) } });
		if (week !== null && level > week + WEEK_MARGIN) out.push({ id: "stress_high_week", params: { week: String(Math.round(week)) } });
	} else if (level <= STRESS_CALM) {
		out.push({ id: "stress_calm" });
	}
	return out.slice(0, MAX_INSIGHTS);
}
