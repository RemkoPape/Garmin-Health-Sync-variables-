import { App, Notice } from "obsidian";
import type { HealthData, HealthProvider } from "./providers/provider";
import { writeToDailyNote, dailyNoteExists } from "./daily-note";
import type { HistoryStore } from "./history/store";
import { recordFromData } from "./history/record";
import { BuildProgressUi } from "./history/progress";
import { Backfill } from "./history/backfill";
import { isFetched, markFetched } from "./fetch-log";
import type { HealthSyncSettings, MissingNoteBehaviour } from "./settings";
import { t } from "./i18n/t";
import { convertToImperial } from "./units";
import { isLoginRequiredError } from "./errors";

/** Remembers the habits of the lifestyle log Garmin sent, so the settings can list them; a habit is only ever added or renamed here. */
export function registerHabits(settings: HealthSyncSettings, data: HealthData, date: string): void {
	for (const habit of data.habits ?? []) {
		const last = settings.lifestyleHabits[habit.key]?.last ?? "";
		settings.lifestyleHabits[habit.key] = { name: habit.name, kind: habit.kind, last: date > last ? date : last };
	}
}

/**
 * Result of a single-date sync:
 *  - "synced": data was fetched and written
 *  - "no-data": the provider returned nothing for the date
 *  - "skipped-missing-note": the daily note doesn't exist and creation is off —
 *    no API call was made, so the caller should retry later without a cooldown
 *  - "error": configuration/auth/transient failure
 */
export type SyncOutcome = "synced" | "no-data" | "skipped-missing-note" | "error";

/** What a backfill is told besides the range: the choice for days without a note (the setting when absent), whether to fetch complete days again, and whether to go on until the data of the account starts. */
export interface BackfillRunOptions {
	force?: boolean;
	behaviour?: MissingNoteBehaviour;
	untilStart?: boolean;
	statusBar?: () => HTMLElement | null;
	onCursor?: (next: string) => Promise<void>;
}

export class SyncManager {
	private provider: HealthProvider;
	private app: App;
	private history: HistoryStore;

	/** The backfill that is running, with its notice; only one runs at a time. */
	private run: { ui: BuildProgressUi; backfill: Backfill } | null = null;

	constructor(app: App, provider: HealthProvider, history: HistoryStore) {
		this.app = app;
		this.provider = provider;
		this.history = history;
	}

	/** Whether a backfill is running. */
	get backfilling(): boolean {
		return this.run !== null;
	}

	/** Puts the progress notice of the running backfill back on screen; false when none is running. */
	revealProgress(): boolean {
		this.run?.ui.reveal();
		return this.run !== null;
	}

	/** Ends the running backfill after the day it is at. */
	stopBackfill(): void {
		this.run?.backfill.stop();
	}

	/** What writeToDailyNote needs from the settings. */
	private noteOptions(settings: HealthSyncSettings, createIfMissing: boolean) {
		return {
			dailyNotePath: settings.dailyNotePath,
			dailyNoteFormat: settings.dailyNoteFormat,
			prefix: settings.usePrefix ? "ohs_" : "",
			template: settings.dailyNoteTemplate,
			writeTrainings: settings.writeTrainings,
			writeWorkoutLocation: settings.writeWorkoutLocation,
			createIfMissing,
			language: settings.language,
		};
	}

	/** Writes a fetched day into its daily note, in the units of the notes; the note is only made when `mayCreate`. */
	private async writeDay(date: string, data: HealthData, settings: HealthSyncSettings, mayCreate: boolean): Promise<void> {
		const outputData = settings.unitSystem === "imperial" ? convertToImperial(data) : data;
		await writeToDailyNote(this.app, date, outputData, this.noteOptions(settings, mayCreate));
	}

	/** Keeps a fetched day in the history notes when the setting says so; returns whether a missing note may be created. */
	private async keepDay(date: string, data: HealthData, enabledMetrics: string[], settings: HealthSyncSettings): Promise<boolean> {
		if (settings.missingNoteBehaviour !== "history") return true;
		await this.history.put(date, recordFromData(data, enabledMetrics));
		return false;
	}

