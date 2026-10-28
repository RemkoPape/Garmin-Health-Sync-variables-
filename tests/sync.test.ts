// Why it matters: SyncManager decides what happens on every sync and backfill: whether Garmin is
// called at all, what is written into the note, what the user is told, and how fast requests go out
// (Garmin rate-limits). A wrong branch here is a missed day, a request storm, or a wrong logout.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, Notice, network as net } from "../testUtils/mocks/obsidian";
import { SyncManager } from "../src/sync";
import { ProgressNotice } from "../src/history/progress";
import { HistoryStore } from "../src/history/store";
import { serializeMonth } from "../src/history/format";
import { DEFAULT_SETTINGS, type HealthSyncSettings } from "../src/settings";
import { LoginRequiredError } from "../src/errors";
import { FakeProvider, NoDelayProvider } from "../testUtils/fakeProvider";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";

const DATE = "2026-10-24";
const NOTE = `Daily/${DATE}.md`;

let app: App;
let provider: FakeProvider;
let sync: SyncManager;

function settings(patch: Partial<HealthSyncSettings> = {}): HealthSyncSettings {
	return {
		...DEFAULT_SETTINGS,
		fetchLog: {},
		fetchSets: [],
		enabledMetrics: { steps: true, hrv: false, sleep_score: true },
		dailyNotePath: "Daily",
		...patch,
	};
}
const fetchedDates = (): string[] => provider.fetchCalls.map((c) => c.date);
const msgs = (): string[] => Notice.recorded.map((n) => n.message);
function frontmatter(path: string): string {
	return app.vault.text(path);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-25T10:00:00"));
	app = new App();
	provider = new FakeProvider();
	sync = new SyncManager(app as never, provider, new HistoryStore(app as never, { dailyNotePath: "Daily" }));
});

describe("syncDate with the history setting", () => {
	it("stores the day in the history and creates no note", async () => {
		const outcome = await sync.syncDate(DATE, settings({ missingNoteBehaviour: "history" }));
		expect(outcome).toBe("synced");
		expect(app.vault.paths()).toEqual(["Daily/Garmin history/Garmin history 2026-10.md"]);
		expect(app.vault.text("Daily/Garmin history/Garmin history 2026-10.md")).toContain(`${DATE} {"_m":["sleep_score","steps"],"steps":8000}`);
	});

	it("keeps the history in metric units whatever the notes use", async () => {
		provider.defaultData = { metrics: { distance_km: 10 }, activities: {}, trainings: [{ type: "running", category: "running", distance_km: 10, duration_min: 60 }] };
		await sync.syncDate(DATE, settings({ missingNoteBehaviour: "history", unitSystem: "imperial" }));
		const text = app.vault.text("Daily/Garmin history/Garmin history 2026-10.md");
		expect(text).toContain('"distance_km":10');
		expect(text).toContain('"trainings":[{"category":"running","distance_km":10,"duration_min":60,"type":"running"}]');
	});

	it("writes nothing to the history in the other modes", async () => {
		await sync.syncDate(DATE, settings({ missingNoteBehaviour: "create" }));
		expect(app.vault.paths()).toEqual([NOTE]);
	});
});

describe("the habits of the lifestyle log", () => {
	const HABITS = [{ key: "lifestyle_alcohol", name: "Alcohol", kind: "check" as const }, { key: "lifestyle_late_caffeine", name: "Late caffeine", kind: "count" as const }];

	it("are remembered from a sync, a rename is followed, and none is switched on by it", async () => {
		provider.defaultData = { metrics: { steps: 8000 }, activities: {}, habits: HABITS };
		const s = settings();
		await sync.syncDate(DATE, s);
		expect(s.lifestyleHabits).toEqual({ lifestyle_alcohol: { name: "Alcohol", kind: "check" }, lifestyle_late_caffeine: { name: "Late caffeine", kind: "count" } });
		expect(s.enabledMetrics["lifestyle_alcohol"]).toBeUndefined();
		provider.defaultData = { metrics: { steps: 8000 }, activities: {}, habits: [{ key: "lifestyle_alcohol", name: "Alcohol (any)", kind: "check" }] };
		await sync.syncDate(DATE, s);
		expect(s.lifestyleHabits["lifestyle_alcohol"]!.name).toBe("Alcohol (any)");
		expect(Object.keys(s.lifestyleHabits)).toHaveLength(2);
	});

	it("are remembered from the days of a backfill too", async () => {
		provider.defaultData = { metrics: { steps: 8000 }, activities: {}, habits: HABITS };
		const s = settings({ missingNoteBehaviour: "history" });
		const p = sync.backfill("2026-10-22", "2026-10-23", s);
		await vi.runAllTimersAsync();
		await p;
		expect(Object.keys(s.lifestyleHabits)).toEqual(["lifestyle_alcohol", "lifestyle_late_caffeine"]);
	});
});

