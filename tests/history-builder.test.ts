// Why it matters: the history build runs for hours against a rate-limited service. It must go newest first,
// never ask twice for a day it has, pace its requests, survive failures without hammering Garmin, stop when
// asked, and leave everything it fetched in the files whatever way it ends.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { FakeProvider } from "../testUtils/fakeProvider";
import { HistoryBuilder, EMPTY_RUN_STOP, type BuildProgress } from "../src/history/builder";
import { serializeMonth } from "../src/history/format";
import { HistoryStore } from "../src/history/store";
import { LoginRequiredError } from "../src/errors";
import { shiftDate } from "../src/dates";

const FILE = "Garmin history/Garmin history 2026-10.md";
const ENABLED = ["steps", "hrv"];

let app: App;
let provider: FakeProvider;
let store: HistoryStore;
let notes: string[];
let progress: BuildProgress[];
let builder: HistoryBuilder;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(2026, 9, 25, 12));
	app = new App();
	provider = new FakeProvider();
	provider.batchDelay = 1000;
	store = new HistoryStore(app as never, { dailyNotePath: "" });
	notes = [];
	progress = [];
	make();
});

function make(enabled = ENABLED): void {
	builder = new HistoryBuilder({ provider, store, enabledMetrics: enabled, writeNote: async (date) => void notes.push(date), onProgress: (p) => progress.push(p) });
}

async function run(from: string, to: string) {
	const result = builder.run(from, to);
	await vi.runAllTimersAsync();
	return result;
}

const lines = (path = FILE): string[] => app.vault.text(path).split("\n").filter((l) => /^\d{4}-/.test(l));
const fetchedDates = (): string[] => provider.fetchCalls.map((c) => c.date);
const record = (data: Record<string, Record<string, unknown>>) => serializeMonth("2026-10", new Map(Object.entries(data)));

describe("the order and the pace", () => {
	it("goes from the newest day back, writes each day to the history and the note, and waits between requests", async () => {
		const times: number[] = [];
		provider.onFetch = () => times.push(Date.now());
		const result = await run("2026-10-22", "2026-10-24");
		expect(fetchedDates()).toEqual(["2026-10-24", "2026-10-23", "2026-10-22"]);
		expect(provider.fetchCalls[0]!.enabledMetrics).toEqual(ENABLED);
		expect(times[1]! - times[0]!).toBe(1000);
		expect(times[2]! - times[1]!).toBe(1000);
		expect(lines()).toEqual([
			'2026-10-22 {"_m":["hrv","steps"],"steps":8000}',
			'2026-10-23 {"_m":["hrv","steps"],"steps":8000}',
			'2026-10-24 {"_m":["hrv","steps"],"steps":8000}',
		]);
		expect(notes).toEqual(["2026-10-24", "2026-10-23", "2026-10-22"]);
		expect(result).toEqual({ status: "done", fetched: 3, skipped: 0, failed: 0, date: "2026-10-22", reachedStart: false });
	});

	it("uses two seconds when the provider has no recommendation", async () => {
		provider.batchDelay = undefined;
		(provider as { getRecommendedBatchDelay?: unknown }).getRecommendedBatchDelay = undefined;
		const times: number[] = [];
		provider.onFetch = () => times.push(Date.now());
		await run("2026-10-23", "2026-10-24");
		expect(times[1]! - times[0]!).toBe(2000);
	});

	it("reports the day, the days done, the total and, after the first fetched day, the time left", async () => {
		await run("2026-10-22", "2026-10-24");
		expect(progress[0]).toMatchObject({ state: "running", date: "2026-10-24", done: 0, total: 3, etaMs: null });
		const second = progress.find((p) => p.date === "2026-10-23")!;
		expect(second).toMatchObject({ done: 1, fetched: 1 });
		expect(second.etaMs).toBeGreaterThan(0);
		expect(progress.at(-1)).toMatchObject({ done: 3, fetched: 3 });
	});

	it("saves the days in batches, and at the latest when the month changes", async () => {
		await run("2026-09-28", "2026-10-02");
		expect(lines("Garmin history/Garmin history 2026-09.md")).toHaveLength(3);
		expect(lines()).toHaveLength(2);
	});

	it("saves a batch after ten fetched days without waiting for the end", async () => {
		const seen: number[] = [];
		provider.onFetch = (date) => {
			if (date === "2026-10-13") seen.push(app.vault.paths().length ? lines().length : 0);
		};
		await run("2026-10-12", "2026-10-24");
		expect(seen).toEqual([10]);
	});
});

