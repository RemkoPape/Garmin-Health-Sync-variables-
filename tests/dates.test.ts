import { describe, expect, it } from "vitest";
import { localDateString, shiftDate, weekStart } from "../src/dates";

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

describe("shiftDate", () => {
	it("moves across month and year ends", () => {
		expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
		expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
	});

	it("counts calendar days across DST changes", () => {
		// 2026-03-29 (Europe) and 2026-04-05 (Auckland) lose or gain an hour
		expect(shiftDate("2026-03-28", 2)).toBe("2026-03-30");
		expect(shiftDate("2026-03-08", 1)).toBe("2026-03-09");
		expect(shiftDate("2026-04-04", 2)).toBe("2026-04-06");
		expect(shiftDate("2026-10-24", 2)).toBe("2026-10-26");
	});
});

describe("weekStart", () => {
	it("is the Monday of the week, also for a Monday and a Sunday", () => {
		expect(weekStart("2026-10-26")).toBe("2026-10-26"); // Monday
		expect(weekStart("2026-10-22")).toBe("2026-10-19"); // Thursday
		expect(weekStart("2026-10-25")).toBe("2026-10-19"); // Sunday belongs to the week before
	});

	it("crosses month and year ends and DST changes", () => {
		expect(weekStart("2027-01-01")).toBe("2026-12-28");
		expect(weekStart("2026-03-31")).toBe("2026-03-30");
		expect(weekStart("2026-03-29")).toBe("2026-03-23"); // DST change day in Europe
		expect(weekStart("2026-04-05")).toBe("2026-03-30"); // DST change day in Auckland
	});
});
