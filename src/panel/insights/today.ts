import { computeToday, type FlagId } from "../cards/today-card";
import { formatMinutes } from "../cards/sleep-card";
import { MAX_INSIGHTS, type Insight, type InsightId } from "./registry";
import type { Signals } from "./signals";

const FLAG_INSIGHT: Record<FlagId, InsightId> = {
	hrv: "today_flag_hrv",
	rhr: "today_flag_rhr",
	sleep: "today_flag_sleep",
	battery: "today_flag_battery",
	stress: "today_flag_stress",
	breathing: "today_flag_breathing",
	spo2: "today_flag_spo2",
	load: "today_flag_load",
};

/** One line per flag that shaped the verdict, or a note that nothing stands out. */
export function todayInsights(s: Signals): Insight[] {
	const m = computeToday(s.index, s.date, s.birthYear);
	if (m.score === null) return [];
	if (m.flags.length === 0) return [{ id: "today_no_flags" }];
	const out = m.flags.map((flag): Insight => {
		const id = FLAG_INSIGHT[flag];
		if (flag === "sleep") return { id, params: { debt: formatMinutes(m.facts.debt!) } };
		if (flag === "battery") return { id, params: { gap: String(Math.round(m.facts.batteryGap!)) } };
		if (flag === "load") return { id, params: { pct: String(Math.round((m.facts.loadRatio! - 1) * 100)) } };
		return { id };
	});
	return out.slice(0, MAX_INSIGHTS);
}
