import { formatNumber } from "../format";
import { MIN_GROUP, type HabitRow, type Measure } from "../habits";
import type { Insight, InsightId } from "./registry";

/** A habit with this few days logged as no (or fewer) while it has enough days with it is missing the other half of the comparison. */
const FEW_NO_DAYS = 3;

/** What the data says about one habit: the clear patterns of the nights after it, the strongest first, and what to log when it has no "no" days. */
export function habitInsights(h: HabitRow, lang: string): Insight[] {
	const found: { t: number; insight: Insight }[] = [];
	for (const measure of ["hrv", "resting_hr"] as Measure[]) {
		const e = h[measure];
		if (!e?.clear) continue;
		const id: InsightId = measure === "hrv" ? (e.diff > 0 ? "lifestyle_hrv_up" : "lifestyle_hrv_down") : e.diff < 0 ? "lifestyle_rhr_down" : "lifestyle_rhr_up";
		found.push({ t: Math.abs(e.t), insight: { id, params: { habit: h.name, diff: formatNumber(Math.abs(e.diff), lang, 0), n: String(e.with), m: String(e.without) } } });
	}
	const out = found.sort((a, b) => b.t - a.t).map((f) => f.insight);
	// a habit that is only ever logged as yes cannot be compared: say what to log
	if (h.with >= MIN_GROUP && h.without < FEW_NO_DAYS) out.push({ id: "lifestyle_no_days", params: { habit: h.name, n: String(h.without) } });
	return out;
}
