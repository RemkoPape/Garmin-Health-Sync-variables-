// Why it matters: the Habits card tells a person which of their habits go with better or worse nights. A habit on day D
// must be set against the night after it (D+1), a day without an entry must never count as "no", and a difference must
// only be called a pattern when there is enough of it, or the card invents advice from noise.
import { describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { computeHabits, ACTIVE_DAYS, MIN_GROUP } from "../src/panel/habits";

const END = "2026-10-22";
const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };
const NAMES = { lifestyle_alcohol: { name: "Alcohol", kind: "check" as const }, lifestyle_coffee: { name: "Late caffeine", kind: "count" as const } };
const noise = (i: number): number => (((i * 37) % 11) - 5) * 0.3;
/** Mixed yes and no days, the same for every test. */
const habitOn = (ago: number): boolean => {
	let x = Math.imul(ago + 1, 0x9e3779b1);
	x ^= x >>> 15;
	x = Math.imul(x, 0x85ebca6b);
	x ^= x >>> 13;
	return (x & 1) === 0;
};

async function index(days: number, frontmatter: (ago: number) => Record<string, unknown> | null): Promise<DayIndex> {
	const app = new App();
	await seedHistory(app, { end: END, days, frontmatter });
	return new DayIndex(app as never, () => settings);
}

