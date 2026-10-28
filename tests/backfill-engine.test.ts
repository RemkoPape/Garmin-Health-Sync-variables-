// Why it matters: a backfill runs for hours against a rate-limited service. It must go newest first,
// never ask twice for a day it has, pace its requests, survive failures without hammering Garmin, stop when
// asked, and leave everything it fetched in the files whatever way it ends.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { FakeProvider } from "../testUtils/fakeProvider";
import { Backfill, EMPTY_RUN_STOP, type BuildProgress } from "../src/history/backfill";
import type { MissingNoteBehaviour } from "../src/settings";
import { serializeMonth } from "../src/history/format";
import { HistoryStore } from "../src/history/store";
import { LoginRequiredError } from "../src/errors";
import { shiftDate } from "../src/dates";

const FILE = "Garmin history/Garmin history 2026-10.md";
const ENABLED = ["steps", "hrv"];

let app: App;
let provider: FakeProvider;
let store: HistoryStore;
let notes: { date: string; mayCreate: boolean }[];
let progress: BuildProgress[];
let builder: Backfill;
let fetchLog: Set<string>;
let cursors: string[];
let withNote: (date: string) => boolean;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(2026, 9, 25, 12));
	app = new App();
	provider = new FakeProvider();
	provider.batchDelay = 1000;
	store = new HistoryStore(app as never, { dailyNotePath: "" });
	notes = [];
	progress = [];
	fetchLog = new Set();
	cursors = [];
	withNote = () => true;
	make();
});

function make(enabled = ENABLED, options: { behaviour?: MissingNoteBehaviour; force?: boolean; untilStart?: boolean } = {}): void {
	builder = new Backfill({
		provider,
		store,
		enabledMetrics: enabled,
		behaviour: options.behaviour ?? "history",
		force: options.force ?? false,
		untilStart: options.untilStart ?? false,
		hasNote: (date) => withNote(date),
		wasFetched: (date) => fetchLog.has(date),
		markFetched: (date) => void fetchLog.add(date),
		writeNote: async (date, _data, mayCreate) => void notes.push({ date, mayCreate }),
		onCursor: async (next) => void cursors.push(next),
		onProgress: (p) => progress.push(p),
	});
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
		expect(notes.map((n) => n.date)).toEqual(["2026-10-24", "2026-10-23", "2026-10-22"]);
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

	it("saves a batch after five fetched days without waiting for the end", async () => {
		const seen: number[] = [];
		provider.onFetch = (date) => {
			if (date === "2026-10-19") seen.push(app.vault.paths().length ? lines().length : 0);
		};
		await run("2026-10-12", "2026-10-24");
		expect(seen).toEqual([5]);
	});
});

describe("history notes in an earlier folder", () => {
	it("are moved first, and their days are then not fetched again", async () => {
		const month = serializeMonth("2026-10", new Map([["2026-10-20", { steps: 1, _m: ["hrv", "steps"] }]]));
		app.vault.seed("Old year/Garmin history/Garmin history 2026-10.md", month);
		store = new HistoryStore(app as never, { dailyNotePath: "New year" });
		make();
		const result = await run("2026-10-20", "2026-10-20");
		expect(app.vault.paths()).toEqual(["New year/Garmin history/Garmin history 2026-10.md"]);
		expect(fetchedDates()).toEqual([]);
		expect(result).toMatchObject({ skipped: 1, fetched: 0 });
	});
});

describe("days that are already there", () => {
	it("skips a day that has the metrics, one that came from notes and one remembered as empty, without a request or a wait", async () => {
		app.vault.seed(FILE, record({ "2026-10-20": { steps: 1, _m: ["hrv", "steps"] }, "2026-10-19": { steps: 2 }, "2026-10-18": { _m: ["hrv", "steps"] } }));
		const result = await run("2026-10-18", "2026-10-20");
		expect(fetchedDates()).toEqual([]);
		expect(result).toMatchObject({ fetched: 0, skipped: 3, status: "done" });
	});

	it("asks again for a day whose record lacks a metric that is wanted now, and merges", async () => {
		app.vault.seed(FILE, record({ "2026-10-20": { steps: 1, _m: ["steps"] } }));
		await run("2026-10-20", "2026-10-20");
		expect(fetchedDates()).toEqual(["2026-10-20"]);
		expect(lines()).toEqual(['2026-10-20 {"_m":["hrv","steps"],"steps":8000}']);
	});
});

