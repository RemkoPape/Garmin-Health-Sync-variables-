// Why it matters: the log is what lets a second backfill skip the days it already has. A day must only count as
// done for the metrics it was really fetched with, and a log damaged by hand must not break a run.
import { describe, expect, it } from "vitest";
import { isFetched, markFetched, type FetchLog } from "../src/fetch-log";

const empty = (): FetchLog => ({ fetchLog: {}, fetchSets: [] });

describe("fetch log", () => {
	it("knows a day only for the metrics it was fetched with", () => {
		const log = empty();
		expect(isFetched(log, "2026-10-01", ["steps"])).toBe(false);
		markFetched(log, "2026-10-01", ["steps", "hrv"]);
		expect(isFetched(log, "2026-10-01", ["hrv"])).toBe(true);
		expect(isFetched(log, "2026-10-01", ["hrv", "steps"])).toBe(true);
		expect(isFetched(log, "2026-10-01", ["hrv", "spo2"])).toBe(false);
		expect(isFetched(log, "2026-10-02", ["hrv"])).toBe(false);
	});

	it("keeps one entry per distinct set of metrics, however many days share it", () => {
		const log = empty();
		for (const day of ["2026-10-01", "2026-10-02", "2026-10-03"]) markFetched(log, day, ["steps", "hrv"]);
		markFetched(log, "2026-10-04", ["hrv", "steps"]);
		expect(log.fetchSets).toEqual([["hrv", "steps"]]);
	});

	it("adds the metrics of a later run to those of the day", () => {
		const log = empty();
		markFetched(log, "2026-10-01", ["steps"]);
		markFetched(log, "2026-10-01", ["hrv"]);
		expect(log.fetchSets).toEqual([["steps"], ["hrv", "steps"]]);
		expect(isFetched(log, "2026-10-01", ["steps", "hrv"])).toBe(true);
	});

	it("treats a day that points at a missing set, from a damaged data file, as not fetched and repairs it", () => {
		const log: FetchLog = { fetchLog: { "2026-10-01": 7 }, fetchSets: [] };
		expect(isFetched(log, "2026-10-01", ["steps"])).toBe(false);
		markFetched(log, "2026-10-01", ["steps"]);
		expect(isFetched(log, "2026-10-01", ["steps"])).toBe(true);
	});
});