describe("history notes in an earlier folder", () => {
	it("are moved first, and their days are then not fetched again", async () => {
		const month = serializeMonth("2026-10", new Map([["2026-10-24", { steps: 1, _m: ["hrv", "steps"] }]]));
		app.vault.seed("Old year/Garmin history/Garmin history 2026-10.md", month);
		store = new HistoryStore(app as never, { dailyNotePath: "New year" });
		make();
		const result = await run("2026-10-24", "2026-10-24");
		expect(app.vault.paths()).toEqual(["New year/Garmin history/Garmin history 2026-10.md"]);
		expect(fetchedDates()).toEqual([]);
		expect(result).toMatchObject({ skipped: 1, fetched: 0 });
	});
});

describe("days that are already there", () => {
	it("skips a day that has the metrics, one that came from notes and one remembered as empty, without a request or a wait", async () => {
		app.vault.seed(FILE, record({ "2026-10-24": { steps: 1, _m: ["hrv", "steps"] }, "2026-10-23": { steps: 2 }, "2026-10-22": { _m: ["hrv", "steps"] } }));
		const result = await run("2026-10-22", "2026-10-24");
		expect(fetchedDates()).toEqual([]);
		expect(result).toMatchObject({ fetched: 0, skipped: 3, status: "done" });
	});

	it("asks again for a day whose record lacks a metric that is wanted now, and merges", async () => {
		app.vault.seed(FILE, record({ "2026-10-24": { steps: 1, _m: ["steps"] } }));
		await run("2026-10-24", "2026-10-24");
		expect(fetchedDates()).toEqual(["2026-10-24"]);
		expect(lines()).toEqual(['2026-10-24 {"_m":["hrv","steps"],"steps":8000}']);
	});
});

describe("days without data", () => {
	beforeEach(() => {
		provider.defaultData = { metrics: {}, activities: {} };
	});

	it("remembers an old empty day so it is not asked for again, but not one from the last week that may still fill in", async () => {
		await run("2026-10-16", "2026-10-24"); // now is 2026-10-25: days before the 18th are final
		expect(lines()).toEqual(['2026-10-16 {"_m":["hrv","steps"]}', '2026-10-17 {"_m":["hrv","steps"]}']);
		expect(notes).toEqual([]);
	});

	it("ends at the start of the data: 120 empty days in a row after the last day with data", async () => {
		const last = shiftDate("2026-10-24", -10);
		provider.byDate.set(last, { metrics: { steps: 1 }, activities: {} });
		const result = await run(shiftDate(last, -400), "2026-10-24");
		expect(result.reachedStart).toBe(true);
		expect(result.status).toBe("done");
		expect(result.fetched).toBe(11 + EMPTY_RUN_STOP);
		expect(result.date).toBe(shiftDate(last, -EMPTY_RUN_STOP));
	});

	it("does not stop for empty days before any data was found", async () => {
		const result = await run(shiftDate("2026-10-24", -(EMPTY_RUN_STOP + 20)), "2026-10-24");
		expect(result.reachedStart).toBe(false);
		expect(result.fetched).toBe(EMPTY_RUN_STOP + 21);
	});

	it("counts days that were skipped as empty or full for the same rule", async () => {
		const known: Record<string, Record<string, unknown>> = {};
		for (let i = 0; i < EMPTY_RUN_STOP; i++) known[shiftDate("2026-10-24", -i - 1)] = { _m: ["hrv", "steps"] };
		known["2026-10-24"] = { steps: 5, _m: ["hrv", "steps"] };
		for (const month of new Set(Object.keys(known).map((d) => d.slice(0, 7)))) {
			app.vault.seed(`Garmin history/Garmin history ${month}.md`, serializeMonth(month, new Map(Object.entries(known).filter(([d]) => d.startsWith(month)))));
		}
		const result = await run("2025-01-01", "2026-10-24");
		expect(result).toMatchObject({ reachedStart: true, fetched: 0, skipped: EMPTY_RUN_STOP + 1 });
		expect(fetchedDates()).toEqual([]);
	});
});

