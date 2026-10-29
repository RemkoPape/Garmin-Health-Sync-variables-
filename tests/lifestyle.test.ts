// Why it matters: the lifestyle log is read from an answer Garmin does not document. A habit that was not touched must
// never turn into a "no", a count must add up, and two habits must never share one key in the notes.
import { describe, expect, it } from "vitest";
import { LIFESTYLE_PREFIX, habitKeysOf, mapLifestyle, parseHabits } from "../src/providers/garmin/lifestyle";

const report = (...dailyLogsReport: unknown[]): Record<string, unknown> => ({ dailyLogsReport });

describe("parseHabits", () => {
	it("reads a yes, a no and an untouched habit, and never makes a 0 out of an entry that is missing", () => {
		const habits = parseHabits(report(
			{ behaviourId: 2, name: "Light exercise", measurementType: "NONE", logStatus: "YES" },
			{ behaviourId: 3, name: "Alcohol", measurementType: "NONE", logStatus: "NO" },
			{ behaviourId: 4, name: "Mindfulness", measurementType: "NONE" },
		));
		expect(habits).toEqual([
			{ key: "lifestyle_light_exercise", id: "2", name: "Light exercise", kind: "check", value: 1 },
			{ key: "lifestyle_alcohol", id: "3", name: "Alcohol", kind: "check", value: 0 },
			{ key: "lifestyle_mindfulness", id: "4", name: "Mindfulness", kind: "check", value: null },
		]);
	});

	it("adds up the amounts of a counted habit and counts a yes without an amount as one", () => {
		const habits = parseHabits(report(
			{ behaviourId: 5, name: "Late caffeine", measurementType: "QUANTITY", logStatus: "YES", details: [{ subTypeName: "Coffee", amount: 1 }, { subTypeName: "Soda", amount: 2 }, { subTypeName: "Tea" }, { subTypeName: "Odd", amount: "x" }, null] },
			{ behaviourId: 6, name: "Water", measurementType: "QUANTITY", logStatus: "YES" },
			{ behaviourId: 7, name: "Sweets", measurementType: "QUANTITY", logStatus: "NO", details: [{ subTypeName: "Cake", amount: 3 }] },
		));
		expect(habits.map((h) => [h.kind, h.value])).toEqual([["count", 3], ["count", 1], ["count", 0]]);
	});

	it("ignores the catalogue Garmin lists for a habit that was not logged", () => {
		const [habit] = parseHabits(report({ behaviourId: 5, name: "Late caffeine", measurementType: "QUANTITY", details: [{ subTypeName: "Coffee" }, { subTypeName: "Soda", amount: 9 }] }));
		expect(habit!.value).toBeNull();
	});

	it("builds a key from the name without accents or symbols, and keeps two habits with the same name apart", () => {
		const habits = parseHabits(report(
			{ behaviourId: 1, name: "  Café – après 18 h!  ", logStatus: "YES" },
			{ behaviourId: 2, name: "cafe apres 18 h", logStatus: "YES" },
		));
		expect(habits.map((h) => h.key)).toEqual(["lifestyle_cafe_apres_18_h", "lifestyle_cafe_apres_18_h_2"]);
		expect(habits[0]!.name).toBe("Café – après 18 h!");
	});

	it("keeps the key of a habit Garmin renamed, or named in another language, and does not give it to another habit", () => {
		const known = { "2": "lifestyle_alcohol" };
		const [renamed, other] = parseHabits(report({ behaviourId: 2, name: "Alkohol", logStatus: "YES" }, { behaviourId: 7, name: "Alcohol", logStatus: "YES" }), known);
		expect(renamed).toMatchObject({ key: "lifestyle_alcohol", name: "Alkohol" });
		expect(other).toMatchObject({ key: "lifestyle_alcohol_7", name: "Alcohol" });
		expect(mapLifestyle(report({ behaviourId: 2, name: "Alkohol", logStatus: "NO" }), known)).toEqual({ lifestyle_alcohol: 0 });
	});

	it("gives two new habits of the same name the same keys on every day, whichever comes first", () => {
		const a = { behaviourId: 1, name: "Cafe", logStatus: "YES" };
		const b = { behaviourId: 2, name: "Café", logStatus: "YES" };
		expect(parseHabits(report(a, b)).map((h) => [h.id, h.key])).toEqual([["1", "lifestyle_cafe"], ["2", "lifestyle_cafe_2"]]);
		expect(habitKeysOf({ lifestyle_cafe: { name: "Cafe", kind: "check", last: "", id: "1" }, lifestyle_cafe_2: { name: "Café", kind: "check", last: "", id: "2" }, lifestyle_none: { name: "x", kind: "check", last: "" } })).toEqual({ "1": "lifestyle_cafe", "2": "lifestyle_cafe_2" });
		expect(parseHabits(report(b, a), { "1": "lifestyle_cafe", "2": "lifestyle_cafe_2" }).map((h) => [h.id, h.key])).toEqual([["2", "lifestyle_cafe_2"], ["1", "lifestyle_cafe"]]);
	});

	it("falls back to the id for a name without a Latin letter, and to the position without an id", () => {
		const habits = parseHabits(report({ behaviourId: 347806, name: "瞑想", logStatus: "YES" }, { name: "!!!", logStatus: "YES" }));
		expect(habits.map((h) => h.key)).toEqual(["lifestyle_habit_347806", "lifestyle_habit_1"]);
		expect(habits.map((h) => h.id)).toEqual(["347806", ""]);
	});

	it("cuts a long name to 40 characters", () => {
		const [habit] = parseHabits(report({ behaviourId: 1, name: "a".repeat(80), logStatus: "YES" }));
		expect(habit!.key).toBe(`${LIFESTYLE_PREFIX}${"a".repeat(40)}`);
	});

	it("gives nothing for an answer of another shape", () => {
		expect(parseHabits({})).toEqual([]);
		expect(parseHabits({ dailyLogsReport: "none" })).toEqual([]);
		expect(parseHabits(report(null, 5, { name: 7 }, { name: "" }))).toEqual([]);
	});
});

describe("mapLifestyle", () => {
	it("writes every habit that was touched and none that was not", () => {
		const data = report(
			{ behaviourId: 2, name: "Light exercise", logStatus: "YES" },
			{ behaviourId: 3, name: "Alcohol", logStatus: "NO" },
			{ behaviourId: 4, name: "Mindfulness" },
		);
		expect(mapLifestyle(data)).toEqual({ lifestyle_light_exercise: 1, lifestyle_alcohol: 0 });
		expect(mapLifestyle({})).toEqual({});
	});
});
