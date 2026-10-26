import type { HealthData, HealthProvider, LoginResult } from "../provider";
import type { ServerRegion } from "../../settings";
import { GarminApi, getRequiredEndpoints, calculateBatchDelay, type CredentialLoginOutcome } from "./garmin-api";
import type { OAuth1Token, OAuth2Token } from "./garmin-oauth";
import type { AuthState } from "./auth-state";
import { LoginRequiredError, isLoginRequiredError, isSyncFetchError } from "../../errors";
import {
	mapDailySummary,
	mapSleepData,
	mapHrvData,
	mapBodyBattery,
	mapSpO2,
	mapRespiration,
	mapWeight,
	mapTrainingReadiness,
	mapTrainingStatus,
	mapActivities,
} from "./garmin-mapper";

export class GarminProvider implements HealthProvider {
	readonly id = "garmin";
	readonly name = "Garmin Connect";

	private api = new GarminApi();

	setRegion(region: ServerRegion): void {
		this.api.setRegion(region);
	}

	/** Records the plugin version for self-identifying login/diagnostic logs. */
	setVersion(version: string): void {
		this.api.setVersion(version);
	}

	async clearSession(): Promise<void> {
		await this.api.clearSession();
	}

	/** Closes any open login window (F12: invoked from the plugin onunload). */
	closeActiveLogin(): void {
		this.api.closeActiveLogin();
	}

	isConfigured(): boolean {
		// BrowserWindow login requires no pre-configured credentials
		return true;
	}

	isSessionValid(): boolean {
		return this.api.isSessionValid();
	}

	/** Interactive OAuth login via BrowserWindow (ticket → OAuth1 → OAuth2). */
	async authenticate(): Promise<LoginResult> {
		const res = await this.api.loginViaOAuth();
		if (!res.ok) console.debug("Garmin Health Sync: OAuth login failed —", res.detail);
		return { ok: res.ok, cancelled: res.cancelled === true };
	}

	/** Browser-free credential login (mobile). The password is not retained. */
	loginWithCredentials(email: string, password: string): Promise<CredentialLoginOutcome> {
		return this.api.loginWithCredentials(email, password);
	}

	completeMfaLogin(code: string): Promise<CredentialLoginOutcome> {
		return this.api.completeMfaLogin(code);
	}

	/** Redacted step log of the last credential login, for bug reports. */
	getLoginDiagnostics(): string {
		return this.api.getLoginDiagnostics();
	}

	/** Redacted per-endpoint log of the last data fetch, for bug reports. */
	getSyncDiagnostics(): string {
		return this.api.getSyncDiagnostics();
	}

	/** Sign-in URL for the manual-ticket fallback (opened in an external browser). */
	getSigninUrl(): string {
		return this.api.getSigninUrl();
	}

	/** Manual-ticket login fallback (issue #6): ST- ticket or embed URL pasted by the user. */
	async authenticateWithTicket(input: string): Promise<boolean> {
		const res = await this.api.loginWithTicket(input);
		if (!res.ok) console.debug("Garmin Health Sync: manual ticket login failed —", res.detail);
		return res.ok;
	}

	/** Set persisted OAuth tokens (restore on startup). */
	setTokens(oauth1: OAuth1Token | null, oauth2: OAuth2Token | null): void {
		this.api.setTokens(oauth1, oauth2);
	}

	/** Current OAuth tokens for persistence. */
	getTokens(): { oauth1: OAuth1Token | null; oauth2: OAuth2Token | null } {
		return this.api.getTokens();
	}

	/** Auth state (Phase 7) — needsUserLogin = permanently paused. */
	getAuthState(): AuthState {
		return this.api.getAuthState();
	}

	/** Is auto-sync allowed to attempt a run right now? */
	shouldAttemptSync(): boolean {
		return this.api.shouldAttemptSync();
	}

	/** Recommended delay between dates in batch operations (ms) */
	getRecommendedBatchDelay(enabledMetrics: string[]): number {
		const endpoints = getRequiredEndpoints(enabledMetrics);
		return calculateBatchDelay(endpoints.length);
	}

