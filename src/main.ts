import { App, Modal, Notice, Platform, Plugin, Setting, TAbstractFile, TFile } from "obsidian";
import { DEFAULT_SETTINGS, HealthSyncSettings, HealthSyncSettingTab } from "./settings";
import { ManualLoginModal } from "./ui/manual-login-modal";
import { CredentialLoginModal } from "./ui/credential-login-modal";
import { LoginCooldown } from "./login-cooldown";
import { SyncManager } from "./sync";
import { HistoryStore } from "./history/store";
import { importFromNotes } from "./history/import";
import { HistoryBuilder } from "./history/builder";
import { BuildProgressUi } from "./history/progress";
import { BuildHistoryModal } from "./ui/build-history-modal";
import { dateFromDailyNote, matchDailyNoteDate } from "./daily-note";
import { localDateString, shiftDate } from "./dates";
import { GarminProvider } from "./providers/garmin/garmin-provider";
import type { OAuth1Token, OAuth2Token } from "./providers/garmin/garmin-oauth";
import { t } from "./i18n/t";
import { readStoredTokens, writeStoredTokens } from "./token-store";
import { isLoginRequiredError } from "./errors";
import { parseBirthYear } from "./panel/zones";
import { HealthPanelView, VIEW_TYPE_HEALTH_PANEL } from "./panel/view";
import { PropertiesFolder } from "./fold-properties";
import { showWhatsNewIfDue, showWhatsNewNotes } from "./whats-new";

const AUTO_SYNC_TRIGGER_DEBOUNCE_MS = 30 * 1000;
const RESYNC_WINDOW_MS = 72 * 60 * 60 * 1000; // 72h — more recent data may be overwritten
const COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h cooldown between re-syncs per date
const FIRST_RESYNC_AFTER_MS = 30 * 60 * 1000; // 30min — first re-sync happens sooner
const NO_DATA_COOLDOWN_MS = 1 * 60 * 60 * 1000; // 1h cooldown for dates that returned no data
const CLEANUP_AGE_MS = 8 * 24 * 60 * 60 * 1000;
const LOGIN_NOTICE_THROTTLE_MS = 10 * 60 * 1000; // 10min: re-show login notice no more often than this

export default class HealthSyncPlugin extends Plugin {
	settings: HealthSyncSettings;
	private syncManager: SyncManager;
	/** The history notes (writes only; the panel reads through its own store). */
	private history: HistoryStore;
	private garminProvider: GarminProvider;
	private autoSyncRunning = false;
	private autoSyncResyncQueued = false;
	private backfillRunning = false;
	/** The running history build, if any. */
	private historyBuilder: HistoryBuilder | null = null;
	private lastAutoSyncAttempt = 0;
	private loginRequiredNotice: Notice | null = null;
	private lastLoginNoticeAt = 0;
	private credentialModalOpen = false;
	/** No data.json existed when the plugin loaded: a new install, which gets no release notes. */
	private freshInstall = false;

	async onload() {
		// On iOS Obsidian's own "failed to load" message says nothing and there is no console, so show the real
		// error in a notice that stays, then let the failure through as before.
		try {
			await this.onloadInner();
		} catch (error) {
			console.error("Garmin Health Sync: onload failed", error);
			const lang = (this.settings as HealthSyncSettings | undefined)?.language ?? "en";
			const reason = error instanceof Error ? error.message : String(error);
			new Notice(t("noticeLoadFailed", lang).replace("{error}", reason), 0);
			throw error;
		}
	}

