import { localDateString, shiftDate } from "../dates";
import { isLoginRequiredError } from "../errors";
import type { MissingNoteBehaviour } from "../settings";
import type { HealthData, HealthProvider } from "../providers/provider";
import { FETCHED_KEY, type DayRecord } from "./format";
import { RECENT_DAYS } from "../fetch-log";
import { recordFromData } from "./record";
import type { HistoryStore } from "./store";

/** Days without any data in a row, after data was found, that mean the account starts here. */
export const EMPTY_RUN_STOP = 120;
const RETRY_WAITS_MS = [30_000, 60_000];
const FAILED_DAYS_BEFORE_PAUSE = 3;
const FIRST_PAUSE_MS = 5 * 60_000;
const LAST_PAUSE_MS = 30 * 60_000;
const PAUSES_BEFORE_GIVING_UP = 5;
const FLUSH_EVERY_DAYS = 10;

export interface BuildProgress {
	state: "running" | "paused";
	/** The day being worked on. */
	date: string;
	/** Days looked at so far, fetched or already in the history. */
	done: number;
	/** Days in the range; the run may end earlier. */
	total: number;
	fetched: number;
	skipped: number;
	failed: number;
	/** Milliseconds left at the pace so far, or null before the first fetched day. */
	etaMs: number | null;
	/** How long a pause lasts (paused only). */
	pauseMs: number;
}

export type BuildStatus = "done" | "stopped" | "gave-up" | "login-required";

export interface BuildResult {
	status: BuildStatus;
	fetched: number;
	skipped: number;
	failed: number;
	/** The last day looked at. */
	date: string;
	/** The run ended because 120 days in a row had no data, which is where the data starts. */
	reachedStart: boolean;
}

/** Where the days of a run go, whether the ones without a note are fetched at all, and the things the run needs from the plugin. */
interface BackfillOptions {
	provider: HealthProvider;
	store: HistoryStore;
	/** The metrics that are fetched: the user's enabled ones. */
	enabledMetrics: string[];
	/** What happens to a day without a daily note: the note is created, the day is kept in the history files, or the day is not fetched. */
	behaviour: MissingNoteBehaviour;
	/** Fetch the days again that are complete. */
	force: boolean;
	/** The run goes on until the data of the account starts (a long stretch of empty days after data), not only to the first day of the range. */
	untilStart: boolean;
	hasNote: (date: string) => boolean;
	/** Whether the fetch log says an earlier run fetched the day with every wanted metric. */
	wasFetched: (date: string) => boolean;
	/** Remembers a day as fetched. */
	markFetched: (date: string) => void;
	/** Writes the day into its daily note; with `mayCreate` the note is made when it is missing. */
	writeNote: (date: string, data: HealthData, mayCreate: boolean) => Promise<void>;
	/** Called every few days with the next day to do, so a restart can go on from there. */
	onCursor?: (next: string) => Promise<void>;
	onProgress: (progress: BuildProgress) => void;
}

/** A record is complete when it came from notes (no list of requested metrics) or asked for every metric that is wanted now. */
export function isComplete(record: DayRecord, requested: string[]): boolean {
	const asked = record[FETCHED_KEY];
	return !Array.isArray(asked) || requested.every((metric) => (asked as string[]).includes(metric));
}

/** The cursor is reported after this many fetched days. */
const CURSOR_EVERY_DAYS = 5;

/**
 * The backfill: fetches the days from the newest back to `from`, so the days the panel needs first come first and
 * stopping early still leaves the most useful data. A day that is complete (in the history files, or in the fetch
 * log) is skipped, so a run that was stopped or failed continues where it left off; the last few days are always
 * fetched again. Requests are spaced by the provider's recommended delay and a failing Garmin is waited out.
 */
export class Backfill {
	private stopped = false;
	private wake: (() => void) | null = null;

	constructor(private readonly options: BackfillOptions) {}

	/** Ends the run after the day in progress; a wait in between ends at once. */
	stop(): void {
		this.stopped = true;
		this.wake?.();
	}

	private wait(ms: number): Promise<void> {
		// a stop that came while a request was running must not be followed by a wait of up to half an hour
		if (this.stopped) return Promise.resolve();
		return new Promise((resolve) => {
			const done = (): void => {
				window.clearTimeout(timer);
				this.wake = null;
				resolve();
			};
			const timer = window.setTimeout(done, ms);
			this.wake = done;
		});
	}

