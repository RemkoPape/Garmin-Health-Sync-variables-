import { shiftDate } from "../../dates";
import { GLASS_ML, computeHydration, hydrationShare } from "../cards/hydration-card";
import { MAX_INSIGHTS, type Insight } from "./registry";
import type { Signals } from "./signals";

/** Under this share of the aim a day counts as a dry one. */
export const DRY_SHARE = 0.75;
const DRY_STREAK = 3;
const STREAK_LOOKBACK = 5;
/** Today is judged from this hour on, and behind when under this share of the intake that is due by now. */
const PACE_FROM_HOUR = 12;
const PACE_SHARE = 0.7;

export function hydrationInsights(s: Signals): Insight[] {
	const m = computeHydration(s.index, s.date);
	if (m.intake === null) return [];
	const out: Insight[] = [];
	const { goal, pace } = m;
	if (goal !== null) {
		const left = Math.round(goal - m.intake);
		if (left <= 0) out.push({ id: "hydration_goal_good" });
		else if (pace === null) out.push({ id: "hydration_below_goal", params: { pct: String(Math.round((m.intake / goal) * 100)) } });
		else if (new Date().getHours() >= PACE_FROM_HOUR && m.intake < pace * PACE_SHARE) out.push({ id: "hydration_behind_pace", params: { ml: String(Math.round(left / 10) * 10), glasses: String(Math.max(1, Math.round(left / GLASS_ML))) } });
		else out.push({ id: "hydration_on_pace" });
	}
	let dry = 0;
	for (let i = 1; i <= STREAK_LOOKBACK; i++) if ((hydrationShare(s.index, shiftDate(s.date, -i)) ?? 1) < DRY_SHARE) dry++;
	if (dry >= DRY_STREAK) out.push({ id: "hydration_low_streak", params: { n: String(dry) } });
	return out.slice(0, MAX_INSIGHTS);
}

/** Whether the day before was a dry one (the intake of the day itself is not over when a morning reading is judged). */
export function dryYesterday(s: Signals): boolean {
	const share = hydrationShare(s.index, s.yesterday());
	return share !== null && share < DRY_SHARE;
}
