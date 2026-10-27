import { shiftDate } from "../../dates";
import { computeBody } from "../cards/body-card";
import { computeIntensity } from "../cards/intensity-card";
import { computeSteps } from "../cards/steps-card";
import { computeFloors } from "../cards/floors-card";
import { weekdayPattern } from "../longview";
import { computeVo2 } from "../cards/vo2-card";
import { minutesBetween } from "../load";
import type { Insight } from "./registry";
import type { Signals } from "./signals";

/** Quiet days among the five before the shown day that make a streak. */
const QUIET_STREAK = 3;
const QUIET_Z = -0.5;
/** A day with fewer floors than this share of the usual counts as quiet. */
const QUIET_FLOORS_SHARE = 0.8;

/** The weekday of the shown day averages at most this share of the person's other days to count as a quiet day of the week. */
const QUIET_WEEKDAY_SHARE = 0.75;

export function stepsInsights(s: Signals): Insight[] {
	const { steps, base } = computeSteps(s.index, s.date);
	if (steps === null || base === null) return [];
	if (steps >= base * 1.1) return [{ id: "steps_zone_good" }];
	const out: Insight[] = [];
	if (steps >= base) out.push({ id: "steps_in_zone", params: { base: String(Math.round(base)) } });
	else {
		let quiet = 0;
		for (let i = 1; i <= 5; i++) if ((s.z("steps", shiftDate(s.date, -i)) ?? 0) < QUIET_Z) quiet++;
		if (quiet >= QUIET_STREAK) out.push({ id: "steps_below_streak", params: { n: String(quiet) } });
		// the pattern of the last half year: this weekday is usually the quiet one
		const pattern = weekdayPattern((d) => s.index.value("steps", d), s.date);
		if (pattern && pattern.weekday <= pattern.others * QUIET_WEEKDAY_SHARE) {
			out.push({ id: "steps_weekday_low", params: { dayOf: s.date, avg: String(Math.round(pattern.weekday)), pct: String(Math.round((1 - pattern.weekday / pattern.others) * 100)) } });
		}
	}
	return out;
}

export function floorsInsights(s: Signals): Insight[] {
	const { floors, zone } = computeFloors(s.index, s.date);
	if (floors === null || zone === null) return [];
	if (floors >= zone.low && floors > 0) return [{ id: "floors_zone_good" }];
	let quiet = 0;
	for (let i = 1; i <= 5; i++) if ((s.index.value("floors", shiftDate(s.date, -i)) ?? zone.low) < zone.low * QUIET_FLOORS_SHARE) quiet++;
	return quiet >= QUIET_STREAK ? [{ id: "floors_below_streak", params: { n: String(quiet) } }] : [];
}

export function intensityInsights(s: Signals): Insight[] {
	const m = computeIntensity(s.index, s.date, s.birthYear);
	if (m.total === null) return [];
	const daysLeft = m.days.filter((d) => d.future).length;
	if (m.remaining === 0) return [{ id: "intensity_goal_good" }];
	return m.perDay !== null && daysLeft > 0 ? [{ id: "intensity_behind", params: { perDay: String(m.perDay), days: String(daysLeft) } }] : [];
}

const FALL_IN_VOLUME = 0.8;
const WINDOW = 28;

export function vo2Insights(s: Signals): Insight[] {
	const m = computeVo2(s.index, s.date);
	if (m.latest === null) return [];
	if (m.direction === "up") return [{ id: "vo2_up_good" }];
	const recent = minutesBetween(s.index, shiftDate(s.date, -(WINDOW - 1)), s.date);
	if (m.direction === "steady") return recent > 0 ? [{ id: "vo2_steady", params: { min: String(Math.round(recent / (WINDOW / 7))) } }] : [];
	if (m.direction !== "down") return [];
	const before = minutesBetween(s.index, shiftDate(s.date, -(2 * WINDOW - 1)), shiftDate(s.date, -WINDOW));
	return before > 0 && recent < before * FALL_IN_VOLUME ? [{ id: "vo2_down_volume", params: { pct: String(Math.round((1 - recent / before) * 100)) } }] : [{ id: "vo2_down_other" }];
}

export function bodyInsights(s: Signals): Insight[] {
	const m = computeBody(s.index, s.date);
	if (m.weight === null || m.perWeek === null) return [];
	return m.fast ? [{ id: "body_fast" }] : m.entries >= 3 ? [{ id: "body_stable" }] : [];
}