	async fetchData(date: string, enabledMetrics: string[]): Promise<HealthData> {
		// OAuth: no BrowserWindow needed for data fetching. If the long-lived
		// OAuth1 token is missing, an interactive login is required. The OAuth2 refresh
		// happens silently in fetchDataForDate (Phase 7).
		if (!this.api.isSessionValid()) {
			throw new LoginRequiredError();
		}

		// The API cache only has to share one batch between the mapper calls below.
		this.api.clearCache();

		const enabled = new Set(enabledMetrics);
		// Only call required endpoints
		const requiredEndpoints = getRequiredEndpoints(enabledMetrics);
		this.api.setRequiredEndpoints(requiredEndpoints);
		console.debug("Garmin Health Sync: Endpoints:", requiredEndpoints.join(", "), `(${requiredEndpoints.length}/${enabledMetrics.length} metrics)`);
		const metrics: Record<string, number | string> = {};

		const requests: Promise<void>[] = [];
		const merge = (label: string, mapped: Record<string, number | string>, raw?: unknown): void => {
			// Garmin sometimes sends a field with a type the mapper did not expect ("BALANCED" where a number was
			// assumed). A NaN or Infinity must never be written into a note, so such values are dropped here, in
			// one place, for every mapper.
			const data: Record<string, number | string> = {};
			for (const [key, value] of Object.entries(mapped)) {
				if (typeof value === "number" ? Number.isFinite(value) : value !== "") data[key] = value;
			}
			console.debug(`Garmin Health Sync: Mapper [${label}] →`, JSON.stringify(data));
			// Diagnostic (issue #8): a non-empty response that maps to nothing means
			// the payload shape differs from what the mapper expects. Log the
			// top-level key names only (no values) so bug reports show the shape.
			if (Object.keys(data).length === 0 && raw != null && typeof raw === "object") {
				const keys = Array.isArray(raw)
					? `array[${raw.length}]` + (raw.length > 0 && raw[0] != null && typeof raw[0] === "object" ? `: ${Object.keys(raw[0] as object).join(", ")}` : "")
					: Object.keys(raw).join(", ") || "(none)";
				console.debug(`Garmin Health Sync: Mapper [${label}] got data but mapped nothing — response keys: ${keys}`);
				this.api.addSyncDiagnostic(`mapper ${label}: response keys: ${keys}`);
			}
			this.api.addSyncDiagnostic(`mapper ${label}: mapped ${Object.keys(data).length} field(s)`);
			Object.assign(metrics, data);
		};
		const warnOrRethrowAuth = (label: string, error: unknown): void => {
			if (isLoginRequiredError(error) || isSyncFetchError(error)) throw error;
			console.warn(`Garmin Health Sync: ${label} fetch failed`, error);
		};

		// One request group: fetch, map, merge. A group that fails must not drop the others, so only a login
		// or fetch error is rethrown; anything else (e.g. a mapper choking on a payload) is logged.
		const group = <T>(label: string, warnLabel: string, fetched: Promise<T>, map: (data: T) => Record<string, number | string>): void => {
			requests.push(
				fetched
					.then(data => merge(label, map(data), data))
					.catch(e => warnOrRethrowAuth(warnLabel, e))
			);
		};

		if (["steps", "resting_hr", "stress", "calories_total", "calories_active", "distance_km", "floors", "intensity_min"].some(k => enabled.has(k))) {
			group("dailySummary", "Daily summary", this.api.fetchDailySummary(date), data => mapDailySummary(data, enabled));
		}
		if (["sleep_duration", "sleep_score", "sleep_deep", "sleep_light", "sleep_rem", "sleep_awake", "sleep_start", "sleep_end"].some(k => enabled.has(k))) {
			group("sleep", "Sleep data", this.api.fetchSleepData(date), data => mapSleepData(data, enabled));
		}
		if (enabled.has("hrv")) {
			group("hrv", "HRV", this.api.fetchHrv(date), data => mapHrvData(data, enabled));
		}
		if (enabled.has("body_battery") || enabled.has("body_battery_min") || enabled.has("body_battery_max")) {
			group("bodyBattery", "Body Battery", this.api.fetchBodyBattery(date), data => mapBodyBattery(data, enabled));
		}
		if (enabled.has("spo2")) {
			group("spo2", "SpO2", this.api.fetchSpO2(date), data => mapSpO2(data, enabled));
		}
		if (enabled.has("respiration_rate")) {
			group("respiration", "Respiration", this.api.fetchRespiration(date), data => mapRespiration(data, enabled));
		}
		if (enabled.has("weight_kg") || enabled.has("body_fat_pct")) {
			group("weight", "Weight", this.api.fetchWeight(date), data => mapWeight(data, enabled));
		}
		if (enabled.has("training_readiness")) {
			group("trainingReadiness", "Training Readiness", this.api.fetchTrainingReadiness(date), data => mapTrainingReadiness(data, enabled));
		}
		if (enabled.has("training_status") || enabled.has("vo2_max")) {
			group("trainingStatus", "Training Status", this.api.fetchTrainingStatus(date), data => mapTrainingStatus(data, enabled));
		}

		// Activities
		let activities: Record<string, string> = {};
		let trainings: import("../provider").TrainingEntry[] = [];
		let startLocation: { lat: number; lon: number } | undefined;
		requests.push(
			this.api.fetchActivities(date)
				.then(data => {
					const result = mapActivities(data);
					activities = result.display;
					trainings = result.trainings;
					if (result.startLocation) startLocation = result.startLocation;
				})
				.catch(e => warnOrRethrowAuth("Activities", e))
		);

		await Promise.all(requests);

		// Nothing mapped: on mobile, record how request details change Garmin's answer (diagnostics only).
		if (Object.keys(metrics).length === 0 && Object.keys(activities).length === 0) {
			await this.api.probeRequestVariants(date);
		}

		return { metrics, activities, trainings, startLocation };
	}
}