	/** Sync for a specific date.
	 * @param quiet Suppress per-date notices (used during auto-sync batch).
	 * @param options.waitForNote When true, the sync waits for an existing
	 *        (non-empty) daily note instead of creating one — set only by the
	 *        background auto-sync when "create daily note when missing" is off.
	 *        Manual sync and backfill leave it false and always create. */
	async syncDate(
		date: string,
		settings: HealthSyncSettings,
		quiet = false,
		options: { waitForNote?: boolean } = {}
	): Promise<SyncOutcome> {
		const waitForNote = options.waitForNote ?? false;

		if (!this.provider.isConfigured()) {
			new Notice(t("noticeLoginRequired", settings.language));
			return "error";
		}

		// Gate before any network call: in wait-for-note mode, skip without
		// spending an API request until a real (non-empty) daily note exists.
		// The caller retries at the next opportunity (no cooldown is set).
		if (waitForNote && !dailyNoteExists(this.app, date, {
			dailyNotePath: settings.dailyNotePath,
			dailyNoteFormat: settings.dailyNoteFormat,
		})) {
			console.debug("Garmin Health Sync: daily note missing/empty, sync skipped (waiting for note) for", date);
			if (!quiet) new Notice(t("noticeSyncWaitingForNote", settings.language).replace("{date}", date));
			return "skipped-missing-note";
		}

		if (!quiet) new Notice(t("noticeSyncing", settings.language));

		try {
			// Authenticate if needed
			if (!this.provider.isSessionValid()) {
				const authenticated = await this.provider.authenticate();
				if (!authenticated.ok) {
					if (!quiet) new Notice(t("noticeSyncError", settings.language));
					return "error";
				}
			}

			// Collect enabled metrics
			const enabledMetrics = Object.entries(settings.enabledMetrics)
				.filter(([, enabled]) => enabled)
				.map(([key]) => key);

			// Fetch data
			const data = await this.provider.fetchData(date, enabledMetrics);
			registerHabits(settings, data, date);

			const hasData = Object.keys(data.metrics).length > 0 || Object.keys(data.activities).length > 0;
			if (!hasData) {
				console.warn("Garmin Health Sync: No data returned for", date);
				if (!quiet) new Notice(t("noticeSyncNoData", settings.language));
				return "no-data";
			}

			// Convert to imperial if configured
			const outputData = settings.unitSystem === "imperial" ? convertToImperial(data) : data;

			// With "keep in history files" the day goes to the history, and a note is only updated, never created
			const mayCreate = await this.keepDay(date, data, enabledMetrics, settings);
			await writeToDailyNote(this.app, date, outputData, this.noteOptions(settings, mayCreate && !waitForNote));

			if (!quiet) new Notice(t("noticeSyncSuccess", settings.language));
			return "synced";
		} catch (error) {
			if (isLoginRequiredError(error)) {
				if (!quiet) new Notice(t("noticeLoginRequired", settings.language));
				throw error; // Caller pauses autoSync
			}
			console.error("Garmin Health Sync: Sync failed", error);
			if (!quiet) new Notice(t("noticeSyncError", settings.language));
			return "error";
		}
	}

	/**
	 * Fetches the days from `toDate` back to `fromDate` with a notice at the top that shows where it is. Only one runs
	 * at a time: a second call shows the running one. See history/backfill.ts for what a run does with each day.
	 */
	async backfill(fromDate: string, toDate: string, settings: HealthSyncSettings, options: BackfillRunOptions = {}): Promise<void> {
		if (!this.provider.isConfigured()) {
			new Notice(t("noticeLoginRequired", settings.language));
			return;
		}
		// two runs would fetch the same days twice and share one connection: the running one is shown instead
		if (this.run) {
			this.run.ui.reveal();
			new Notice(t("noticeBackfillRunning", settings.language), 8000);
			return;
		}

		const enabledMetrics = Object.entries(settings.enabledMetrics).filter(([, enabled]) => enabled).map(([key]) => key);
		const behaviour = options.behaviour ?? settings.missingNoteBehaviour;
		const ui = new BuildProgressUi(settings.language, () => this.stopBackfill(), options.statusBar?.() ?? null);
		const backfill = new Backfill({
			provider: this.provider,
			store: this.history,
			enabledMetrics,
			behaviour,
			force: options.force ?? false,
			untilStart: options.untilStart ?? false,
			hasNote: (date) => dailyNoteExists(this.app, date, { dailyNotePath: settings.dailyNotePath, dailyNoteFormat: settings.dailyNoteFormat }),
			wasFetched: (date) => isFetched(settings, date, enabledMetrics),
			markFetched: (date) => markFetched(settings, date, enabledMetrics),
			writeNote: (date, data, mayCreate) => this.writeDay(date, data, settings, mayCreate),
			onFetched: (date, data) => registerHabits(settings, data, date),
			onCursor: options.onCursor,
			onProgress: (progress) => ui.update(progress),
		});
		this.run = { ui, backfill };
		try {
			if (!this.provider.isSessionValid() && !(await this.provider.authenticate()).ok) {
				ui.finish({ status: "login-required", fetched: 0, skipped: 0, failed: 0, date: toDate, reachedStart: false });
				return;
			}
			ui.finish(await backfill.run(fromDate, toDate));
		} catch (error) {
			console.error("Garmin Health Sync: backfill failed", error);
			ui.dismiss();
			new Notice(t("noticeSyncError", settings.language));
		} finally {
			this.run = null;
		}
	}
}
