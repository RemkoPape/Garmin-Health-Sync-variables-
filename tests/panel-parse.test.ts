// Why it matters: sleep durations are strings in the notes ("6h 13min"). A parser that misreads them would
// show a wrong sleep debt; one that accepts garbage would turn a typo into a night of 0 minutes.
import { describe, expect, it } from "vitest";
import { parseClock, parseDuration } from "../src/panel/parse";

describe("parseDuration", () => {
	it.each([
		["6h 13min", 373],
		["0h 45min", 45],
		["7h", 420],
		["45min", 45],
		["  8h 0min ", 480],
		["10h 5min", 605],
	])("reads %s as %s minutes", (text, minutes) => {
		expect(parseDuration(text)).toBe(minutes);
	});

	it.each(["", "  ", "abc", "6 hours", "6h 13", "h min", "-1h", "6h 13min extra"])("rejects %j", (text) => {
		expect(parseDuration(text)).toBeNull();
	});

	it("rejects values that are not strings", () => {
		expect(parseDuration(373)).toBeNull();
		expect(parseDuration(undefined)).toBeNull();
		expect(parseDuration(null)).toBeNull();
	});
});

describe("parseClock", () => {
	it.each([["23:15", 1395], ["00:05", 5], ["7:30", 450], [" 06:45 ", 405], ["23:59", 1439]])("reads %s", (text, minutes) => {
		expect(parseClock(text)).toBe(minutes);
	});

	it.each(["", "24:00", "12:60", "12:5", "1230", "ab:cd", "12:30:00"])("rejects %j", (text) => {
		expect(parseClock(text)).toBeNull();
	});

	it("rejects values that are not strings (YAML may read an unquoted time as a number)", () => {
		expect(parseClock(1395)).toBeNull();
		expect(parseClock(null)).toBeNull();
	});
});
