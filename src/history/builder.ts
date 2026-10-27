import { daysBetween, localDateString, shiftDate } from "../dates";
import { isLoginRequiredError } from "../errors";
import type { HealthData, HealthProvider } from "../providers/provider";
import { FETCHED_KEY, type DayRecord } from "./format";
import { recordFromData } from "./record";
import type { HistoryStore } from "./store";

/** Days without any data in a row, after data was found, that mean the account starts here. */
export const EMPTY_RUN_STOP = 120;
/** A day without data newer than this may still fill in, so it is not remembered as empty. */
const RECENT_DAYS = 3;
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

interface BuilderOptions {
	provider: HealthProvider;
	store: HistoryStore;
	/** The metrics that are fetched: the user's enabled ones. */
	enabledMetrics: string[];
	/** Updates a daily note that exists with the fetched day (never creates one). */
	writeNote: (date: string, data: HealthData) => Promise<void>;
	onProgress: (progress: BuildProgress) => void;
}

/** A record is complete when it came from notes (no list of requested metrics) or asked for every metric that is wanted now. */
function isComplete(record: DayRecord, requested: string[]): boolean {
	const asked = record[FETCHED_KEY];
	return !Array.isArray(asked) || requested.every((metric) => (asked as string[]).includes(metric));
}

/**
 * Fills the history from the newest day back to `from`: the days the panel needs first come first, so stopping
 * early still leaves the most useful data. Days already in the history are skipped, so a run that was stopped,
 * or failed, continues where it left off. Requests are spaced by the provider's recommended delay.
 */
export class HistoryBuilder {
	private stopped = false;
	private wake: (() => void) | null = null;

	constructor(private readonly options: BuilderOptions) {}

	/** Ends the run after the day in progress; a wait in between ends at once. */
	stop(): void {
		this.stopped = true;
		this.wake?.();
	}

	private wait(ms: number): Promise<void> {
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
		const { provider, store, enabledMetrics, writeNote, onProgress } = this.options;
		const requested = [...enabledMetrics].sort();
		const delay = provider.getRecommendedBatchDelay?.(enabledMetrics) ?? 2000;
		const total = daysBetween(from, to) + 1;
		const recentLimit = shiftDate(localDateString(new Date()), -RECENT_DAYS);
		const startedAt = Date.now();
		const pending = new Map<string, DayRecord>();
		let pendingMonth = "";
		let done = 0;
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

		const flush = async (): Promise<void> => {
			if (pending.size === 0) return;
			const records = new Map(pending);
			pending.clear();
			await store.putMany(records);
		};
		const report = (state: "running" | "paused", pauseMs = 0): void => {
			const etaMs = fetched === 0 ? null : Math.round(((Date.now() - startedAt) / fetched) * (total - done));
			onProgress({ state, date, done, total, fetched, skipped, failed, etaMs, pauseMs });
		};
		const keep = async (day: string, record: DayRecord): Promise<void> => {
			if (pending.size > 0 && day.slice(0, 7) !== pendingMonth) await flush();
			pendingMonth = day.slice(0, 7);
			pending.set(day, record);
		};

		await store.warm(from, to);
		try {
			for (date = to; date >= from; date = shiftDate(date, -1)) {
				if (this.stopped) {
					status = "stopped";
					break;
				}
				report("running");
				const known = store.get(date);
				let hasData: boolean;
				if (known && isComplete(known, requested)) {
					skipped++;
					hasData = Object.keys(known).some((key) => key !== FETCHED_KEY);
				} else {
					const result = await this.fetchDay(date, enabledMetrics);
					if (result === "login-required" || result === "stopped") {
						status = result === "stopped" ? "stopped" : "login-required";
						break;
					}
					if (result === null) {
						failed++;
						failedInARow++;
						done++;
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
					fetched++;
					hasData = Object.keys(result.metrics).length > 0 || Object.keys(result.activities).length > 0;
					if (hasData) {
						await keep(date, recordFromData(result, requested));
						await writeNote(date, result);
					} else if (date < recentLimit) {
						await keep(date, { [FETCHED_KEY]: requested });
					}
					if (pending.size >= FLUSH_EVERY_DAYS) await flush();
					if (date > from && !this.stopped) await this.wait(delay);
				}
				done++;
				if (hasData) {
					sawData = true;
					emptyRun = 0;
				} else if (sawData && ++emptyRun >= EMPTY_RUN_STOP) {
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
