import { describe, expect, it } from "vitest";
import { localDateString } from "../src/dates";

describe("localDateString", () => {
	it("pads month and day", () => {
		expect(localDateString(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
	});

	it("uses local calendar fields, not UTC", () => {
		// 23:30 local on the last day of the year stays on that day in every zone
		expect(localDateString(new Date(2026, 11, 31, 23, 30))).toBe("2026-12-31");
		// 00:30 local on 1 Jan stays on 1 Jan even where UTC is still the old year
		expect(localDateString(new Date(2027, 0, 1, 0, 30))).toBe("2027-01-01");
	});
});
