// Why it matters: the birth year is the one personal detail the panel asks for. It must accept only a believable
// year, estimate the maximum heart rate with a sound formula and cut the zones at the usual 10 percent steps.
import { describe, expect, it } from "vitest";
import { maxHeartRate, parseBirthYear, zoneOf } from "../src/panel/zones";

describe("parseBirthYear", () => {
	it.each([[1985, 1985], ["1985", 1985], [" 1990 ", 1990], [2016, 2016], [1926, 1926]])("accepts %j", (input, year) => {
		expect(parseBirthYear(input, 2026)).toBe(year);
	});

	it.each([["", null], [null, null], [undefined, null], ["abc", null], ["85", null], ["19850", null], [1985.5, null], [2017, null], [1925, null], [-1985, null], [{}, null]])("rejects %j", (input, out) => {
		expect(parseBirthYear(input, 2026)).toBe(out);
	});
});

describe("maxHeartRate", () => {
	it("is 208 minus 0.7 times the age, rounded", () => {
		expect(maxHeartRate(20)).toBe(194);
		expect(maxHeartRate(40)).toBe(180);
		expect(maxHeartRate(55)).toBe(170); // 169.5
		expect(maxHeartRate(70)).toBe(159);
	});
});

describe("zoneOf", () => {
	it("cuts the zones at 50, 60, 70, 80 and 90 percent of the maximum", () => {
		expect(zoneOf(89, 180)).toBe(0);
		expect(zoneOf(90, 180)).toBe(1);
		expect(zoneOf(107, 180)).toBe(1);
		expect(zoneOf(108, 180)).toBe(2);
		expect(zoneOf(125, 180)).toBe(2);
		expect(zoneOf(126, 180)).toBe(3);
		expect(zoneOf(143, 180)).toBe(3);
		expect(zoneOf(144, 180)).toBe(4);
		expect(zoneOf(161, 180)).toBe(4);
		expect(zoneOf(162, 180)).toBe(5);
		expect(zoneOf(200, 180)).toBe(5);
	});
});
