import { computeStages } from "../cards/stages-card";
import { formatClock, formatMinutes } from "../cards/sleep-card";
import { MAX_INSIGHTS, type Insight } from "./registry";
import type { Signals } from "./signals";

const SHORT_MARGIN_MIN = 30;
/** A bedtime or wake-up this much off the usual explains a short night. */
const SHIFT_MIN = 30;
const AVERAGE_GAP_MIN = 20;
const DEBT_HIGH_MIN = 180;
const IRREGULAR_SD_MIN = 60;
const REGULAR_SD_MIN = 30;
const SHORT_FOR_REM_MIN = 45;

/** How far last night's bedtime and wake-up were from the usual ones, in minutes (late bedtime, early wake-up), or null. */
function shifts(s: Signals): { late: number; early: number } | null {
	const sleep = s.sleep();
	const night = sleep.nights[sleep.nights.length - 1]!;
	if (!sleep.schedule || night.bed === null || night.span === null) return null;
	return { late: night.bed - sleep.schedule.bedAbs, early: sleep.schedule.wakeAbs - (night.bed + night.span) };
}

export function sleepInsights(s: Signals): Insight[] {
	const sleep = s.sleep();
	const { minutes, need, schedule } = sleep;
	if (minutes === null) return [];
	const out: Insight[] = [];
	const shift = shifts(s);
	if (minutes < need - SHORT_MARGIN_MIN && shift) {
		if (shift.late >= SHIFT_MIN) out.push({ id: "sleep_short_late_bed", params: { late: formatMinutes(shift.late), bed: formatClock(schedule!.bed), gain: formatMinutes(Math.min(shift.late, need - minutes)) } });
		if (shift.early >= SHIFT_MIN) out.push({ id: "sleep_short_early_wake", params: { early: formatMinutes(shift.early), wake: formatClock(schedule!.wake) } });
	}
	const slept: number[] = [];
	for (const n of sleep.nights) if (n.minutes !== null) slept.push(n.minutes);
	if (slept.length >= 5) {
		const average = slept.reduce((a, b) => a + b, 0) / slept.length;
		if (need - average >= AVERAGE_GAP_MIN) out.push({ id: "sleep_short_average", params: { avg: formatMinutes(average), gap: formatMinutes(need - average), need: String(need / 60) } });
	}
	if (sleep.debt !== null && sleep.debt >= DEBT_HIGH_MIN) out.push({ id: "sleep_debt_high", params: { debt: formatMinutes(sleep.debt) } });
	if (schedule && Math.max(schedule.bedSd, schedule.wakeSd) >= IRREGULAR_SD_MIN) out.push({ id: "sleep_irregular", params: { sd: String(Math.round(Math.max(schedule.bedSd, schedule.wakeSd))) } });
	if (out.length === 0 && minutes < need - SHORT_MARGIN_MIN) out.push({ id: "sleep_short_plain", params: { gap: formatMinutes(need - minutes), need: String(need / 60) } });
	if (out.length === 0 && minutes >= need && (sleep.debt ?? 0) < 60) {
		const regular = schedule !== null && schedule.bedSd < REGULAR_SD_MIN && schedule.wakeSd < REGULAR_SD_MIN;
		out.push(regular ? { id: "sleep_regular_good", params: { sd: String(Math.round(Math.max(schedule.bedSd, schedule.wakeSd))) } } : { id: "sleep_enough_good", params: { sleep: formatMinutes(minutes) } });
	}
	return out.slice(0, MAX_INSIGHTS);
}

export function stagesInsights(s: Signals): Insight[] {
	const { stages } = computeStages(s.index, s.date);
	if (stages === null) return [];
	const z = (id: string): number | null => stages.find((st) => st.spec.id === id)?.deviation?.z ?? null;
	const deep = z("deep");
	const rem = z("rem");
	const awake = z("awake");
	const sleep = s.sleep();
	const out: Insight[] = [];
	let unexplained = false;
	const yesterdaySteps = s.z("steps", s.yesterday());

	if (deep !== null && deep < -1) {
		if ((yesterdaySteps ?? 0) < -0.5) out.push({ id: "deep_low_inactive" });
		if (awake !== null && awake > 1) out.push({ id: "deep_low_fragmented" });
		if (out.length === 0) out.push({ id: "deep_low_timing" });
	}
	if (rem !== null && rem < -1) {
		const shift = shifts(s);
		if (shift && shift.early >= 20) out.push({ id: "rem_low_early_wake", params: { early: formatMinutes(shift.early), wake: formatClock(sleep.schedule!.wake) } });
		else if (sleep.minutes !== null && sleep.minutes < sleep.need - SHORT_FOR_REM_MIN) out.push({ id: "rem_low_short_night", params: { gap: formatMinutes(sleep.need - sleep.minutes) } });
		else unexplained = true;
	}
	if (awake !== null && awake > 1) {
		if ((s.z("stress") ?? 0) > 1) out.push({ id: "awake_high_stress" });
		else if ((s.z("respiration_rate") ?? 0) > 1 || (s.z("spo2") ?? 0) < -1) out.push({ id: "awake_high_breathing" });
		else unexplained = true;
	}
	if (unexplained) out.push({ id: "unexplained" });
	if (deep !== null && deep > 1 && (yesterdaySteps ?? 0) > 0.5) out.push({ id: "stages_deep_active" });
	if (out.length === 0 && deep !== null && rem !== null && awake !== null) out.push({ id: "stages_typical" });
	return out.slice(0, MAX_INSIGHTS);
}
