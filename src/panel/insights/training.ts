import { daysBetween, localDateString, shiftDate, weekStart } from "../../dates";
import { computeLoad } from "../cards/load-card";
import { computeWeekly } from "../cards/weekly-card";
import { isRecovery } from "../sessions";
import { maxHrAt, zoneOf } from "../zones";
import type { Insight } from "./registry";
import type { Signals } from "./signals";

const pct = (share: number): string => String(Math.round(Math.abs(share) * 100));

export function loadInsights(s: Signals): Insight[] {
	const m = computeLoad(s.index, s.date, s.birthYear);
	if (m.ratio === null || m.zone === null) return [];
	if (m.zone === 4) return [{ id: "load_overreach", params: { pct: pct(m.ratio - 1) } }];
	if (m.zone === 3) return [{ id: "load_strain", params: { pct: pct(m.ratio - 1) } }];
	if (m.zone === 0) return [{ id: "load_detrain", params: { pct: pct(1 - m.ratio) } }];
	if (m.zone === 1) return [{ id: "load_maintain" }];
	return [{ id: "load_build" }];
}

/** A week within this share of the cap, below it, is on track. */
const ON_TRACK_FROM = 0.8;

export function weeklyInsights(s: Signals): Insight[] {
	const m = computeWeekly(s.index, s.date);
	if (m.average === null || m.cap === null || m.average === 0) return [];
	if (m.minutes > m.cap) return [{ id: "weekly_over_cap", params: { pct: pct(m.minutes / m.average - 1) } }];
	const out: Insight[] = [];
	if (m.minutes >= m.cap * ON_TRACK_FROM) out.push({ id: "weekly_on_track" });
	// today, with days of the week left: what the room to the limit comes to per day
	const daysLeft = daysBetween(s.date, shiftDate(weekStart(s.date), 6)) + 1;
	if (s.date === localDateString(new Date())) {
		const left = Math.round(m.cap - m.minutes);
		out.push({ id: "weekly_room", params: { left: String(left), perDay: String(Math.ceil(left / daysLeft)), days: String(daysLeft) } });
	}
	return out;
}

const MIN_SESSIONS = 3;
const EASY_SHARE = 0.6;

/** The balance of easy and hard sessions in the last 7 days, from heart rate zones (needs the birth year). */
export function sessionsInsights(s: Signals): Insight[] {
	const out: number[] = [];
	for (let i = 0; i < 7; i++) {
		const day = shiftDate(s.date, -i);
		const maxHr = maxHrAt(s.birthYear, day);
		if (maxHr === null) return [];
		for (const session of s.index.sessions(day)) if (!isRecovery(session) && session.avgHr !== null) out.push(zoneOf(session.avgHr, maxHr));
	}
	if (out.length < MIN_SESSIONS) return [];
	const hard = out.filter((z) => z >= 4).length;
	const easy = out.filter((z) => z <= 2).length;
	if (hard >= MIN_SESSIONS && easy === 0) return [{ id: "sessions_all_hard", params: { n: String(hard) } }];
	if (hard >= 1 && easy / out.length >= EASY_SHARE) return [{ id: "sessions_mostly_easy", params: { pct: pct(easy / out.length) } }];
	return hard >= 1 && easy >= 1 ? [{ id: "sessions_balanced", params: { easy: String(easy), hard: String(hard) } }] : [];
}