	async run(from: string, to: string): Promise<BuildResult> {
		// a range that is not two days in order would never end: nothing to do
		const isDay = (day: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(day);
		if (!isDay(from) || !isDay(to) || from > to) return { status: "done", fetched: 0, skipped: 0, failed: 0, date: to, reachedStart: false };
		const { provider, store, enabledMetrics, behaviour, force, untilStart, onProgress } = this.options;
		const requested = [...enabledMetrics].sort();
		const delay = provider.getRecommendedBatchDelay?.(enabledMetrics) ?? 2000;
		const recentLimit = shiftDate(localDateString(new Date()), -RECENT_DAYS);
		const startedAt = Date.now();
		const pending = new Map<string, DayRecord>();
		let pendingMonth = "";
		let fetched = 0;
		let skipped = 0;
		let failed = 0;
		let failedInARow = 0;
		let pauses = 0;
		let emptyRun = 0;
		let sawData = false;
		let date = to;
		let status: BuildStatus = "done";
		let reachedStart = false;

		/** What a day needs: a day that is complete is skipped, a day without a note too when the choice is to skip those. */
		const needsFetch = (day: string): boolean => {
			if (behaviour === "skip" && !this.options.hasNote(day)) return false;
			if (force || day >= recentLimit) return true;
			const known = store.get(day);
			return !((known && isComplete(known, requested)) || this.options.wasFetched(day));
		};

		await store.relocate();
		await store.warm(from, to);
		// the days that will be fetched, so "day 3 of 8" and the time left count what is really done
		let total = 0;
		for (let day = to; day >= from; day = shiftDate(day, -1)) if (needsFetch(day)) total++;

		const flush = async (): Promise<void> => {
			if (pending.size === 0) return;
			const records = new Map(pending);
			pending.clear();
			await store.putMany(records);
		};
		const report = (state: "running" | "paused", pauseMs = 0): void => {
			const done = fetched + failed;
			const etaMs = fetched === 0 ? null : Math.round(((Date.now() - startedAt) / fetched) * Math.max(0, total - done));
			onProgress({ state, date, done, total, fetched, skipped, failed, etaMs, pauseMs });
		};
		const keep = async (day: string, record: DayRecord): Promise<void> => {
			if (pending.size > 0 && day.slice(0, 7) !== pendingMonth) await flush();
			pendingMonth = day.slice(0, 7);
			pending.set(day, record);
		};

		try {
			for (date = to; date >= from; date = shiftDate(date, -1)) {
				if (this.stopped) {
					status = "stopped";
					break;
				}
				report("running");
				const known = store.get(date);
				let hasData = true;
				if (!needsFetch(date)) {
					// a day without a note that is not fetched says nothing about where the data starts
					if (behaviour === "skip" && !this.options.hasNote(date)) continue;
					skipped++;
					if (known) hasData = Object.keys(known).some((key) => key !== FETCHED_KEY);
				} else {
					const result = await this.fetchDay(date, enabledMetrics);
					if (result === "login-required" || result === "stopped") {
						status = result === "stopped" ? "stopped" : "login-required";
						break;
					}
					if (result === null) {
						failed++;
						failedInARow++;
						if (failedInARow >= FAILED_DAYS_BEFORE_PAUSE) {
							const pauseMs = Math.min(FIRST_PAUSE_MS * 2 ** pauses, LAST_PAUSE_MS);
							pauses++;
							failedInARow = 0;
							if (pauses >= PAUSES_BEFORE_GIVING_UP) {
								status = "gave-up";
								break;
							}
							report("paused", pauseMs);
							await this.wait(pauseMs);
						}
						continue;
					}
					failedInARow = 0;
					pauses = 0;
					hasData = Object.keys(result.metrics).length > 0 || Object.keys(result.activities).length > 0;
					try {
						if (hasData) {
							if (behaviour === "history") await keep(date, recordFromData(result, requested));
							await this.options.writeNote(date, result, behaviour !== "history");
						} else if (behaviour === "history" && date < recentLimit) {
							await keep(date, { [FETCHED_KEY]: requested });
						}
					} catch (error) {
						// a day that could not be stored is a failed day and is left for the next run; the others go on
						console.warn(`Garmin Health Sync: could not store ${date}`, error);
						failed++;
						if (date > from && !this.stopped) await this.wait(delay);
						continue;
					}
					fetched++;
					if (date < recentLimit) this.options.markFetched(date);
					if (pending.size >= FLUSH_EVERY_DAYS) await flush();
					if (fetched % CURSOR_EVERY_DAYS === 0) await this.options.onCursor?.(shiftDate(date, -1));
					if (date > from && !this.stopped) await this.wait(delay);
				}
				if (hasData) {
					sawData = true;
					emptyRun = 0;
				} else if (untilStart && sawData && ++emptyRun >= EMPTY_RUN_STOP) {
					reachedStart = true;
					break;
				}
			}
		} finally {
			await flush();
		}
		report("running");
		return { status, fetched, skipped, failed, date: date < from ? from : date, reachedStart };
	}

	/** One day with two retries; null when it failed, "login-required" when Garmin wants the user to sign in again, "stopped" when the user stopped the run while it was retrying. */
	private async fetchDay(date: string, enabledMetrics: string[]): Promise<HealthData | "login-required" | "stopped" | null> {
		const { provider } = this.options;
		for (let attempt = 0; ; attempt++) {
			try {
				return await provider.fetchData(date, enabledMetrics);
			} catch (error) {
				if (isLoginRequiredError(error)) return "login-required";
				console.warn(`Garmin Health Sync: history fetch failed for ${date}`, error);
				const waitMs = RETRY_WAITS_MS[attempt];
				if (waitMs === undefined) return null;
				await this.wait(waitMs);
				if (this.stopped) return "stopped";
			}
		}
	}
}
