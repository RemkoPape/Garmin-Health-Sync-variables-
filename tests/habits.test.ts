// Why it matters: the Habits card tells a person which of their habits go with better or worse nights. A habit on day D
// must be set against the night after it (D+1), a day without an entry must never count as "no", and a difference must
// only be called a pattern when there is enough of it, or the card invents advice from noise.
import { describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { computeHabits, knownHabits, ACTIVE_DAYS, MIN_GROUP } from "../src/panel/habits";

const END = "2026-10-22";
const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };
const NAMES = { lifestyle_alcohol: { name: "Alcohol", kind: "check" as const, last: END }, lifestyle_coffee: { name: "Late caffeine", kind: "count" as const, last: END } };
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
		const names = { ...NAMES, lifestyle_b: { name: "B plain", kind: "check" as const, last: END }, lifestyle_a: { name: "A plain", kind: "check" as const, last: END } };
		const i = await index(80, (ago) => ({ lifestyle_coffee: habitOn(ago) ? 2 : 0, lifestyle_alcohol: ago % 2, lifestyle_a: ago % 2, lifestyle_b: ago % 2, hrv: 50 + (habitOn(ago + 1) ? 8 : 0) + noise(ago) }));
		const rows = computeHabits(i, END, names);
		expect(rows.map((r) => r.name)).toEqual(["Late caffeine", "A plain", "Alcohol", "B plain"]);
		expect(rows[0]!.kind).toBe("count");
		expect(rows[0]!.hrv!.clear).toBe(true);
	});

	it("counts the days logged, the run of days with the habit and the last week of a counted habit", async () => {
		// ago 0..2 yes (2, 1, 3), ago 3 no, ago 4 and 5 yes, the rest has no entry
		const values: Record<number, number> = { 0: 2, 1: 1, 2: 3, 3: 0, 4: 1, 5: 1 };
		const i = await index(40, (ago) => (ago in values ? { lifestyle_coffee: values[ago] } : {}));
		const row = computeHabits(i, END, NAMES)[0]!;
		expect(row.logged).toBe(6);
		expect(row.streak).toBe(3);
		expect(row.week).toEqual({ entries: 6, days: 5, total: 8, mean: 8 / 6 });
		expect(row.usual).toBeNull();
		expect(row.daily).toHaveLength(14);
		expect(row.daily.slice(-6)).toEqual([1, 1, 0, 3, 1, 2]);
	});

	it("does not break the run before the shown day has an entry, and ends it at a no or a gap", async () => {
		const open = computeHabits(await index(40, (ago) => (ago >= 1 && ago <= 4 ? { lifestyle_alcohol: 1 } : {})), END, NAMES)[0]!;
		expect(open.today).toBeNull();
		expect(open.streak).toBe(4);
		const broken = computeHabits(await index(40, (ago) => (ago === 2 ? { lifestyle_alcohol: 0 } : ago < 5 ? { lifestyle_alcohol: 1 } : {})), END, NAMES)[0]!;
		expect(broken.streak).toBe(2);
		expect(computeHabits(await index(40, (ago) => (ago === 0 ? { lifestyle_alcohol: 0 } : {})), END, NAMES)[0]!.week).toEqual({ entries: 1, days: 0, total: 0, mean: 0 });
		expect(computeHabits(await index(40, (ago) => (ago === 20 ? { lifestyle_alcohol: 1 } : {})), END, NAMES)[0]!.week).toBeNull();
	});

	it("takes the mean of the four weeks before the last 7 days as the usual one, from 5 days with an entry", async () => {
		const few = computeHabits(await index(60, (ago) => (ago >= 7 && ago < 11 ? { lifestyle_coffee: 4 } : ago < 3 ? { lifestyle_coffee: 1 } : {})), END, NAMES);
		expect(few[0]!.usual).toBeNull();
		const rows = computeHabits(await index(60, (ago) => (ago >= 7 && ago < 12 ? { lifestyle_coffee: ago === 7 ? 6 : 4 } : ago < 3 ? { lifestyle_coffee: 1 } : {})), END, NAMES);
		expect(rows[0]!.usual).toBeCloseTo(4.4);
	});

	it("drops a habit Garmin stopped listing, and keeps all while it is not known when they were last listed", async () => {
		const i = await index(40, () => ({ lifestyle_alcohol: 1, lifestyle_coffee: 2 }));
		const names = (alcoholLast: string, coffeeLast: string) => ({ lifestyle_alcohol: { name: "Alcohol", kind: "check" as const, last: alcoholLast }, lifestyle_coffee: { name: "Late caffeine", kind: "count" as const, last: coffeeLast } });
		expect(computeHabits(i, END, names("2026-10-10", END)).map((r) => r.name)).toEqual(["Late caffeine"]);
		expect(computeHabits(i, END, names("", "")).map((r) => r.name).sort()).toEqual(["Alcohol", "Late caffeine"]);
		expect(computeHabits(i, END, names("", END)).map((r) => r.name)).toEqual(["Late caffeine"]);
	});

	describe("a counted habit by amount", () => {
		const COFFEE = { lifestyle_coffee: { name: "Late caffeine", kind: "count" as const, last: END } };
		const cups = (ago: number): number => 1 + (Math.imul(ago + 3, 0x9e3779b1) >>> 29) % 5;

		it("finds the night after falling with the amount when no day is without the habit", async () => {
			const i = await index(60, (ago) => ({ lifestyle_coffee: cups(ago), hrv: 55 - 3 * cups(ago + 1) + noise(ago), resting_hr: 55 + 1.5 * cups(ago + 1) + noise(ago + 3) * 0.3 }));
			const row = computeHabits(i, END, COFFEE)[0]!;
			expect(row.without).toBe(0);
			expect(row.hrv).toMatchObject({ dose: true, better: false, clear: true, without: 0 });
			expect(row.hrv!.diff).toBeCloseTo(-3, 0);
			expect(row.hrv!.share).toBeLessThan(-0.8);
			expect(row.resting_hr).toMatchObject({ dose: true, better: false, clear: true });
			expect(row.resting_hr!.diff).toBeGreaterThan(1);
			expect(row.hrv!.with).toBeGreaterThan(40);
		});

		it("reads a rise with the amount as a better night for the HRV and a worse one for the resting heart rate", async () => {
			const i = await index(60, (ago) => ({ lifestyle_coffee: cups(ago), hrv: 40 + 3 * cups(ago + 1) + noise(ago), resting_hr: 60 + 1.5 * cups(ago + 1) + noise(ago + 3) * 0.3 }));
			const row = computeHabits(i, END, COFFEE)[0]!;
			expect(row.hrv).toMatchObject({ better: true, clear: true });
			expect(row.resting_hr).toMatchObject({ better: false, clear: true });
		});

		it("does not call noise a pattern", async () => {
			const i = await index(60, (ago) => ({ lifestyle_coffee: cups(ago), hrv: 50 + noise(ago * 7) }));
			expect(computeHabits(i, END, COFFEE)[0]!.hrv).toMatchObject({ dose: true, clear: false });
		});

		it("needs 14 nights and three different amounts, and a spread of the night after", async () => {
			expect(computeHabits(await index(60, (ago) => ({ lifestyle_coffee: ago % 2 ? 2 : 3, hrv: 50 + noise(ago) })), END, COFFEE)[0]!.hrv).toBeNull();
			expect(computeHabits(await index(45, (ago) => ({ lifestyle_coffee: ago > 10 ? undefined : cups(ago), hrv: 55 - 3 * cups(ago + 1) + noise(ago) })), END, COFFEE)[0]!.hrv).toBeNull();
			const flat = computeHabits(await index(60, (ago) => ({ lifestyle_coffee: cups(ago), hrv: 50 })), END, COFFEE)[0]!;
			expect(flat.hrv).toMatchObject({ dose: true, clear: false, t: 0 });
		});

		it("does not compare a yes or no habit by amount", async () => {
			const i = await index(60, (ago) => ({ lifestyle_alcohol: 1, hrv: 55 - 3 * cups(ago + 1) + noise(ago) }));
			expect(computeHabits(i, END, { lifestyle_alcohol: { name: "Alcohol", kind: "check" as const, last: END } })[0]!.hrv).toBeNull();
		});

		it("keeps the comparison of groups for a counted habit that has days without it", async () => {
			const i = await index(80, (ago) => ({ lifestyle_coffee: habitOn(ago) ? 2 : 0, hrv: 50 + (habitOn(ago + 1) ? 8 : 0) + noise(ago) }));
			expect(computeHabits(i, END, COFFEE)[0]!.hrv).toMatchObject({ dose: false, clear: true });
		});

		it("keeps a near-perfect correlation finite", async () => {
			const i = await index(60, (ago) => ({ lifestyle_coffee: 1 + (ago % 4), hrv: 50 + 2 * (1 + ((ago + 1) % 4)) }));
			const hrv = computeHabits(i, END, COFFEE)[0]!.hrv!;
			expect(Number.isFinite(hrv.t)).toBe(true);
			expect(hrv.clear).toBe(true);
		});
	});

	it("still shows a dropped habit on the days before its last one", async () => {
		const i = await index(60, () => ({ lifestyle_alcohol: 1, lifestyle_coffee: 2 }));
		const names = { lifestyle_alcohol: { name: "Alcohol", kind: "check" as const, last: "2026-10-10" }, lifestyle_coffee: { name: "Late caffeine", kind: "count" as const, last: END } };
		expect(computeHabits(i, "2026-10-10", names).map((r) => r.name).sort()).toEqual(["Alcohol", "Late caffeine"]);
		expect(computeHabits(i, "2026-10-11", names).map((r) => r.name)).toEqual(["Late caffeine"]);
	});

	it("gives the same rows for many habits that share the nights (the usual values are worked out once)", async () => {
		const names: Record<string, { name: string; kind: "check"; last: string }> = {};
		for (let n = 0; n < 6; n++) names[`lifestyle_h${n}`] = { name: `Habit ${n}`, kind: "check", last: END };
		const i = await index(80, (ago) => Object.fromEntries([...Object.keys(names).map((k, n) => [k, habitOn(ago + n) ? 1 : 0]), ["hrv", 50 + (habitOn(ago + 1) ? 8 : 0) + noise(ago)]]));
		const rows = computeHabits(i, END, names);
		expect(rows).toHaveLength(6);
		expect(rows.find((r) => r.key === "lifestyle_h0")!.hrv).toMatchObject({ clear: true, better: true });
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

describe("knownHabits", () => {
	const saved = { lifestyle_alcohol: { name: "Alcohol (any)", kind: "check" as const, last: "2026-10-22", id: "3" } };
	const inNotes = { lifestyle_alcohol: { name: "Alcohol", kind: "check" as const, last: "2026-10-20" }, lifestyle_run: { name: "Run", kind: "count" as const, last: "2026-10-18" } };

	it("lets what Garmin sent win, and adds the habits only the notes hold with the latest listing of the others", () => {
		expect(knownHabits(saved, inNotes)).toEqual({
			lifestyle_alcohol: saved.lifestyle_alcohol,
			lifestyle_run: { name: "Run", kind: "count", last: "2026-10-22" },
		});
	});

	it("takes the habits of the notes as they are while Garmin has sent none (a device that was never signed in)", () => {
		expect(knownHabits({}, inNotes)).toEqual({ lifestyle_alcohol: { ...inNotes.lifestyle_alcohol, last: "" }, lifestyle_run: { ...inNotes.lifestyle_run, last: "" } });
		expect(knownHabits({}, {})).toEqual({});
		expect(knownHabits(saved, {})).toEqual(saved);
	});
});