describe("syncDate", () => {
	it("fetches the enabled metrics, writes the note and reports success", async () => {
		const outcome = await sync.syncDate(DATE, settings());
		expect(outcome).toBe("synced");
		expect(provider.fetchCalls).toEqual([{ date: DATE, enabledMetrics: ["steps", "sleep_score"] }]);
		expect(frontmatter(NOTE)).toBe("---\nsteps: 8000\n---\n");
		expect(msgs()).toEqual([en.noticeSyncing, en.noticeSyncSuccess]);
	});

	it("uses the user's language for notices", async () => {
		await sync.syncDate(DATE, settings({ language: "de" }));
		expect(msgs()).toEqual([de.noticeSyncing, de.noticeSyncSuccess]);
	});

	it("shows no notices in quiet mode", async () => {
		await sync.syncDate(DATE, settings(), true);
		expect(msgs()).toEqual([]);
	});

	it("applies the property prefix, the template and the trainings setting", async () => {
		provider.defaultData = {
			metrics: { steps: 5 },
			activities: { running: "5 km" },
			trainings: [{ type: "running", category: "running", distance_km: 5 }],
		};
		await sync.syncDate(DATE, settings({ usePrefix: true, dailyNoteTemplate: "# Day\n", writeTrainings: true }));
		const text = frontmatter(NOTE);
		expect(text).toContain("ohs_steps: 5");
		expect(text).toContain("ohs_running: 5 km");
		expect(text).toContain("ohs_trainings:");
		expect(text.endsWith("---\n# Day\n")).toBe(true);
	});

	it("converts to imperial units when configured", async () => {
		provider.defaultData = { metrics: { distance_km: 10, weight_kg: 80 }, activities: { running: "10 km" } };
		await sync.syncDate(DATE, settings({ unitSystem: "imperial" }));
		const text = frontmatter(NOTE);
		expect(text).toContain("distance_mi: 6.2");
		expect(text).toContain("weight_lbs: 176.4");
		expect(text).toContain("running: 6.2 mi");
		expect(text).not.toContain("distance_km");
	});

	it("keeps metric units by default", async () => {
		provider.defaultData = { metrics: { distance_km: 10 }, activities: {} };
		await sync.syncDate(DATE, settings());
		expect(frontmatter(NOTE)).toContain("distance_km: 10");
	});

	it("looks up the workout location when enabled", async () => {
		net.on(/nominatim/, { status: 200, body: { address: { city: "Wien", country: "Austria" } } });
		provider.defaultData = { metrics: { steps: 1 }, activities: {}, startLocation: { lat: 48.2, lon: 16.4 } };
		await sync.syncDate(DATE, settings({ writeWorkoutLocation: true }));
		expect(frontmatter(NOTE)).toContain("workout_location: Wien, Austria");
	});

	it("reports no data and writes nothing when the provider returns nothing", async () => {
		provider.defaultData = { metrics: {}, activities: {} };
		const outcome = await sync.syncDate(DATE, settings());
		expect(outcome).toBe("no-data");
		expect(app.vault.paths()).toEqual([]);
		expect(msgs()).toEqual([en.noticeSyncing, en.noticeSyncNoData]);
	});

	it("counts activities alone as data", async () => {
		provider.defaultData = { metrics: {}, activities: { yoga: "30min" } };
		expect(await sync.syncDate(DATE, settings())).toBe("synced");
	});

	it("is quiet about no data in quiet mode", async () => {
		provider.defaultData = { metrics: {}, activities: {} };
		expect(await sync.syncDate(DATE, settings(), true)).toBe("no-data");
		expect(msgs()).toEqual([]);
	});

	it("does not write a note that already matches (no change event for sync tools)", async () => {
		await sync.syncDate(DATE, settings());
		const writes = app.vault.log.length;
		await sync.syncDate(DATE, settings());
		expect(app.vault.log).toHaveLength(writes);
		expect(app.vault.modifyCount()).toBe(1);
	});

	it("refuses when the provider is not configured", async () => {
		provider.configured = false;
		expect(await sync.syncDate(DATE, settings())).toBe("error");
		expect(msgs()).toEqual([en.noticeLoginRequired]);
		expect(provider.fetchCalls).toEqual([]);
	});

	describe("authentication", () => {
		it("signs in first when there is no session, then syncs", async () => {
			provider.sessionValid = false;
			expect(await sync.syncDate(DATE, settings())).toBe("synced");
			expect(provider.authCalls).toBe(1);
		});

		it("returns an error and fetches nothing when the sign-in fails", async () => {
			provider.sessionValid = false;
			provider.authResult = { ok: false, cancelled: false };
			expect(await sync.syncDate(DATE, settings())).toBe("error");
			expect(provider.fetchCalls).toEqual([]);
			expect(msgs()).toEqual([en.noticeSyncing, en.noticeSyncError]);
		});

		it("is quiet about a failed sign-in in quiet mode", async () => {
			provider.sessionValid = false;
			provider.authResult = { ok: false, cancelled: false };
			await sync.syncDate(DATE, settings(), true);
			expect(msgs()).toEqual([]);
		});

		it("does not sign in when the session is valid", async () => {
			await sync.syncDate(DATE, settings());
			expect(provider.authCalls).toBe(0);
		});
	});

	describe("errors", () => {
		it("re-throws a login-required error after telling the user, so the caller can pause auto-sync", async () => {
			provider.byDate.set(DATE, new LoginRequiredError());
			await expect(sync.syncDate(DATE, settings())).rejects.toBeInstanceOf(LoginRequiredError);
			expect(msgs()).toEqual([en.noticeSyncing, en.noticeLoginRequired]);
		});

		it("re-throws silently in quiet mode", async () => {
			provider.byDate.set(DATE, new LoginRequiredError());
			await expect(sync.syncDate(DATE, settings(), true)).rejects.toBeInstanceOf(LoginRequiredError);
			expect(msgs()).toEqual([]);
		});

		it("turns any other failure into an error outcome with a notice", async () => {
			provider.byDate.set(DATE, new Error("boom"));
			expect(await sync.syncDate(DATE, settings())).toBe("error");
			expect(msgs()).toEqual([en.noticeSyncing, en.noticeSyncError]);
		});

		it("is quiet about other failures in quiet mode", async () => {
			provider.byDate.set(DATE, new Error("boom"));
			expect(await sync.syncDate(DATE, settings(), true)).toBe("error");
			expect(msgs()).toEqual([]);
		});

		it("returns an error when writing the note fails", async () => {
			app.vault.failOn = (op) => (op === "create" ? new Error("read-only vault") : null);
			expect(await sync.syncDate(DATE, settings())).toBe("error");
			expect(msgs()).toEqual([en.noticeSyncing, en.noticeSyncError]);
		});
	});

	describe("wait for the note", () => {
		const wait = { waitForNote: true };

		it("calls nothing and creates nothing while there is no real note", async () => {
			const outcome = await sync.syncDate(DATE, settings(), false, wait);
			expect(outcome).toBe("skipped-missing-note");
			expect(provider.fetchCalls).toEqual([]);
			expect(provider.authCalls).toBe(0);
			expect(app.vault.paths()).toEqual([]);
			expect(msgs()).toEqual([en.noticeSyncWaitingForNote.replace("{date}", DATE)]);
		});

		it("is quiet while waiting in quiet mode", async () => {
			await sync.syncDate(DATE, settings(), true, wait);
			expect(msgs()).toEqual([]);
		});

		it("keeps waiting for an empty placeholder note", async () => {
			app.vault.seed(NOTE, "");
			expect(await sync.syncDate(DATE, settings(), true, wait)).toBe("skipped-missing-note");
			expect(provider.fetchCalls).toEqual([]);
		});

		it("syncs into an existing note and does not create anything", async () => {
			app.vault.seed(NOTE, "Body\n");
			expect(await sync.syncDate(DATE, settings(), true, wait)).toBe("synced");
			expect(provider.fetchCalls).toHaveLength(1);
			expect(app.vault.paths()).toEqual([NOTE]);
			expect(frontmatter(NOTE)).toBe("---\nsteps: 8000\n---\nBody\n");
		});

		it("does not create the note if it vanished while fetching", async () => {
			app.vault.seed(NOTE, "Body\n");
			provider.onFetch = () => {
				// the note is deleted by another tool mid-sync
				(app.vault as unknown as { files: Map<string, unknown> }).files.delete(NOTE);
			};
			await sync.syncDate(DATE, settings(), true, wait);
			expect(app.vault.log.filter((l) => l.op === "create")).toEqual([]);
		});
	});
});

