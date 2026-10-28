// Why it matters: the shape of Garmin's answer is what lets a mapper be written for a watch nobody here owns. It
// must say every field name and type, and it must never carry a value, a name or an id from the user's account.
import { describe, expect, it } from "vitest";
import { describeShape } from "../src/providers/garmin/payload-shape";

describe("describeShape", () => {
	it("names the type of every leaf: integer, float, string, boolean and null", () => {
		expect(describeShape({ a: 1, b: 1.5, c: "x", d: true, e: null, f: undefined })).toBe("{a: int, b: float, c: string, d: bool, e: null, f: null}");
		expect(describeShape(7)).toBe("int");
		expect(describeShape("text")).toBe("string");
		expect(describeShape(null)).toBe("null");
	});

	it("writes nested objects and the length of lists with the fields their first elements have together", () => {
		expect(describeShape({ a: { b: { c: 1 } }, list: [{ x: 1 }, { x: 2 }, { x: 3 }, { x: "late" }] })).toBe("{a: {b: {c: int}}, list: [4]{x: int}}");
		expect(describeShape([{ x: 1 }, { y: "a" }])).toBe("[2]{x: int}|{y: string}");
		expect(describeShape([])).toBe("[0]");
		expect(describeShape({ none: [] })).toBe("{none: [0]}");
	});

	it("stops at four levels: deeper objects show how many fields they have, deeper lists their length", () => {
		expect(describeShape({ a: { b: { c: { d: { e: 1 }, l: [1, 2, 3] } } } })).toBe("{a: {b: {c: {d: object(1), l: [3]}}}}");
		expect(describeShape({ a: { b: { c: { l: [{ x: 1 }] } } } })).toBe("{a: {b: {c: {l: [1]}}}}");
		expect(describeShape({ a: { l: [{ x: 1 }] } })).toBe("{a: {l: [1]{x: int}}}");
		expect(describeShape({ a: { b: { l: [{ x: 1 }] } } })).toBe("{a: {b: {l: [1]object(1)}}}");
		expect(describeShape({ a: { b: { l: [{ x: 1 }] } } }, 6)).toBe("{a: {b: {l: [1]{x: int}}}}");
	});

	it("does not print a key that is not a field name: an id, a name, an address or a very long key", () => {
		const shape = describeShape({ totalSteps: 1, "123456789": { a: 1 }, "ana@example.com": 2, "Max Mustermann": 3, [`k${"x".repeat(60)}`]: 4 });
		expect(shape).toBe("{totalSteps: int, 4 other keys}");
		expect(describeShape({ "7": 1 })).toBe("{1 other key}");
		for (const secret of ["123456789", "ana@example.com", "Mustermann"]) expect(shape).not.toContain(secret);
	});

	it("never contains a value", () => {
		const shape = describeShape({ displayName: "Max-Mustermann-private", token: "secret-token", steps: 987654, lat: 50.7123, list: ["a-private-string"] });
		for (const secret of ["Max-Mustermann-private", "secret-token", "987654", "50.7123", "a-private-string"]) expect(shape).not.toContain(secret);
	});

	it("is cut at a fixed length", () => {
		const big = Object.fromEntries(Array.from({ length: 1500 }, (_, i) => [`field${i}`, i]));
		const shape = describeShape(big);
		expect(shape.length).toBeLessThanOrEqual(6001);
		expect(shape.endsWith("…")).toBe(true);
	});
});