	private async onloadInner(): Promise<void> {
		await this.loadSettings();
		this.autoDetectDailyNotePath();

		this.garminProvider = new GarminProvider();
		this.garminProvider.setVersion(this.manifest.version);
		this.applyServerRegion();

		// Restore persisted OAuth tokens; migrate legacy cookie users (M6)
		await this.restoreTokens();
		await this.migrateLegacySession();

		this.history = new HistoryStore(this.app, this.settings);
		this.syncManager = new SyncManager(this.app, this.garminProvider, this.history);

		// Command: Sync Health Data
		this.addCommand({
			id: "sync-health-data",
			name: t("commandSync", this.settings.language),
			callback: () => this.manualSync(),
		});

		// Command: Backfill Health Data
		this.addCommand({
			id: "backfill-health-data",
			name: t("commandBackfill", this.settings.language),
			callback: () => {
				new BackfillModal(this.app, this.settings.language, (from, to) => {
					this.background((async () => {
						// Suppress the create-trigger while backfill runs: backfill
						// creates notes itself, and we don't want those create events
						// to kick off a parallel auto-sync of the same fresh dates.
						this.backfillRunning = true;
						try {
							// SyncManager.backfill handles its own errors (it shows the sign-in notice itself),
							// so nothing is thrown out of it; the finally persists whatever happened.
							await this.syncManager.backfill(from, to, this.settings);
						} finally {
							this.backfillRunning = false;
							// Tokens may have been refreshed/invalidated during the backfill → persist.
							this.saveTokens();
							await this.saveSettings();
						}
					})(), "backfill");
				}).open();
			},
		});

		// Command: fetch the days back to the start of the Garmin account into the history notes
		this.addCommand({
			id: "build-history",
			name: t("commandBuildHistory", this.settings.language),
			callback: () => this.openBuildHistory(),
		});

		// Command: copy the Garmin values of the daily notes into the history notes (no Garmin requests)
		this.addCommand({
			id: "import-history-from-notes",
			name: t("commandImportHistory", this.settings.language),
			callback: () => this.background(this.importHistory(), "import history"),
		});

		// Command: Manual-ticket login fallback (issue #6)
		this.addCommand({
			id: "login-with-ticket",
			name: t("commandManualLogin", this.settings.language),
			callback: () => this.openManualLogin(),
		});

		// Command: Show what's new
		this.addCommand({
			id: "show-whats-new",
			name: t("commandWhatsNew", this.settings.language),
			callback: () => showWhatsNewNotes(this.app, this.settings.language, this.manifest.version),
		});

		// Side panel: the view is always registered so Obsidian can restore it with the workspace.
		this.registerView(VIEW_TYPE_HEALTH_PANEL, (leaf) => new HealthPanelView(leaf, this));
		this.addRibbonIcon("activity", t("commandOpenPanel", this.settings.language), () => this.background(this.openPanel(), "open panel"));
		this.addCommand({
			id: "open-health-panel",
			name: t("commandOpenPanel", this.settings.language),
			callback: () => this.background(this.openPanel(), "open panel"),
		});

		// Settings Tab
		this.addSettingTab(new HealthSyncSettingTab(this.app, this));

		// On startup: auto-sync only — BrowserWindow opens on demand
		this.app.workspace.onLayoutReady(() => {
			this.background(this.tryAutoSync(), "auto-sync");
			this.background(
				Promise.resolve().then(() => showWhatsNewIfDue(this.app, this.settings.language, this.manifest.version, this.freshInstall, performance.now())),
				"what's new",
			);

			// When "create daily note when missing" is off, the auto-sync waits for
			// the note. Resume it the moment a real daily note within the sync window
			// shows up. "create" alone is not enough: Templater, the Calendar plugin
			// and vault sync engines all create the file empty first and fill it in a
			// separate step, which only surfaces as "modify" — and an empty note is
			// deliberately not accepted as existing. Registered here, not in onload,
			// so create doesn't fire for every existing file during the initial vault
			// load.
			this.registerEvent(this.app.vault.on("create", file => this.onDailyNoteMaybeReady(file)));
			this.registerEvent(this.app.vault.on("modify", file => this.onDailyNoteMaybeReady(file)));
		});

		// Daily notes open with their properties folded (setting "Fold properties by default")
		const folder = new PropertiesFolder(this.app, (file) => this.settings.foldProperties && dateFromDailyNote(file, this.settings) !== null);
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(this.app.workspace.on("file-open", (file) => folder.fileOpened(file)));
			this.registerEvent(this.app.workspace.on("layout-change", () => folder.layoutChanged()));
			folder.layoutChanged();
		});
		this.register(() => folder.cancel());

		// Auto-sync when opening today's/yesterday's daily note
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (file instanceof TFile && this.isDailyNote(file, [this.todayString(), this.yesterdayString()])) {
					this.background(this.tryAutoSync(), "auto-sync");
				}
			})
		);
	}

	private enabledMetricKeys(): string[] {
		return Object.entries(this.settings.enabledMetrics).filter(([, enabled]) => enabled).map(([key]) => key);
	}

	/** Asks how far back to go, then builds the history in the background with a progress notice. */
	private openBuildHistory(): void {
		const lang = this.settings.language;
		if (this.historyBuilder) return; // one build at a time; its notice is on screen
		if (!this.garminProvider.isConfigured()) {
			new Notice(t("noticeLoginRequired", lang));
			return;
		}
		const enabled = this.enabledMetricKeys();
		const delay = this.garminProvider.getRecommendedBatchDelay(enabled);
		const newest = shiftDate(localDateString(new Date()), -1);
		new BuildHistoryModal(this.app, lang, newest, delay, enabled.length, (from) => this.background(this.buildHistory(from, newest, enabled), "build history")).open();
	}

	private async buildHistory(from: string, newest: string, enabled: string[]): Promise<void> {
		const lang = this.settings.language;
		const ui = new BuildProgressUi(lang, () => this.historyBuilder?.stop(), Platform.isDesktop ? this.addStatusBarItem() : null);
		this.historyBuilder = new HistoryBuilder({
			provider: this.garminProvider,
			store: this.history,
			enabledMetrics: enabled,
			writeNote: (date, data) => this.syncManager.updateExistingNote(date, data, this.settings),
			onProgress: (progress) => ui.update(progress),
		});
		try {
			if (!this.garminProvider.isSessionValid() && !(await this.garminProvider.authenticate()).ok) {
				ui.finish({ status: "login-required", fetched: 0, skipped: 0, failed: 0, date: newest, reachedStart: false });
				return;
			}
			ui.finish(await this.historyBuilder.run(from, newest));
		} catch (error) {
			console.error("Garmin Health Sync: history build failed", error);
			ui.dismiss();
			new Notice(t("noticeSyncError", lang));
		} finally {
			this.historyBuilder = null;
			// Tokens may have been refreshed or invalidated during the build: persist them.
			this.saveTokens();
			await this.saveSettings();
		}
	}

	private async importHistory(): Promise<void> {
		const lang = this.settings.language;
		const count = await importFromNotes(this.app, this.history, this.settings);
		new Notice(t(count === 0 ? "noticeHistoryImportEmpty" : "noticeHistoryImported", lang).replace("{count}", String(count)));
	}

	/** Reveals the health panel in the right sidebar, creating it on first use. */
	async openPanel(): Promise<void> {
		const lang = this.settings.language;
		if (!this.settings.panelEnabled) {
			new Notice(t("noticePanelDisabled", lang));
			return;
		}
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_HEALTH_PANEL)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: VIEW_TYPE_HEALTH_PANEL, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	/** The panel switch changed: off closes the panel; on shows it once, except on a phone where it would cover the note. */
	async applyPanelEnabled(): Promise<void> {
		if (!this.settings.panelEnabled) {
			this.app.workspace.detachLeavesOfType(VIEW_TYPE_HEALTH_PANEL);
		} else if (!Platform.isPhone) {
			await this.openPanel();
		}
	}

	/** Re-render open panels (language change). */
	refreshPanels(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HEALTH_PANEL)) {
			if (leaf.view instanceof HealthPanelView) leaf.view.refresh();
		}
	}

	/** F12: on disable/reload, close any still-open Garmin login window instead of
	 *  leaving it visibly open until the 120s timeout. */
	onunload(): void {
		this.garminProvider?.closeActiveLogin();
	}

	/** Auto-sync — checks the last 7 days, syncs missing or outdated data.
	 * @param options.force Bypass the 30s trigger-debounce. Used by the
	 *        create-note trigger so a freshly created note is picked up at once. */
	private async tryAutoSync(options: { force?: boolean } = {}): Promise<void> {
		if (!this.settings.autoSync) return;
		// A history build uses the Garmin connection at its own pace; the next trigger picks the recent days up.
		if (this.historyBuilder) return;
		if (this.autoSyncRunning) {
			// A pass is already in flight. If this is a forced resume (a note just
			// appeared), queue exactly one more pass to run when it finishes — the
			// running pass may already have skipped that date before it existed.
			if (options.force) this.autoSyncResyncQueued = true;
			return;
		}
		// Phase 7: The state machine decides. needsUserLogin pauses permanently,
		// temporarilyUnavailable only until the backoff expires. No cookie probe
		// anymore — the OAuth2 refresh happens silently in fetchDataForDate.
		if (!this.garminProvider.shouldAttemptSync()) return;

		const now = Date.now();
		if (!options.force && now - this.lastAutoSyncAttempt < AUTO_SYNC_TRIGGER_DEBOUNCE_MS) return;
		this.lastAutoSyncAttempt = now;

		const datesToSync = this.getAutoSyncDates();
		if (datesToSync.length === 0) {
			console.debug("Garmin Health Sync: Auto-sync — nothing to sync (all within cooldown or already synced)");
			return;
		}

		if (!this.garminProvider.isSessionValid()) {
			this.showGarminLoginRequiredNotice("no OAuth token");
			return;
		}

		this.autoSyncRunning = true;
		try {
			await this.runAutoSync(datesToSync);
		} finally {
			this.autoSyncRunning = false;
			// A note created mid-run queued a follow-up — run it now (forced, so the
			// debounce timestamp this pass just set can't swallow it).
			if (this.autoSyncResyncQueued) {
				this.autoSyncResyncQueued = false;
				this.background(this.tryAutoSync({ force: true }), "queued auto-sync");
			}
		}
	}

	private getAutoSyncDates(now = Date.now()): string[] {
		const syncTimes = this.settings.lastSyncTimes;
		const datesToSync: string[] = [];

		for (let i = 1; i <= 7; i++) {
			const d = new Date();
			d.setDate(d.getDate() - i);
			const dateStr = this.dateString(d);

			// Date age: midnight of next day = "data complete"
			const dateEnd = new Date(dateStr + "T00:00:00");
			dateEnd.setDate(dateEnd.getDate() + 1);
			const ageMs = now - dateEnd.getTime();

			const lastSync = syncTimes[dateStr];

			if (ageMs > RESYNC_WINDOW_MS) {
				// Older than 72h: only sync if never synced before
				if (!lastSync) datesToSync.push(dateStr);
			} else {
				// Within 72h: re-sync allowed but with 6h cooldown
				if (!lastSync || (now - lastSync) >= COOLDOWN_MS) {
					datesToSync.push(dateStr);
				}
			}
		}

		return datesToSync;
	}

	/** The auto-sync window as date strings: the last 7 full days (yesterday back
	 *  to 7 days ago). Used by the create-note trigger to match a new file. */
	private autoSyncWindowDates(): string[] {
		const dates: string[] = [];
		for (let i = 1; i <= 7; i++) {
			const d = new Date();
			d.setDate(d.getDate() - i);
			dates.push(this.dateString(d));
		}
		return dates;
	}

	/**
	 * Vault create/modify handler for the wait-for-note mode: resumes the auto-sync
	 * as soon as a daily note within the sync window has actual content.
	 *
	 * Self-limiting on purpose. Every branch that ends a sync attempt for a date
	 * writes `lastSyncTimes[date]` (success, no-data and transient error alike), and
	 * only "skipped-missing-note" leaves it unset. So an existing entry means the
	 * date is no longer waiting, and further edits to that note must not each kick
	 * off another pass — which is what makes it safe to hang this off "modify".
	 */
	private onDailyNoteMaybeReady(file: TAbstractFile): void {
		if (!this.settings.autoSync || this.settings.missingNoteBehaviour !== "skip") return;
		// Don't react to notes that backfill is writing right now.
		if (this.backfillRunning) return;
		if (!(file instanceof TFile)) return;

		// Same formatDate()-based matcher the existence gate uses, so the trigger and
		// the gate agree (handles subfolders/moment tokens, ignores 0-byte stubs).
		const noteDate = matchDailyNoteDate(file, this.autoSyncWindowDates(), {
			dailyNotePath: this.settings.dailyNotePath,
			dailyNoteFormat: this.settings.dailyNoteFormat,
		});
		if (!noteDate) return;
		if (this.settings.lastSyncTimes[noteDate]) return;

		// Force past the 30s trigger-debounce: the startup sync may have just set the
		// timestamp, and a note that only now became syncable must not be swallowed.
		this.background(this.tryAutoSync({ force: true }), "auto-sync after a new note");
	}

	private async runAutoSync(datesToSync: string[]): Promise<void> {
		const now = Date.now();

		console.debug("Garmin Health Sync: Auto-sync — syncing:", datesToSync.join(", "));

		const enabledMetrics = Object.entries(this.settings.enabledMetrics)
			.filter(([, enabled]) => enabled)
			.map(([key]) => key);

		try {
			const batchDelay = this.garminProvider.getRecommendedBatchDelay?.(enabledMetrics) ?? 2000;
			let synced = 0;

			for (let i = 0; i < datesToSync.length; i++) {
				const date = datesToSync[i]!;
				// Wait-for-note applies to the background auto-sync only. Manual sync
				// and backfill never pass this and always create the note.
				const outcome = await this.syncManager.syncDate(date, this.settings, true, {
					waitForNote: this.settings.missingNoteBehaviour === "skip",
				});

				if (outcome === "skipped-missing-note") {
					// Daily note doesn't exist yet and creation is disabled. No API
					// call was made, so deliberately set no cooldown (the date re-syncs
					// the moment the note appears) and skip the rate-limit delay.
					continue;
				}

				if (outcome === "synced") {
					synced++;
					const isFirstSync = !this.settings.lastSyncTimes[date];
					if (isFirstSync) {
						// First sync: set timestamp so next re-sync fires after FIRST_RESYNC_AFTER_MS (30min)
						this.settings.lastSyncTimes[date] = Date.now() - (COOLDOWN_MS - FIRST_RESYNC_AFTER_MS);
					} else {
						// Subsequent syncs: full 6h cooldown
						this.settings.lastSyncTimes[date] = Date.now();
					}
				} else {
					// "no-data" or transient "error": still set a cooldown so we don't
					// hammer the API on every page switch.
					this.settings.lastSyncTimes[date] = Date.now() - (COOLDOWN_MS - NO_DATA_COOLDOWN_MS);
				}

				// Rate-limit delay between dates (not after the last one)
				if (i < datesToSync.length - 1) {
					await this.sleep(batchDelay);
				}
			}

			// Clean up old entries (older than 8 days)
			for (const [dateKey, timestamp] of Object.entries(this.settings.lastSyncTimes)) {
				if (now - timestamp > CLEANUP_AGE_MS) {
					delete this.settings.lastSyncTimes[dateKey];
				}
			}

			this.saveTokens();
			await this.saveSettings();

			if (synced > 0) {
				new Notice(t("noticeAutoSyncDone", this.settings.language).replace("{count}", String(synced)));
				console.debug(`Garmin Health Sync: Auto-sync done — ${synced}/${datesToSync.length} days synced`);
			}
		} catch (error) {
			// Token may have been refreshed/invalidated → persist. The permanent vs. transient
			// state is tracked by the state machine (provider.getAuthState()).
			this.saveTokens();
			await this.saveSettings();
			if (isLoginRequiredError(error) || this.garminProvider.getAuthState() === "needsUserLogin") {
				this.showGarminLoginRequiredNotice("sync hit login_required");
			} else {
				// Transient error: temporarilyUnavailable + backoff, do NOT pause permanently.
				console.debug("Garmin Health Sync: Auto-sync transient failure — will retry with backoff", error);
			}
		}
	}

	/** Manual sync — context-dependent based on the open daily note */
	private async manualSync(): Promise<void> {
		if (!this.garminProvider.isSessionValid()) {
			new Notice(t("noticeLoginRequired", this.settings.language));
			return;
		}

		const syncDate = this.detectSyncDate();
		try {
			const outcome = await this.syncManager.syncDate(syncDate, this.settings);
			if (outcome === "synced") {
				this.settings.lastSyncTimes[syncDate] = Date.now();
			}
			this.saveTokens();
			await this.saveSettings();
		} catch (error) {
			this.saveTokens();
			await this.saveSettings();
			if (isLoginRequiredError(error) || this.garminProvider.getAuthState() === "needsUserLogin") {
				this.showGarminLoginRequiredNotice("manual sync login_required");
			}
		}
	}

	/** Determines the sync date based on the currently open file */
	private detectSyncDate(): string {
		const yesterday = this.yesterdayString();
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return yesterday;

		const noteDate = dateFromDailyNote(activeFile, this.settings);
		if (!noteDate) return yesterday;

		return noteDate;
	}

	/** Interactive OAuth login from settings (opens the Garmin login window). */
	loginViaBrowser(onSuccess?: () => void): Promise<void> {
		// Primary sign-in on every platform: email + password (+ MFA code) without a browser.
		this.openCredentialLogin(onSuccess);
		return Promise.resolve();
	}

	/** Browser-free sign-in (email + password, optional MFA code). Used on mobile. */
	openCredentialLogin(onSuccess?: () => void): void {
		if (this.credentialModalOpen) return;
		this.credentialModalOpen = true;
		const cooldown = new LoginCooldown(this.app);
		let previousAttemptAgo: number | null = null;
		new CredentialLoginModal(this.app, this.settings.language, {
			cooldown,
			onClosed: () => { this.credentialModalOpen = false; },
			login: (email, password) => {
				previousAttemptAgo = cooldown.noteAttempt();
				return this.garminProvider.loginWithCredentials(email, password);
			},
			verifyMfa: (code) => this.garminProvider.completeMfaLogin(code),
			onSuccess: async () => {
				await this.handleLoginResult(true, "noticeLoginFailed");
				onSuccess?.();
			},
			// Backup on every platform: sign in on Garmin's page in the browser, paste the ticket back.
			onBrowserFallback: () => this.openManualLogin(onSuccess),
			// Attempt timing helps work out how long Garmin's limit really lasts.
			getDiagnostics: () => `${this.garminProvider.getLoginDiagnostics()}\nprevious attempt: ${previousAttemptAgo === null ? "none" : `${previousAttemptAgo}s ago`}, blocks in a row: ${cooldown.strikes()}`,
		}).open();
	}

	/** Manual-ticket login fallback (issue #6): opens the modal where the user
	 *  completes the sign-in in an external browser and pastes the ST- ticket. */
	openManualLogin(onSuccess?: () => void): void {
		new ManualLoginModal(
			this.app,
			this.settings.language,
			this.garminProvider.getSigninUrl(),
			async (input) => {
				const ok = await this.loginWithTicket(input);
				if (ok) onSuccess?.();
				return ok;
			},
		).open();
	}

	private async loginWithTicket(input: string): Promise<boolean> {
		try {
			const success = await this.garminProvider.authenticateWithTicket(input);
			await this.handleLoginResult(success, "noticeManualLoginFailed");
			return success;
		} catch (error) {
			console.error("Garmin Health Sync: manual ticket login failed", error);
			new Notice(t("noticeManualLoginFailed", this.settings.language));
			return false;
		}
	}

	/** Shared post-login handling: persist tokens, notify, kick off a sync. */
	private async handleLoginResult(success: boolean, failureKey: "noticeLoginFailed" | "noticeManualLoginFailed"): Promise<void> {
		const lang = this.settings.language;
		if (success) {
			this.saveTokens();
			await this.saveSettings();
			new Notice(t("noticeLoginSuccess", lang));
			// Fresh login → state machine is ready; trigger a sync immediately.
			this.lastAutoSyncAttempt = 0;
			this.lastLoginNoticeAt = 0; // reset throttle: report future errors immediately
			this.background(this.tryAutoSync(), "auto-sync after sign-in");
		} else {
			new Notice(t(failureKey, lang));
		}
	}

	/** Logout — clear OAuth tokens and persisted state */
	async logout(): Promise<void> {
		await this.garminProvider.clearSession();
		this.settings.garminSession = "";
		this.settings.garminOAuth1 = "";
		this.settings.garminOAuth2 = "";
		if (!writeStoredTokens(this.app, null, null)) {
			console.warn("Garmin Health Sync: could not clear the stored Garmin tokens");
		}
		await this.saveSettings();
	}

	/** Checks whether a valid session exists */
	isSessionValid(): boolean {
		return this.garminProvider.isSessionValid();
	}

	/** Redacted log of the last data fetch (settings → copy diagnostics). */
	getSyncDiagnostics(): string {
		return this.garminProvider.getSyncDiagnostics() || "no sync run since the plugin started";
	}

	/** Apply the configured server region to the API layer */
	applyServerRegion(): void {
		this.garminProvider.setRegion(this.settings.serverRegion);
	}

	/** Detect path and format from Periodic Notes / Daily Notes if not manually configured */
	private autoDetectDailyNotePath(): void {
		if (this.settings.dailyNotePath) return;

		// Periodic Notes Plugin
		const periodicNotes = (this.app as unknown as { plugins: { plugins: Record<string, { settings?: { daily?: { folder?: string; format?: string } } }> } })
			?.plugins?.plugins?.["periodic-notes"];
		if (periodicNotes?.settings?.daily?.folder) {
			this.settings.dailyNotePath = periodicNotes.settings.daily.folder;
			if (periodicNotes.settings.daily.format) {
				this.settings.dailyNoteFormat = periodicNotes.settings.daily.format;
			}
			console.debug("Garmin Health Sync: Auto-detected daily note path from Periodic Notes:", this.settings.dailyNotePath);
			return;
		}

		// Daily Notes Core Plugin
		const dailyNotes = (this.app as unknown as { internalPlugins: { plugins: Record<string, { instance?: { options?: { folder?: string; format?: string } } }> } })
			?.internalPlugins?.plugins?.["daily-notes"];
		if (dailyNotes?.instance?.options?.folder) {
			this.settings.dailyNotePath = dailyNotes.instance.options.folder;
			if (dailyNotes.instance.options.format) {
				this.settings.dailyNoteFormat = dailyNotes.instance.options.format;
			}
			console.debug("Garmin Health Sync: Auto-detected daily note path from Daily Notes:", this.settings.dailyNotePath);
			return;
		}
	}

	async loadSettings() {
		const saved = await this.loadData() as Partial<HealthSyncSettings> | null;
		this.freshInstall = !saved || Object.keys(saved).length === 0;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		// Object.assign is shallow: without these copies the two nested objects below would be the very objects in
		// DEFAULT_SETTINGS, and every toggle or sync time written later would change the defaults too. (Not
		// structuredClone: older iOS WebViews lack it and esbuild does not polyfill it.)
		const defaults = DEFAULT_SETTINGS.enabledMetrics;
		this.settings.enabledMetrics = { ...(saved?.enabledMetrics ?? defaults) };
		this.settings.lastSyncTimes = { ...(saved?.lastSyncTimes ?? {}) };
		this.settings.fetchLog = { ...(saved?.fetchLog ?? {}) };
		this.settings.fetchSets = (saved?.fetchSets ?? []).map((set) => [...set]);
		this.settings.panelCards = { ...(saved?.panelCards ?? {}) };
		this.settings.birthYear = parseBirthYear(saved?.birthYear, new Date().getFullYear());
		// "Create daily note when missing" became a three-way choice: off meant waiting for the note, which is "skip".
		const legacy = (saved ?? {}) as { createDailyNoteIfMissing?: boolean; missingNoteBehaviour?: string };
		if (!["create", "history", "skip"].includes(legacy.missingNoteBehaviour ?? "")) this.settings.missingNoteBehaviour = legacy.createDailyNoteIfMissing === false ? "skip" : "create";
		delete (this.settings as unknown as { createDailyNoteIfMissing?: boolean }).createDailyNoteIfMissing;
		for (const key of Object.keys(defaults)) {
			if (this.settings.enabledMetrics[key] === undefined) {
				this.settings.enabledMetrics[key] = defaults[key]!;
			}
		}

		// Detect language from Obsidian on first launch
		if (!saved?.language) {
			const obsidianLang = activeDocument.documentElement.lang.slice(0, 2);
			const supported = ["en", "de", "zh", "ja", "es", "fr"];
			this.settings.language = supported.includes(obsidianLang) ? obsidianLang : "en";
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** Restore persisted OAuth tokens into the provider on startup. Tokens live in Obsidian's
	 *  secret storage; tokens left in data.json by earlier versions are moved there once. */
	private async restoreTokens(): Promise<void> {
		const parse = <T>(raw: string): T | null => {
			if (!raw) return null;
			try { return JSON.parse(raw) as T; } catch { return null; }
		};
		const stored = readStoredTokens(this.app);
		const legacy1 = parse<OAuth1Token>(this.settings.garminOAuth1);
		const legacy2 = parse<OAuth2Token>(this.settings.garminOAuth2);
		const oauth1 = stored.oauth1 ?? legacy1;
		const oauth2 = stored.oauth2 ?? legacy2;
		if (oauth1) this.garminProvider.setTokens(oauth1, oauth2);

		// One-time move out of data.json: clear the plaintext copy only after the secret
		// store returned exactly what was written, so a failure never logs the user out.
		if (this.settings.garminOAuth1 || this.settings.garminOAuth2) {
			if (oauth1 && !writeStoredTokens(this.app, oauth1, oauth2)) return;
			this.settings.garminOAuth1 = "";
			this.settings.garminOAuth2 = "";
			await this.saveSettingsQuietly();
		}
	}

	/** Persist the provider's current OAuth tokens (they may have been refreshed). Falls back
	 *  to data.json only where secret storage is unavailable. */
	private saveTokens(): void {
		const { oauth1, oauth2 } = this.garminProvider.getTokens();
		if (writeStoredTokens(this.app, oauth1, oauth2)) {
			this.settings.garminOAuth1 = "";
			this.settings.garminOAuth2 = "";
			return;
		}
		this.settings.garminOAuth1 = oauth1 ? JSON.stringify(oauth1) : "";
		this.settings.garminOAuth2 = oauth2 ? JSON.stringify(oauth2) : "";
	}

	/** M6: Prompt existing users with a legacy cookie session (but no OAuth1) to
	 *  log in again once, and clear the legacy field so the notice does not
	 *  reappear. The re-login then goes through the new OAuth flow. */
	private async migrateLegacySession(): Promise<void> {
		if (this.settings.garminSession && !this.garminProvider.isSessionValid()) {
			new Notice(t("noticeMigrationReloginRequired", this.settings.language), 0);
			this.settings.garminSession = "";
			// F10: await so the disk write completes — otherwise the migration notice
			// reappears on every start if a crash happens before the write.
			await this.saveSettingsQuietly();
		}
	}

	private showGarminLoginRequiredNotice(reason: string): void {
		console.debug(`Garmin Health Sync: Login required — ${reason}`);
		// F3 + Review-A: time-based throttle instead of a binary guard. Prevents a new
		// notice on every daily-note open, but shows one again after the window elapses —
		// even if the user closed the last one manually (X). A binary
		// `if (loginRequiredNotice) return` would otherwise stay active forever
		// (notice closed via X → reference stays non-null → auto-sync silently paused).
		const now = Date.now();
		if (now - this.lastLoginNoticeAt < LOGIN_NOTICE_THROTTLE_MS) return;
		this.lastLoginNoticeAt = now;

		if (this.loginRequiredNotice) {
			this.loginRequiredNotice.hide();
			this.loginRequiredNotice = null;
		}

		const fragment = createFragment();
		const wrapper = fragment.createDiv();
		wrapper.createDiv({ text: t("noticeSessionExpired", this.settings.language) });
		const button = wrapper.createEl("button", {
			text: t("noticeLoginAction", this.settings.language),
		});
		const notice = new Notice(fragment, 0);
		this.loginRequiredNotice = notice;
		button.addEventListener("click", () => {
			this.background(this.loginFromNotice(notice, button), "sign-in from the notice");
		});
	}

	private async loginFromNotice(notice: Notice, button: HTMLButtonElement): Promise<void> {
		button.disabled = true;
		button.textContent = t("noticeLoginInProgress", this.settings.language);
		await this.loginViaBrowser(() => {
			// Mobile: the credential modal resolves after this handler returns.
			notice.hide();
			if (this.loginRequiredNotice === notice) this.loginRequiredNotice = null;
		});

		if (this.garminProvider.isSessionValid() && this.garminProvider.getAuthState() !== "needsUserLogin") {
			// Review-C: loginViaBrowser() already triggered an auto-sync on success —
			// just close the notice here, no second tryAutoSync.
			notice.hide();
			if (this.loginRequiredNotice === notice) this.loginRequiredNotice = null;
			return;
		}

		button.disabled = false;
		button.textContent = t("noticeLoginAction", this.settings.language);
	}

	private todayString(): string {
		return this.dateString(new Date());
	}

	private yesterdayString(): string {
		const d = new Date();
		d.setDate(d.getDate() - 1);
		return this.dateString(d);
	}

	private dateString(d: Date): string {
		return localDateString(d);
	}

	private isDailyNote(file: TFile, dates: string[]): boolean {
		for (const date of dates) {
			if (this.matchesDailyNote(file, date)) return true;
		}
		return false;
	}

	private matchesDailyNote(file: TFile, date: string): boolean {
		return dateFromDailyNote(file, this.settings) === date;
	}

	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => window.setTimeout(resolve, ms));
	}

	/** Runs work nobody awaits. A rejection it raises is logged here instead of surfacing as an unhandled rejection,
	 *  which a mobile WebView can report as a failed plugin load. */
	private background(work: Promise<unknown>, what: string): void {
		work.catch((error: unknown) => {
			console.error(`Garmin Health Sync: ${what} failed`, error);
		});
	}

	/** Saves the settings where a failure must not stop the caller (startup, background work). */
	private async saveSettingsQuietly(): Promise<void> {
		try {
			await this.saveSettings();
		} catch (error) {
			console.error("Garmin Health Sync: could not save the settings", error);
		}
	}
}

/** Modal for backfill date range */
class BackfillModal extends Modal {
	private onSubmit: (from: string, to: string) => void;
	private lang: string;

	constructor(app: App, lang: string, onSubmit: (from: string, to: string) => void) {
		super(app);
		this.lang = lang;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: t("modalBackfillTitle", this.lang) });

		const today = localDateString(new Date());
		const weekAgoDate = new Date();
		weekAgoDate.setDate(weekAgoDate.getDate() - 7);
		const weekAgo = localDateString(weekAgoDate);

		let fromDate = weekAgo;
		let toDate = today;

		new Setting(contentEl)
			.setName(t("modalBackfillFrom", this.lang))
			.addText(text => {
				text.inputEl.type = "date";
				text.setValue(weekAgo)
					.onChange(value => { fromDate = value; });
			});

		new Setting(contentEl)
			.setName(t("modalBackfillTo", this.lang))
			.addText(text => {
				text.inputEl.type = "date";
				text.setValue(today)
					.onChange(value => { toDate = value; });
			});

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText(t("modalBackfillStart", this.lang))
				.setCta()
				.onClick(() => {
					this.onSubmit(fromDate, toDate);
					this.close();
				}));
	}

	onClose() {
		this.contentEl.empty();
	}
}
