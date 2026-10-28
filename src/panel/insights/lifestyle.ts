import { formatNumber } from "../format";
import type { HabitsModel } from "../cards/habits-card";
import { MIN_GROUP } from "../habits";
import { MAX_INSIGHTS, type Insight, type InsightId } from "./registry";
import type { Measure } from "../habits";

/** A habit with this few days logged as no (or fewer) while it has enough days with it is missing the other half of the comparison. */
const FEW_NO_DAYS = 3;

/** The clear patterns of the habits, the strongest first: what the nights after a habit look like. */
export function habitInsights(model: HabitsModel, lang: string): Insight[] {
	const found: { t: number; insight: Insight }[] = [];
	for (const h of model.habits) {
		for (const measure of ["hrv", "resting_hr"] as Measure[]) {
			const e = h[measure];
			if (!e?.clear) continue;
			const id: InsightId = measure === "hrv" ? (e.diff > 0 ? "lifestyle_hrv_up" : "lifestyle_hrv_down") : e.diff < 0 ? "lifestyle_rhr_down" : "lifestyle_rhr_up";
			found.push({ t: Math.abs(e.t), insight: { id, params: { habit: h.name, diff: formatNumber(Math.abs(e.diff), lang, 0), n: String(e.with), m: String(e.without) } } });
		}
	}
	const out = found.sort((a, b) => b.t - a.t).map((f) => f.insight);
	// a habit that is only ever logged as yes cannot be compared: say what to log
	for (const h of model.habits) {
		if (h.with >= MIN_GROUP && h.without < FEW_NO_DAYS) out.push({ id: "lifestyle_no_days", params: { habit: h.name, n: String(h.without) } });
	}
	return out.slice(0, MAX_INSIGHTS);
}