describe("backfill", () => {
	/** Run a backfill to completion, advancing the fake clock. */
	async function run(from: string, to: string, s = settings(), options: Parameters<SyncManager["backfill"]>[3] = {}): Promise<void> {
		const p = sync.backfill(from, to, s, options);
		await vi.runAllTimersAsync();
		await p;
	}
	/** The texts the progress notice was given, in order, with the status bar text. */
	function shown(): { texts: () => string[]; status: () => string[] } {
		const spy = vi.spyOn(ProgressNotice.prototype, "setText");
		return { texts: () => spy.mock.calls.map((c) => c[0]), status: () => spy.mock.calls.map((c) => c[1]) };
	}
	const openNotices = (): typeof Notice.recorded => Notice.recorded.filter((n) => n.fragment && !n.hidden);

	it("syncs every day in the range, newest first, creates the notes and says how it went", async () => {
		await run("2026-10-22", "2026-10-24");
		expect(fetchedDates()).toEqual(["2026-10-24", "2026-10-23", "2026-10-22"]);
		expect(app.vault.paths()).toEqual(["Daily/2026-10-22.md", "Daily/2026-10-23.md", "Daily/2026-10-24.md"]);
		expect(msgs().at(-1)).toBe("Backfill done: 3 days fetched, 0 were already there");
		expect(Notice.recorded.at(-1)?.duration).toBe(15000);
	});

	it("shows where it is in a notice that stays on screen, and in the status bar text", async () => {
		const spy = shown();
		await run("2026-10-22", "2026-10-24");
		expect(spy.texts()[0]).toBe("Backfill · 2026-10-24 · 0 of 3 days");
		// the notice is updated at most once a second, so the last day may not show before the end
		expect(spy.texts().at(-1)).toMatch(/^Backfill · 2026-10-22 · \d of 3 days · about 1 min left$/);
		expect(spy.status().at(-1)).toMatch(/^Backfill \d+%$/);
		vi.restoreAllMocks();
		const german = shown();
		await run("2026-10-23", "2026-10-24", settings({ language: "de", fetchLog: {} }));
		expect(german.texts()[0]).toBe("Nachsynchronisierung · 2026-10-24 · 0 von 2 Tagen");
		vi.restoreAllMocks();
	});

	it("shows a notice with a Stop button that stays until the end and is hidden afterwards", async () => {
		await run("2026-10-24", "2026-10-24");
		expect(Notice.recorded[0]).toMatchObject({ duration: 0, hidden: true });
		expect(Notice.recorded[0]!.fragment?.querySelector("button")?.textContent).toBe(en.historyStop);
	});

	describe("the progress notice", () => {
		it("comes back after a click dismissed it, with the latest text, and does not stack", async () => {
			provider.gate = new Promise(() => undefined);
			void sync.backfill("2026-10-22", "2026-10-24", settings());
			await vi.advanceTimersByTimeAsync(0);
			expect(sync.backfilling).toBe(true);
			expect(sync.revealProgress()).toBe(true);
			expect(openNotices()).toHaveLength(1);
			expect(openNotices()[0]!.fragment!.querySelector(".ghs-history-text")?.textContent).toContain("0 of 3 days");
		});

		it("has nothing to bring back when no backfill runs", () => {
			expect(sync.revealProgress()).toBe(false);
			expect(sync.backfilling).toBe(false);
		});
	});

	describe("a second backfill while one runs", () => {
		it("is not started: it shows the running one and fetches nothing twice", async () => {
			provider.gate = new Promise(() => undefined);
			void sync.backfill("2026-10-22", "2026-10-24", settings());
			await vi.advanceTimersByTimeAsync(0);
			await sync.backfill("2026-10-23", "2026-10-25", settings());
			expect(msgs()).toContain(en.noticeBackfillRunning);
			expect(fetchedDates()).toEqual(["2026-10-24"]);
			expect(openNotices()).toHaveLength(1);
		});

		it("may start again once the first has ended", async () => {
			await run("2026-10-24", "2026-10-24");
			await run("2026-10-24", "2026-10-24");
			expect(fetchedDates()).toEqual(["2026-10-24", "2026-10-24"]);
		});
	});

	describe("stopping", () => {
		it("ends after the day it is at, says where, and lets a later run continue", async () => {
			provider.onFetch = () => sync.stopBackfill();
			await run("2026-10-22", "2026-10-24");
			expect(fetchedDates()).toEqual(["2026-10-24"]);
			expect(msgs().at(-1)).toBe("Backfill stopped at 2026-10-23. Run it again to continue.");
			expect(sync.backfilling).toBe(false);
		});

		it("does nothing without a running backfill", () => {
			sync.stopBackfill();
			expect(sync.backfilling).toBe(false);
		});

		it("stops from the button of the notice", async () => {
			provider.onFetch = () => openNotices()[0]!.fragment!.querySelector("button")!.click();
			await run("2026-10-22", "2026-10-24");
			expect(fetchedDates()).toEqual(["2026-10-24"]);
		});
	});

	describe("where it is", () => {
		it("is reported every 5 fetched days with the next day, so a restart can go on from there", async () => {
			const cursor: string[] = [];
			await run("2026-10-10", "2026-10-22", settings(), { onCursor: async (next) => void cursor.push(next) });
			expect(cursor).toEqual(["2026-10-17", "2026-10-12"]);
		});
	});

	describe("the status bar", () => {
		it("takes the item it is given and removes it at the end", async () => {
			const bar = document.createElement("div");
			document.body.appendChild(bar);
			await run("2026-10-24", "2026-10-24", settings(), { statusBar: () => bar });
			expect(bar.isConnected).toBe(false);
		});
	});

	describe("days that an earlier run fetched", () => {
		it("are not fetched again, so a second run over the same range costs nothing", async () => {
			const s = settings();
			await run("2026-10-10", "2026-10-14", s);
			expect(provider.fetchCalls).toHaveLength(5);
			provider.fetchCalls = [];
			await run("2026-10-10", "2026-10-14", s);
			expect(provider.fetchCalls).toEqual([]);
			expect(msgs().at(-1)).toBe(en.noticeBackfillNothing);
		});

		it("are skipped inside a longer range: only the new days are asked for, and the progress counts those", async () => {
			const s = settings();
			await run("2026-10-10", "2026-10-12", s);
			provider.fetchCalls = [];
			const spy = shown();
			await run("2026-10-08", "2026-10-14", s);
			expect(fetchedDates()).toEqual(["2026-10-14", "2026-10-13", "2026-10-09", "2026-10-08"]);
			expect(spy.texts()[0]).toBe("Backfill · 2026-10-14 · 0 of 4 days");
			vi.restoreAllMocks();
		});

		it("are fetched again when more metrics are wanted now", async () => {
			const s = settings();
			await run("2026-10-10", "2026-10-11", s);
			provider.fetchCalls = [];
			const more = { ...s, enabledMetrics: { steps: true, hrv: true, sleep_score: true } };
			await run("2026-10-10", "2026-10-11", more);
			expect(fetchedDates()).toEqual(["2026-10-11", "2026-10-10"]);
			expect(provider.fetchCalls[0]!.enabledMetrics).toEqual(["steps", "hrv", "sleep_score"]);
			provider.fetchCalls = [];
			await run("2026-10-10", "2026-10-11", s);
			expect(provider.fetchCalls).toEqual([]);
		});

		it("include days without data, but not failed days or the last three days", async () => {
			provider.byDate.set("2026-10-20", { metrics: {}, activities: {} });
			provider.byDate.set("2026-10-21", new Error("down"));
			const s = settings();
			await run("2026-10-20", "2026-10-25", s); // now is 2026-10-25: days before the 22nd are final
			provider.fetchCalls = [];
			provider.byDate.delete("2026-10-21");
			await run("2026-10-20", "2026-10-25", s);
			expect(fetchedDates()).toEqual(["2026-10-25", "2026-10-24", "2026-10-23", "2026-10-22", "2026-10-21"]);
		});

		it("are fetched again, and overwritten, when the backfill is forced", async () => {
			const s = settings();
			await run("2026-10-10", "2026-10-11", s);
			provider.fetchCalls = [];
			provider.defaultData = { metrics: { steps: 9999 }, activities: {} };
			await run("2026-10-10", "2026-10-11", s, { force: true });
			expect(fetchedDates()).toEqual(["2026-10-11", "2026-10-10"]);
			expect(app.vault.text("Daily/2026-10-10.md")).toContain("steps: 9999");
		});

		it("are not counted as fetched when storing them failed, so the next run tries again", async () => {
			const s = settings();
			app.vault.failOn = (op) => (op === "create" ? new Error("disk full") : null);
			await run("2026-10-10", "2026-10-11", s);
			expect(s.fetchLog).toEqual({});
			expect(msgs().at(-1)).toContain("2 failed");
			app.vault.failOn = null;
			provider.fetchCalls = [];
			await run("2026-10-10", "2026-10-11", s);
			expect(fetchedDates()).toEqual(["2026-10-11", "2026-10-10"]);
		});

		it("are also skipped when the history notes already hold them with the metrics wanted", async () => {
			app.vault.seed("Daily/Garmin history/Garmin history 2026-10.md", serializeMonth("2026-10", new Map([["2026-10-10", { steps: 1, _m: ["sleep_score", "steps"] }], ["2026-10-11", { steps: 2 }], ["2026-10-12", { steps: 3, _m: ["steps"] }]])));
			await run("2026-10-10", "2026-10-12", settings());
			expect(fetchedDates()).toEqual(["2026-10-12"]);
		});

		it("move the history notes of an earlier folder first and are then skipped from there", async () => {
			app.vault.seed("Old/Garmin history/Garmin history 2026-10.md", serializeMonth("2026-10", new Map([["2026-10-10", { steps: 1, _m: ["sleep_score", "steps"] }]])));
			await run("2026-10-10", "2026-10-10", settings());
			expect(provider.fetchCalls).toEqual([]);
			expect(app.vault.paths()).toEqual(["Daily/Garmin history/Garmin history 2026-10.md"]);
		});
	});

	describe("days without a daily note", () => {
		it("get a note when the setting says create", async () => {
			await run("2026-10-24", "2026-10-24", settings({ missingNoteBehaviour: "create" }));
			expect(app.vault.paths()).toEqual([NOTE]);
		});

		it("are not asked for when the setting says skip: only days that already have a note are fetched", async () => {
			app.vault.seed("Daily/2026-10-23.md", "---\ntags: x\n---\nbody");
			await run("2026-10-22", "2026-10-24", settings({ missingNoteBehaviour: "skip" }));
			expect(fetchedDates()).toEqual(["2026-10-23"]);
			expect(app.vault.paths()).toEqual(["Daily/2026-10-23.md"]);
		});

		it("are kept in the history notes, with no daily note made, when the setting says history", async () => {
			await run("2026-10-22", "2026-10-24", settings({ missingNoteBehaviour: "history" }));
			expect(app.vault.paths()).toEqual(["Daily/Garmin history/Garmin history 2026-10.md"]);
			const text = app.vault.text("Daily/Garmin history/Garmin history 2026-10.md");
			expect(text).toContain('2026-10-22 {"_m":["sleep_score","steps"],"steps":8000}');
			expect(text).toContain('2026-10-24 {"_m":["sleep_score","steps"],"steps":8000}');
		});

		it("also update a note that exists, besides the history, when the setting says history", async () => {
			app.vault.seed("Daily/2026-10-24.md", "---\ntags: x\n---\nbody");
			await run("2026-10-23", "2026-10-24", settings({ missingNoteBehaviour: "history" }));
			expect(app.vault.text("Daily/2026-10-24.md")).toContain("steps: 8000");
			expect(app.vault.paths()).toEqual(["Daily/2026-10-24.md", "Daily/Garmin history/Garmin history 2026-10.md"]);
		});

		it("follow the choice made for this run, not the setting", async () => {
			await run("2026-10-24", "2026-10-24", settings({ missingNoteBehaviour: "create" }), { behaviour: "history" });
			expect(app.vault.paths()).toEqual(["Daily/Garmin history/Garmin history 2026-10.md"]);
		});
	});

	it("goes on past a long stretch of empty days until the data starts when asked to", async () => {
		provider.defaultData = { metrics: {}, activities: {} };
		provider.byDate.set("2026-10-20", { metrics: { steps: 1 }, activities: {} });
		await run("2025-01-01", "2026-10-20", settings({ missingNoteBehaviour: "history" }), { untilStart: true });
		expect(provider.fetchCalls).toHaveLength(121);
		expect(msgs().at(-1)).toBe("Backfill done: 121 days fetched, 0 were already there");
	});

	it("passes the enabled metrics and uses the provider's recommended delay", async () => {
		provider.batchDelay = 5000;
		await run("2026-10-23", "2026-10-24");
		expect(provider.delayCalls).toEqual([["steps", "sleep_score"]]);
		expect(provider.fetchCalls[0]?.enabledMetrics).toEqual(["steps", "sleep_score"]);
	});

	it("applies prefix, template and imperial units like a single sync", async () => {
		provider.defaultData = { metrics: { distance_km: 10 }, activities: {} };
		await run("2026-10-24", "2026-10-24", settings({ usePrefix: true, unitSystem: "imperial", dailyNoteTemplate: "T\n" }));
		const text = frontmatter(NOTE);
		expect(text).toContain("ohs_distance_mi: 6.2");
		expect(text.endsWith("---\nT\n")).toBe(true);
	});

	it("writes no note for a day Garmin has no data for, and does not count it as a failure", async () => {
		provider.byDate.set("2026-10-23", { metrics: {}, activities: {} });
		await run("2026-10-22", "2026-10-24");
		expect(app.vault.paths()).not.toContain("Daily/2026-10-23.md");
		expect(msgs().at(-1)).toBe("Backfill done: 3 days fetched, 0 were already there");
	});

	it("retries a failed day, then goes on with the next and says how many failed", async () => {
		provider.byDate.set("2026-10-23", new Error("429"));
		await run("2026-10-22", "2026-10-24");
		expect(fetchedDates()).toEqual(["2026-10-24", "2026-10-23", "2026-10-23", "2026-10-23", "2026-10-22"]);
		expect(msgs().at(-1)).toBe("Backfill done: 2 days fetched, 0 were already there, 1 failed. Run the backfill again to retry them.");
	});

	describe("pacing (Garmin allows ~50 requests a minute)", () => {
		beforeEach(() => {
			provider.batchDelay = 4000;
		});

		/** Time (ms since start) at which each day was fetched. */
		async function fetchTimes(from: string, to: string): Promise<Record<string, number>> {
			const t0 = Date.now();
			const times: Record<string, number> = {};
			provider.onFetch = (d) => (times[d] = Date.now() - t0);
			await run(from, to);
			return times;
		}

		it("waits the delay between days and not after the last", async () => {
			const times = await fetchTimes("2026-10-22", "2026-10-24");
			expect(times).toEqual({ "2026-10-24": 0, "2026-10-23": 4000, "2026-10-22": 8000 });
		});

		it("does not wait after the last day (the run finishes right after its fetch)", async () => {
			const start = Date.now();
			await run("2026-10-22", "2026-10-23");
			expect(Date.now() - start).toBe(4000);
		});

		it("waits after a day with no data as well", async () => {
			provider.byDate.set("2026-10-23", { metrics: {}, activities: {} });
			const times = await fetchTimes("2026-10-22", "2026-10-24");
			expect(times["2026-10-22"]).toBe(8000);
		});

		it("falls back to 2 seconds when the provider has no recommendation", async () => {
			provider = new NoDelayProvider();
			sync = new SyncManager(app as never, provider, new HistoryStore(app as never, { dailyNotePath: "Daily" }));
			const times = await fetchTimes("2026-10-22", "2026-10-23");
			expect(times["2026-10-22"]).toBe(2000);
		});
	});

	describe("date ranges", () => {
		async function range(from: string, to: string): Promise<string[]> {
			await run(from, to);
			return provider.fetchCalls.map((c) => c.date);
		}

		it("handles a single day", async () => {
			expect(await range("2026-10-24", "2026-10-24")).toEqual(["2026-10-24"]);
		});

		it("crosses a month end", async () => {
			expect(await range("2026-10-30", "2026-11-02")).toEqual(["2026-11-02", "2026-11-01", "2026-10-31", "2026-10-30"]);
		});

		it("crosses a year end", async () => {
			expect(await range("2026-12-30", "2027-01-02")).toEqual(["2027-01-02", "2027-01-01", "2026-12-31", "2026-12-30"]);
		});

		it("includes a leap day and skips it in other years", async () => {
			expect(await range("2028-02-28", "2028-03-01")).toEqual(["2028-03-01", "2028-02-29", "2028-02-28"]);
			provider.fetchCalls = [];
			expect(await range("2027-02-28", "2027-03-01")).toEqual(["2027-03-01", "2027-02-28"]);
		});

		it("does not skip or repeat a day over the clock change", async () => {
			expect(await range("2026-03-28", "2026-03-30")).toEqual(["2026-03-30", "2026-03-29", "2026-03-28"]);
			provider.fetchCalls = [];
			expect(await range("2026-10-24", "2026-10-26")).toEqual(["2026-10-26", "2026-10-25", "2026-10-24"]);
		});

		it("does nothing for a start after the end", async () => {
			await run("2026-10-25", "2026-10-24");
			expect(provider.fetchCalls).toEqual([]);
			expect(msgs().at(-1)).toBe(en.noticeBackfillNothing);
		});

		it("does nothing for empty or invalid dates", async () => {
			await run("", "");
			await run("garbage", "2026-10-24");
			expect(provider.fetchCalls).toEqual([]);
		});
	});

	describe("authentication and login errors", () => {
		it("refuses when the provider is not configured", async () => {
			provider.configured = false;
			await run("2026-10-24", "2026-10-24");
			expect(msgs()).toEqual([en.noticeLoginRequired]);
		});

		it("signs in first when there is no session", async () => {
			provider.sessionValid = false;
			await run("2026-10-24", "2026-10-24");
			expect(provider.authCalls).toBe(1);
			expect(fetchedDates()).toEqual(["2026-10-24"]);
		});

		it("stops when the sign-in fails, hides the progress notice and fetches nothing", async () => {
			provider.sessionValid = false;
			provider.authResult = { ok: false, cancelled: false };
			await run("2026-10-24", "2026-10-24");
			expect(provider.fetchCalls).toEqual([]);
			expect(msgs().at(-1)).toBe(en.noticeLoginRequired);
			expect(Notice.recorded.filter((n) => n.fragment).every((n) => n.hidden)).toBe(true);
			expect(sync.backfilling).toBe(false);
		});

		it("stops at a login-required error, keeps the days already done and tells the user once", async () => {
			provider.byDate.set("2026-10-23", new LoginRequiredError());
			await run("2026-10-22", "2026-10-25");
			expect(fetchedDates()).toEqual(["2026-10-25", "2026-10-24", "2026-10-23"]);
			expect(msgs().filter((m) => m === en.noticeLoginRequired)).toHaveLength(1);
			expect(Notice.recorded[0]?.hidden).toBe(true);
		});

		it("shows an error notice when something outside a day fails, and can run again", async () => {
			provider.getRecommendedBatchDelay = () => {
				throw new Error("unexpected");
			};
			await run("2026-10-24", "2026-10-24");
			expect(msgs()).toContain(en.noticeSyncError);
			expect(Notice.recorded[0]?.hidden).toBe(true);
			expect(sync.backfilling).toBe(false);
		});
	});
});