describe("days without data", () => {
	beforeEach(() => {
		provider.defaultData = { metrics: {}, activities: {} };
	});

	it("remembers an old empty day so it is not asked for again, but not one from the last three days that may still fill in", async () => {
		await run("2026-10-20", "2026-10-24"); // now is 2026-10-25: days before the 22nd are final
		expect(lines()).toEqual(['2026-10-20 {"_m":["hrv","steps"]}', '2026-10-21 {"_m":["hrv","steps"]}']);
		expect(notes).toEqual([]);
	});

	it("ends at the start of the data: 120 empty days in a row after the last day with data", async () => {
		make(ENABLED, { untilStart: true });
		const last = shiftDate("2026-10-24", -10);
		provider.byDate.set(last, { metrics: { steps: 1 }, activities: {} });
		const result = await run(shiftDate(last, -400), "2026-10-24");
		expect(result.reachedStart).toBe(true);
		expect(result.status).toBe("done");
		expect(result.fetched).toBe(11 + EMPTY_RUN_STOP);
		expect(result.date).toBe(shiftDate(last, -EMPTY_RUN_STOP));
	});

	it("does not stop for empty days before any data was found", async () => {
		make(ENABLED, { untilStart: true });
		const result = await run(shiftDate("2026-10-24", -(EMPTY_RUN_STOP + 20)), "2026-10-24");
		expect(result.reachedStart).toBe(false);
		expect(result.fetched).toBe(EMPTY_RUN_STOP + 21);
	});

	it("goes on through a long stretch of empty days when it was not asked to look for the start of the data", async () => {
		const last = shiftDate("2026-10-24", -10);
		provider.byDate.set(last, { metrics: { steps: 1 }, activities: {} });
		const result = await run(shiftDate(last, -(EMPTY_RUN_STOP + 5)), "2026-10-24");
		expect(result.reachedStart).toBe(false);
		expect(result.fetched).toBe(11 + EMPTY_RUN_STOP + 5);
	});

	it("counts days that were skipped as empty or full for the same rule", async () => {
		make(ENABLED, { untilStart: true });
		const known: Record<string, Record<string, unknown>> = {};
		for (let i = 0; i < EMPTY_RUN_STOP; i++) known[shiftDate("2026-10-21", -i - 1)] = { _m: ["hrv", "steps"] };
		known["2026-10-21"] = { steps: 5, _m: ["hrv", "steps"] };
		for (const month of new Set(Object.keys(known).map((d) => d.slice(0, 7)))) {
			app.vault.seed(`Garmin history/Garmin history ${month}.md`, serializeMonth(month, new Map(Object.entries(known).filter(([d]) => d.startsWith(month)))));
		}
		const result = await run("2025-01-01", "2026-10-24");
		// the last days are always fetched again, the older ones are skipped
		expect(result).toMatchObject({ reachedStart: true, fetched: 3, skipped: EMPTY_RUN_STOP + 1 });
		expect(fetchedDates()).toEqual(["2026-10-24", "2026-10-23", "2026-10-22"]);
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

describe("what happens to a day without a daily note", () => {
	it("creates the note in 'create' and writes no history file", async () => {
		make(ENABLED, { behaviour: "create" });
		await run("2026-10-23", "2026-10-24");
		expect(notes).toEqual([{ date: "2026-10-24", mayCreate: true }, { date: "2026-10-23", mayCreate: true }]);
		expect(app.vault.paths()).toEqual([]);
	});

	it("keeps the day in the history and only updates a note that exists in 'history'", async () => {
		await run("2026-10-24", "2026-10-24");
		expect(notes).toEqual([{ date: "2026-10-24", mayCreate: false }]);
		expect(lines()).toHaveLength(1);
	});

	it("fetches only the days that have a note in 'skip', and does not count the others", async () => {
		make(ENABLED, { behaviour: "skip" });
		withNote = (date) => date !== "2026-10-23";
		const result = await run("2026-10-22", "2026-10-24");
		expect(fetchedDates()).toEqual(["2026-10-24", "2026-10-22"]);
		expect(result).toMatchObject({ fetched: 2, skipped: 0 });
		expect(progress[0]).toMatchObject({ total: 2 });
		expect(notes.every((n) => n.mayCreate)).toBe(true);
		expect(app.vault.paths()).toEqual([]);
	});

	it("leaves the empty days of 'create' and 'skip' unmarked, because there is no history file to hold the mark", async () => {
		provider.defaultData = { metrics: {}, activities: {} };
		make(ENABLED, { behaviour: "create" });
		await run("2026-10-18", "2026-10-19");
		expect(app.vault.paths()).toEqual([]);
	});
});

describe("days an earlier run fetched", () => {
	beforeEach(() => make(ENABLED, { behaviour: "create" }));

	it("are skipped through the fetch log, and the run remembers the days it fetched, but not the last three", async () => {
		fetchLog.add("2026-10-19");
		const result = await run("2026-10-18", "2026-10-24");
		expect(fetchedDates()).toEqual(["2026-10-24", "2026-10-23", "2026-10-22", "2026-10-21", "2026-10-20", "2026-10-18"]);
		expect(result).toMatchObject({ fetched: 6, skipped: 1 });
		expect([...fetchLog].sort()).toEqual(["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"]);
	});

	it("are fetched again when the run is told to force it, even those complete in the history", async () => {
		make(ENABLED, { behaviour: "history", force: true });
		app.vault.seed(FILE, record({ "2026-10-20": { steps: 1, _m: ["hrv", "steps"] } }));
		fetchLog.add("2026-10-19");
		await run("2026-10-19", "2026-10-20");
		expect(fetchedDates()).toEqual(["2026-10-20", "2026-10-19"]);
	});

	it("count only the days that are fetched in the progress: the total, the days done and the time left", async () => {
		fetchLog.add("2026-10-19");
		fetchLog.add("2026-10-18");
		await run("2026-10-17", "2026-10-20");
		expect(progress[0]).toMatchObject({ done: 0, total: 2 });
		expect(progress.at(-1)).toMatchObject({ done: 2, total: 2, skipped: 2 });
	});

	it("report a run with nothing to fetch without dividing by nothing", async () => {
		fetchLog.add("2026-10-19");
		const result = await run("2026-10-19", "2026-10-19");
		expect(result).toMatchObject({ fetched: 0, skipped: 1, status: "done" });
		expect(progress.at(-1)).toMatchObject({ done: 0, total: 0, etaMs: null });
	});
});

describe("the place it has reached", () => {
	it("is reported every fifth fetched day with the next day to do", async () => {
		await run("2026-10-10", "2026-10-24");
		expect(cursors).toEqual(["2026-10-19", "2026-10-14", "2026-10-09"]);
	});
});

describe("a day is marked as fetched only when its data is in the files", () => {
	it("marks the days of a history batch after the file has them, not before", async () => {
		const marked: number[] = [];
		const put = store.putMany.bind(store);
		vi.spyOn(store, "putMany").mockImplementation(async (records) => {
			marked.push(fetchLog.size);
			await put(records);
		});
		await run("2026-10-08", "2026-10-10");
		expect(marked).toEqual([0]);
		expect([...fetchLog].sort()).toEqual(["2026-10-08", "2026-10-09", "2026-10-10"]);
	});

	it("leaves days unmarked and counts them as failed when the history file cannot be written, so the next run fetches them", async () => {
		vi.spyOn(store, "putMany").mockRejectedValue(new Error("disk full"));
		const result = await run("2026-10-08", "2026-10-10");
		expect(result).toMatchObject({ status: "done", fetched: 0, failed: 3 });
		expect(fetchLog.size).toBe(0);
		vi.restoreAllMocks();
		const again = await run("2026-10-08", "2026-10-10");
		expect(again).toMatchObject({ fetched: 3, failed: 0 });
		expect(lines()).toHaveLength(3);
	});

	it("saves the pending days before it reports the place it has reached", async () => {
		const order: string[] = [];
		const put = store.putMany.bind(store);
		vi.spyOn(store, "putMany").mockImplementation(async (records) => {
			order.push("files");
			await put(records);
		});
		const push = cursors.push.bind(cursors);
		cursors.push = (...next: string[]) => {
			order.push("cursor");
			return push(...next);
		};
		await run("2026-10-01", "2026-10-05");
		expect(order).toEqual(["files", "cursor"]);
		expect(lines()).toHaveLength(5);
	});
});

describe("a day whose endpoint failed", () => {
	const partial = (data: Record<string, number> = { steps: 5000 }) => ({ metrics: data, activities: {}, failedEndpoints: ["hrv"] });

	it("is stored as it is but not as complete, so the next run asks again", async () => {
		provider.byDate.set("2026-10-09", partial());
		const result = await run("2026-10-09", "2026-10-10");
		expect(result).toMatchObject({ fetched: 2, failed: 0 });
		expect(lines().find((l) => l.startsWith("2026-10-09"))).toBe('2026-10-09 {"_m":[],"steps":5000}');
		expect([...fetchLog]).toEqual(["2026-10-10"]);
		provider.byDate.clear();
		provider.fetchCalls.length = 0;
		await run("2026-10-09", "2026-10-10");
		expect(fetchedDates()).toEqual(["2026-10-09"]);
	});

	it("is not remembered as empty either when it has no data at all", async () => {
		provider.byDate.set("2026-10-09", { metrics: {}, activities: {}, failedEndpoints: ["hrv"] });
		await run("2026-10-09", "2026-10-09");
		expect(lines()).toEqual(['2026-10-09 {"_m":[]}']);
		expect(fetchLog.size).toBe(0);
	});

	it("is not marked in the fetch log when the day goes into a note", async () => {
		make(ENABLED, { behaviour: "create" });
		provider.byDate.set("2026-10-09", partial());
		await run("2026-10-09", "2026-10-10");
		expect([...fetchLog]).toEqual(["2026-10-10"]);
	});
});