describe("computeHabits", () => {
	it("finds the pattern when the night after a habit is better, and calls its size a pattern", async () => {
		// the HRV of a day follows the habit of the day before, the resting heart rate falls the same way
		const i = await index(80, (ago) => ({ lifestyle_alcohol: habitOn(ago) ? 1 : 0, hrv: 50 + (habitOn(ago + 1) ? 8 : 0) + noise(ago), resting_hr: 55 - (habitOn(ago + 1) ? 3 : 0) + noise(ago + 3) * 0.5 }));
		const [row] = computeHabits(i, END, NAMES);
		expect(row!.name).toBe("Alcohol");
		expect(row!.hrv!.diff).toBeGreaterThan(5);
		expect(row!.hrv!.better).toBe(true);
		expect(row!.hrv!.clear).toBe(true);
		expect(row!.hrv!.share).toBeGreaterThan(0);
		expect(row!.resting_hr!.diff).toBeLessThan(-1.5);
		expect(row!.resting_hr!.better).toBe(true);
		expect(row!.resting_hr!.clear).toBe(true);
		expect(row!.with + row!.without).toBeGreaterThan(70);
	});

	it("reads a worse night as worse, in both measures", async () => {
		const i = await index(80, (ago) => ({ lifestyle_alcohol: habitOn(ago) ? 1 : 0, hrv: 50 - (habitOn(ago + 1) ? 8 : 0) + noise(ago), resting_hr: 55 + (habitOn(ago + 1) ? 3 : 0) + noise(ago + 3) * 0.5 }));
		const [row] = computeHabits(i, END, NAMES);
		expect(row!.hrv).toMatchObject({ better: false, clear: true });
		expect(row!.resting_hr).toMatchObject({ better: false, clear: true });
		expect(row!.hrv!.share).toBeLessThan(0);
	});

	it("looks at the night after the habit, not at the day of it", async () => {
		// the HRV rises on the day of the habit and not on the day after it: no pattern
		const i = await index(80, (ago) => ({ lifestyle_alcohol: habitOn(ago) ? 1 : 0, hrv: 50 + (habitOn(ago) ? 8 : 0) + noise(ago) }));
		expect(computeHabits(i, END, NAMES)[0]!.hrv!.clear).toBe(false);
	});

	it("does not call noise a pattern", async () => {
		const i = await index(80, (ago) => ({ lifestyle_alcohol: habitOn(ago) ? 1 : 0, hrv: 50 + noise(ago * 7) }));
		const row = computeHabits(i, END, NAMES)[0]!;
		expect(row.hrv).not.toBeNull();
		expect(row.hrv!.clear).toBe(false);
	});

	it("leaves out the days without an entry: they are neither yes nor no", async () => {
		// only 6 days are logged as yes and 6 as no, the rest has no entry at all: too little for a difference
		const i = await index(80, (ago) => ({ ...(ago % 6 === 0 && ago < 72 ? { lifestyle_alcohol: ago % 12 === 0 ? 1 : 0 } : {}), hrv: 50 + noise(ago), resting_hr: 55 }));
		const row = computeHabits(i, END, NAMES)[0]!;
		expect(row.hrv).toBeNull();
		expect(row.resting_hr).toBeNull();
		expect(row.with).toBeLessThan(MIN_GROUP);
		expect(row.without).toBeLessThan(MIN_GROUP);
		expect(row.strip.filter((d) => d === "unknown").length).toBeGreaterThan(8);
	});

	it("never counts the shown day's own habit, whose night has not happened yet", async () => {
		// only the shown day has a habit and it is the only day logged as yes: nothing to compare
		const i = await index(60, (ago) => ({ lifestyle_alcohol: ago === 0 ? 1 : 0, hrv: 50 + noise(ago), resting_hr: 55 }));
		const row = computeHabits(i, END, NAMES)[0]!;
		expect(row.with).toBe(0);
		expect(row.today).toBe(1);
		expect(row.hrv).toBeNull();
	});

	it("shows the strip of the last 14 days, oldest first, and what the shown day has", async () => {
		const i = await index(40, (ago) => (ago === 0 ? { lifestyle_alcohol: 1 } : ago === 1 ? { lifestyle_alcohol: 0 } : ago % 2 === 0 ? { lifestyle_alcohol: 1 } : {}));
		const row = computeHabits(i, END, NAMES)[0]!;
		expect(row.strip).toHaveLength(14);
		expect(row.strip[13]).toBe("yes");
		expect(row.strip[12]).toBe("no");
		expect(row.strip[11]).toBe("yes");
		expect(row.strip[10]).toBe("unknown");
		expect(row.today).toBe(1);
	});

	it("drops a habit that has not been logged for 30 days and keeps one that was logged on the last of them", async () => {
		const i = await index(80, (ago) => ({ lifestyle_alcohol: ago === ACTIVE_DAYS - 1 ? 1 : 0, ...(ago >= ACTIVE_DAYS ? { lifestyle_coffee: 2 } : {}) }));
		expect(computeHabits(i, END, NAMES).map((r) => r.key)).toEqual(["lifestyle_alcohol"]);
	});

	it("treats a counted habit as yes above 0 and sorts the habits with a pattern first, then by name", async () => {
		const names = { ...NAMES, lifestyle_b: { name: "B plain", kind: "check" as const }, lifestyle_a: { name: "A plain", kind: "check" as const } };
		const i = await index(80, (ago) => ({ lifestyle_coffee: habitOn(ago) ? 2 : 0, lifestyle_alcohol: ago % 2, lifestyle_a: ago % 2, lifestyle_b: ago % 2, hrv: 50 + (habitOn(ago + 1) ? 8 : 0) + noise(ago) }));
		const rows = computeHabits(i, END, names);
		expect(rows.map((r) => r.name)).toEqual(["Late caffeine", "A plain", "Alcohol", "B plain"]);
		expect(rows[0]!.kind).toBe("count");
		expect(rows[0]!.hrv!.clear).toBe(true);
	});

	it("gives no habits for an empty log", async () => {
		expect(computeHabits(await index(30, () => ({ hrv: 50 })), END, NAMES)).toEqual([]);
		expect(computeHabits(await index(30, () => ({ lifestyle_alcohol: 1 })), END, {})).toEqual([]);
	});

	it("does not divide by a spread of zero", async () => {
		const i = await index(80, (ago) => ({ lifestyle_alcohol: habitOn(ago) ? 1 : 0, hrv: 50, resting_hr: 55 }));
		const row = computeHabits(i, END, NAMES)[0]!;
		expect(row.hrv!.t).toBe(0);
		expect(row.hrv!.clear).toBe(false);
	});
});