describe("failures", () => {
	it("retries a failed day after 30 and then 60 seconds and goes on when it works", async () => {
		const times: number[] = [];
		let tries = 0;
		provider.onFetch = (date) => {
			times.push(Date.now());
			if (date === "2026-10-24" && ++tries < 3) throw new Error("network");
		};
		const result = await run("2026-10-24", "2026-10-24");
		expect(times.map((t) => t - times[0]!)).toEqual([0, 30_000, 90_000]);
		expect(result).toMatchObject({ fetched: 1, failed: 0 });
	});

	it("counts a day that failed three times as failed, leaves it out of the history and goes on with the next", async () => {
		provider.byDate.set("2026-10-24", new Error("boom"));
		const result = await run("2026-10-23", "2026-10-24");
		expect(fetchedDates()).toEqual(["2026-10-24", "2026-10-24", "2026-10-24", "2026-10-23"]);
		expect(result).toMatchObject({ fetched: 1, failed: 1 });
		expect(lines()).toEqual(['2026-10-23 {"_m":["hrv","steps"],"steps":8000}']);
	});

	it("pauses for 5 minutes after three failed days in a row, then 10, and gives up after the fifth pause", async () => {
		for (let i = 0; i < 20; i++) provider.byDate.set(shiftDate("2026-10-24", -i), new Error("down"));
		const result = await run("2026-10-01", "2026-10-24");
		const pauses = progress.filter((p) => p.state === "paused").map((p) => p.pauseMs);
		expect(pauses).toEqual([300_000, 600_000, 1_200_000, 1_800_000]);
		expect(result).toMatchObject({ status: "gave-up", failed: 15, fetched: 0 });
	});

	it("starts counting again after a day that worked", async () => {
		for (const day of ["2026-10-24", "2026-10-23", "2026-10-21", "2026-10-20"]) provider.byDate.set(day, new Error("x"));
		const result = await run("2026-10-19", "2026-10-24");
		expect(progress.some((p) => p.state === "paused")).toBe(false);
		expect(result).toMatchObject({ failed: 4, fetched: 2, status: "done" });
	});

	it("stops at once when Garmin asks for a new sign-in, and keeps what it has", async () => {
		provider.byDate.set("2026-10-23", new LoginRequiredError());
		const result = await run("2026-10-20", "2026-10-24");
		expect(result).toMatchObject({ status: "login-required", fetched: 1, date: "2026-10-23" });
		expect(lines()).toEqual(['2026-10-24 {"_m":["hrv","steps"],"steps":8000}']);
	});
});

describe("stopping", () => {
	it("ends after the day in progress and keeps what was fetched", async () => {
		provider.onFetch = (date) => {
			if (date === "2026-10-23") builder.stop();
		};
		const result = await run("2026-10-20", "2026-10-24");
		expect(fetchedDates()).toEqual(["2026-10-24", "2026-10-23"]);
		expect(result).toMatchObject({ status: "stopped", fetched: 2, date: "2026-10-22" });
		expect(lines()).toHaveLength(2);
	});

	it("ends a wait between days at once", async () => {
		provider.batchDelay = 600_000;
		const result = builder.run("2026-10-20", "2026-10-24");
		await vi.advanceTimersByTimeAsync(10);
		builder.stop();
		await vi.advanceTimersByTimeAsync(10);
		expect(await result).toMatchObject({ status: "stopped", fetched: 1 });
	});

	it("stops during the wait before a retry without counting the day as failed", async () => {
		provider.byDate.set("2026-10-24", new Error("down"));
		const result = builder.run("2026-10-24", "2026-10-24");
		await vi.advanceTimersByTimeAsync(10);
		builder.stop();
		await vi.advanceTimersByTimeAsync(10);
		expect(await result).toMatchObject({ status: "stopped", failed: 0, fetched: 0 });
	});

	it("does not wait out a pause or a retry when the stop came while a request was running", async () => {
		provider.onFetch = () => {
			builder.stop();
			throw new Error("down");
		};
		const started = Date.now();
		const result = await run("2026-10-20", "2026-10-24");
		expect(Date.now() - started).toBe(0);
		expect(result).toMatchObject({ status: "stopped", fetched: 0, failed: 0 });
		expect(fetchedDates()).toEqual(["2026-10-24"]);
	});

	it("does nothing when stopped before it starts", async () => {
		builder.stop();
		const result = await run("2026-10-20", "2026-10-24");
		expect(result).toMatchObject({ status: "stopped", fetched: 0, date: "2026-10-24" });
		expect(fetchedDates()).toEqual([]);
	});
});
