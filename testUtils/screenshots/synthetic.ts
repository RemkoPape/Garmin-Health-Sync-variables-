// Synthetic Garmin data for the documentation screenshots: one person, 170 days, generated from a fixed seed so the
// images are the same on every run. It is built to look like a real person and not like a test fixture: values
// drift and carry over from day to day, the week has a rhythm that is broken now and then, a cold takes a few days
// out, weekends differ, some days have no weight or no water logged, and the last days tell a small story (a heavy
// week, a short night, a dry day) so the cards have something to explain. Nothing here is real data.
import { shiftDate } from "../../src/dates";

type Fm = Record<string, unknown>;

/** The last day of the series, a Thursday. */
export const SERIES_END = "2026-10-22";
export const SERIES_DAYS = 170;

/** Small seeded generator (mulberry32), so every run draws the same numbers. */
function seeded(seed: number): () => number {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round = (v: number, step = 1): number => Math.round(v / step) * step;
const clock = (minutes: number): string => {
	const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
	return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const hm = (minutes: number): string => `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}min`;

interface Session {
	type: string;
	category: string;
	minutes: number;
	km: number | null;
	hr: number;
	kcal: number;
}

/** Weekly rhythm, as a person with a job and a training habit would keep it; the generator breaks it now and then. */
const PLAN: Record<number, (rand: () => number) => Session[]> = {
	1: (r) => [{ type: "strength_training", category: "strength", minutes: round(45 + r() * 20, 5), km: null, hr: 112 + Math.round(r() * 10), kcal: 280 }],
	2: (r) => [run(r, 42 + r() * 14, 5.6, 148)],
	3: (r) => (r() < 0.45 ? [{ type: "walking", category: "walking", minutes: round(35 + r() * 25, 5), km: 3.4, hr: 104, kcal: 150 }] : []),
	4: (r) => [run(r, 48 + r() * 16, 5.9, 163)],
	5: (r) => (r() < 0.3 ? [{ type: "yoga", category: "recovery", minutes: 30, km: null, hr: 88, kcal: 90 }] : []),
	6: (r) => (r() < 0.55 ? [{ type: "cycling", category: "cycling", minutes: round(95 + r() * 60, 5), km: 0, hr: 138 + Math.round(r() * 8), kcal: 0 }] : [run(r, 70 + r() * 25, 5.3, 144)]),
	0: (r) => (r() < 0.7 ? [run(r, 38 + r() * 25, 5.4, 146)] : [{ type: "hiking", category: "hiking", minutes: round(110 + r() * 50, 5), km: 8.5, hr: 118, kcal: 520 }]),
};

function run(r: () => number, minutes: number, minPerKm: number, hr: number): Session {
	const m = round(minutes);
	return { type: "running", category: "running", minutes: m, km: Math.round((m / (minPerKm + r() * 0.5 - 0.25)) * 10) / 10, hr: hr + Math.round(r() * 8 - 3), kcal: Math.round(m * 11.2) };
}

/** The person's days, oldest first, with the notes' frontmatter of each. */
export interface Series {
	end: string;
	days: Fm[];
}

export function generateSeries(): Series {
	const rand = seeded(20261022);
	const gauss = (): number => {
		const u = Math.max(rand(), 1e-9);
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
	};
	const start = shiftDate(SERIES_END, -(SERIES_DAYS - 1));
	const days: Fm[] = [];
	let fatigue = 0; // slowly fades, grows with training
	let hrvNoise = 0;
	let rhrNoise = 0;
	let weight = 79.6;
	let fat = 18.9;
	let vo2 = 51;
	for (let i = 0; i < SERIES_DAYS; i++) {
		const date = shiftDate(start, i);
		const weekday = new Date(`${date}T12:00:00`).getDay();
		const left = SERIES_DAYS - 1 - i; // days before the last one
		const weekend = weekday === 0 || weekday === 6;
		const cold = i >= 58 && i <= 64; // a cold: out for a week, not training
		const lightWeek = Math.floor(i / 7) % 4 === 3;

		// training: the plan, with skipped days and a lighter week every fourth; the last six days form a heavy block
		let sessions = PLAN[weekday]!(rand);
		if (cold) sessions = i === 64 ? [{ type: "walking", category: "walking", minutes: 30, km: 2.6, hr: 98, kcal: 110 }] : [];
		else if (rand() < 0.1) sessions = [];
		if (lightWeek && !cold) sessions = sessions.map((s) => ({ ...s, minutes: round(s.minutes * 0.7, 5), km: s.km === null ? null : Math.round(s.km * 0.7 * 10) / 10 }));
		if (left === 5) sessions = [{ type: "cycling", category: "cycling", minutes: 150, km: 0, hr: 141, kcal: 0 }];
		if (left === 4) sessions = [run(rand, 82, 5.4, 147), { type: "strength_training", category: "strength", minutes: 35, km: null, hr: 118, kcal: 210 }];
		if (left === 3) sessions = [{ type: "strength_training", category: "strength", minutes: 65, km: null, hr: 121, kcal: 340 }];
		if (left === 2) sessions = [run(rand, 62, 5.1, 168)];
		if (left === 1) sessions = [{ type: "running", category: "running", minutes: 55, km: 9.1, hr: 166, kcal: 610 }];
		if (left === 0) sessions = [];
		for (const s of sessions) if (s.type === "cycling") s.km = Math.round(s.minutes * 0.43 * 10) / 10, (s.kcal = Math.round(s.minutes * 9.5));
		const minutes = sessions.reduce((a, s) => a + s.minutes, 0);
		const hard = sessions.some((s) => s.hr >= 160) ? 1 : 0;

		// load carried from day to day
		fatigue = fatigue * 0.86 + minutes * (0.012 + hard * 0.012);
		const illness = cold ? clamp(1 - Math.abs(i - 61) / 4.5, 0.25, 1) : i >= 65 && i <= 67 ? 0.3 : 0;

		// sleep: weekdays earlier, weekends later; a few short nights; more after a hard day; a short night on the 2nd last day
		const bed = (weekend ? 24 * 60 + 25 + gauss() * 40 : 22 * 60 + 50 + gauss() * 28) + (weekday === 5 ? 35 : 0);
		let need = 7 * 60 + 5 + (weekend ? 24 : 0) + fatigue * 6 + gauss() * 32;
		if (rand() < 0.07) need -= 70 + rand() * 40;
		if (left === 1) need = 6 * 60 + 8;
		if (left === 2) need = 6 * 60 + 25;
		if (cold) need += 50;
		const awake = clamp(22 + gauss() * 8 + (left === 1 ? 14 : 0), 8, 48);
		const asleep = clamp(need, 5 * 60 + 20, 9 * 60 + 10);
		const inBed = asleep + awake;
		const deepShare = clamp(0.175 + gauss() * 0.022 - (fatigue > 4 ? 0.01 : 0), 0.1, 0.24);
		const remShare = clamp(0.215 + gauss() * 0.025, 0.12, 0.3);
		const deep = round(asleep * deepShare);
		const rem = round(asleep * remShare);
		const light = asleep - deep - rem;

		// HRV and resting heart rate: a slow trend, day-to-day carry-over, load, a cold, and now and then a bad night
		hrvNoise = hrvNoise * 0.55 + gauss() * 3.4;
		rhrNoise = rhrNoise * 0.5 + gauss() * 0.95;
		const hrvBase = 47 + i * 0.042; // fitness builds slowly
		let hrv = hrvBase + hrvNoise - fatigue * 1.35 - illness * 13 + (asleep - 435) * 0.012;
		if (rand() < 0.06) hrv -= 5 + rand() * 4;
		if (left === 0) hrv = hrvBase - 12.5; // the last morning: well under the usual range
		hrv = Math.round(clamp(hrv, 22, 78));
		let rhr = 54.6 - i * 0.012 + rhrNoise + fatigue * 0.32 + illness * 6.5 + (weekend ? 0.3 : 0);
		if (left === 0) rhr = 54.6 - i * 0.012 + 3.6;
		rhr = Math.round(clamp(rhr, 44, 72));

		// body battery, stress, readiness follow sleep, load and the working week
		const score = Math.round(clamp(76 + (asleep - 430) * 0.09 + (hrv - hrvBase) * 0.55 - (awake - 22) * 0.4 + gauss() * 3.2, 48, 96));
		const batteryMax = Math.round(clamp(28 + score * 0.72 + gauss() * 4 - fatigue * 1.1, 32, 100));
		const batteryMin = Math.round(clamp(batteryMax - (46 + minutes * 0.18 + (weekend ? 0 : 6) + gauss() * 6), 5, 60));
		const stress = Math.round(clamp(27 + (weekend ? -5 : 4) + fatigue * 0.8 + illness * 9 + gauss() * 4, 12, 62));
		const stressedMin = Math.round(clamp(110 + stress * 3.2 + gauss() * 40, 40, 420));
		const restMin = Math.round(clamp(330 - stress * 3.6 + gauss() * 45, 90, 520));
		const readiness = Math.round(clamp(40 + score * 0.35 + (hrv - hrvBase) * 1.4 - fatigue * 4 + gauss() * 4, 12, 96));

		// steps follow the working week and the training; floors and intensity minutes follow the day
		const trainingSteps = sessions.reduce((a, s) => a + (s.type === "running" ? s.minutes * 150 : s.type === "walking" || s.type === "hiking" ? s.minutes * 105 : s.type === "cycling" ? s.minutes * 20 : s.minutes * 25), 0);
		const base = weekend ? 5200 + rand() * 2800 : 6100 + gauss() * 1300;
		const steps = Math.round(clamp(base + trainingSteps * 0.8 - illness * 1800 + gauss() * 500, 1800, 28000));
		const floors = Math.round(clamp(8 + gauss() * 4 + (sessions.some((s) => s.type === "hiking") ? 18 : 0) + (weekend ? -2 : 1), 1, 55));
		const intensity = Math.round(sessions.reduce((a, s) => a + (s.category === "recovery" ? 0 : s.hr >= 150 ? s.minutes * 1.6 : s.hr >= 120 ? s.minutes * 0.9 : s.minutes * 0.4), 0) + 8 + rand() * 14);
		const activeKcal = Math.round(sessions.reduce((a, s) => a + s.kcal, 0) + steps * 0.045 + gauss() * 20);

		// body: weight drifts down slowly with weekend bumps and is not logged every day; a little more fitness in the VO2 value
		weight += -0.014 + gauss() * 0.11 + (weekday === 1 ? 0.05 : 0);
		fat = clamp(fat - 0.004 + gauss() * 0.03, 15, 25);
		if (sessions.some((s) => s.type === "running" && s.hr >= 160) && rand() < 0.25) vo2 += rand() < 0.65 ? 1 : -1;
		vo2 = clamp(vo2, 49, 56);
		const weighed = (weekday === 1 || weekday === 4 || rand() < 0.18) && !cold;

		// water: the goal grows with the day's activity; some days nothing is logged; weekends and busy days are drier
		const goal = round(2500 + minutes * 6 + (weekday === 6 ? 150 : 0), 50);
		let intake = round(goal * clamp(0.93 + gauss() * 0.14 - (weekend ? 0.05 : 0), 0.5, 1.28), 50);
		if (left === 1) intake = 1400;
		if (left === 0) intake = 0;
		const logged = intake > 0 && !(rand() < 0.1 && left > 1);

		const fm: Fm = {
			hrv,
			resting_hr: rhr,
			sleep_duration: hm(asleep),
			sleep_score: score,
			sleep_deep: hm(deep),
			sleep_rem: hm(rem),
			sleep_light: hm(light),
			sleep_awake: hm(awake),
			sleep_start: clock(bed),
			sleep_end: clock(bed + inBed),
			body_battery_max: batteryMax,
			body_battery_min: batteryMin,
			stress,
			stress_high: stressedMin,
			recovery_high: restMin,
			steps,
			floors,
			intensity_min: intensity,
			calories_active: activeKcal,
			calories_total: Math.round(2210 + activeKcal),
			distance_km: Math.round(((steps * 0.00074) + sessions.filter((s) => s.type === "cycling").reduce((a, s) => a + (s.km ?? 0), 0)) * 10) / 10,
			spo2: Math.round(clamp(96.2 + gauss() * 0.7 - illness * 1.6, 92, 99)),
			respiration_rate: Math.round(clamp(14.1 + gauss() * 0.45 + illness * 1.8 + (left === 0 ? 0.4 : 0), 12, 19) * 10) / 10,
			vo2_max: vo2,
			training_readiness: readiness,
			training_status: fatigue > 5.2 ? "STRAINED" : fatigue > 2.6 ? "PRODUCTIVE" : minutes === 0 && fatigue < 0.8 ? "MAINTAINING" : "PRODUCTIVE",
		};
		if (weighed) {
			fm["weight_kg"] = Math.round(weight * 10) / 10;
			fm["body_fat_pct"] = Math.round(fat * 10) / 10;
		}
		if (logged) {
			fm["hydration_ml"] = intake;
			fm["hydration_goal_ml"] = goal;
		} else if (intake === 0 && left === 0) {
			// today the water is not logged yet: the card shows no reading, the other days show their own
		} else {
			fm["hydration_goal_ml"] = goal;
		}
		for (const s of sessions) {
			const parts = [`${s.minutes}min`];
			if (s.km) parts.unshift(`${s.km} km`);
			parts.push(`Ø${s.hr} bpm`, `${s.kcal} kcal`);
			fm[s.type] = parts.join(" · ");
		}
		fm["trainings"] = sessions.map((s) => ({ type: s.type, category: s.category, distance_km: s.km ?? undefined, duration_min: s.minutes, avg_hr: s.hr, calories: s.kcal }));
		days.push(fm);
	}
	return { end: SERIES_END, days };
}

/** The notes up to `endOffset` days before the end of the series, as `frontmatter(ago)` of `seedHistory`. */
export function frontmatterAt(series: Series, endOffset: number): (ago: number) => Fm | null {
	return (ago) => series.days[series.days.length - 1 - endOffset - ago] ?? null;
}
