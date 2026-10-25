// Why it matters: this is the data path. It decides when to refresh the token, which endpoints cost a
// request (Garmin allows ~50 a minute), how a failure is classified (logout vs retry vs "no data"), and
// what the copyable diagnostics reveal. A wrong branch is a wrong logout or a silently empty day.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Platform, network as net, type MockReply, type RequestUrlParam } from "../testUtils/mocks/obsidian";
import { GarminApi, calculateBatchDelay, getRequiredEndpoints } from "../src/providers/garmin/garmin-api";
import type { OAuth1Token, OAuth2Token } from "../src/providers/garmin/garmin-oauth";
import { LoginRequiredError, SyncFetchError } from "../src/errors";

const DATE = "2026-10-24";
const NOW = 1_700_000_000_000;
const NOW_S = NOW / 1000;
const BASE = "https://connectapi.garmin.com";
const OAUTH1: OAuth1Token = { oauth_token: "OT-secret", oauth_token_secret: "OS-secret" };
const fresh = (token = "at-1"): OAuth2Token => ({ access_token: token, refresh_token: "rt", expires_in: 3600, expires_at: NOW_S + 3600 });
const EX = /oauth\/exchange\/user\/2\.0/;
const PROFILE = `${BASE}/userprofile-service/socialProfile`;
const PRIVATE = "Max-Mustermann-private-name";

type Reply = MockReply | ((req: RequestUrlParam) => MockReply | Promise<MockReply>);
/** Route every data endpoint; `replies` overrides by endpoint key. */
function routeData(replies: Record<string, Reply> = {}): void {
	const table: [string, RegExp][] = [
		["profile", /userprofile-service\/socialProfile/],
		["dailySummary", /usersummary-service\/usersummary\/daily\//],
		["sleep", /wellness-service\/wellness\/dailySleepData\//],
		["hrv", /hrv-service\/hrv\//],
		["bodyBattery", /wellness-service\/wellness\/bodyBattery\/reports\/daily/],
		["activities", /activitylist-service\/activities\/search\/activities/],
		["weight", /weight-service\/weight\/dateRange/],
		["spo2", /wellness\/daily\/spo2\//],
		["respiration", /wellness\/daily\/respiration\//],
		["trainingStatus", /metrics-service\/metrics\/maxmet\/daily\//],
		["trainingReadiness", /metrics-service\/metrics\/trainingreadiness\//],
	];
	const defaults: Record<string, Reply> = {
		profile: { body: { displayName: PRIVATE } },
		dailySummary: { body: { totalSteps: 8123 } },
		sleep: { body: { dailySleepDTO: { sleepTimeSeconds: 27000 } } },
		hrv: { body: { hrvSummary: { lastNightAvg: 48 } } },
		bodyBattery: { body: [{ charged: 60 }] },
		activities: { body: [{ activityType: { typeKey: "running" }, distance: 5000 }] },
		weight: { body: { dailyWeightSummaries: [{ weight: 80000 }] } },
		spo2: { body: { averageSpo2: 96 } },
		respiration: { body: { avgWakingRespirationValue: 14 } },
		trainingStatus: { body: { vo2MaxValue: 50 } },
		trainingReadiness: { body: [{ score: 70 }] },
	};
	for (const [key, re] of table) net.on(re, replies[key] ?? defaults[key]!);
}
const dataCalls = (): string[] => net.calls.map((c) => c.url).filter((u) => !EX.test(u) && !PROFILE.startsWith(u.split("?")[0]!));

let api: GarminApi;
function signedIn(oauth2: OAuth2Token | null = fresh()): void {
	api.setTokens(OAUTH1, oauth2);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	api = new GarminApi();
	api.setVersion("0.11.1-test");
	net.fail(/thegarth/);
});

describe("getRequiredEndpoints", () => {
	it("always includes activities and nothing else for no metrics", () => {
		expect(getRequiredEndpoints([])).toEqual(["activities"]);
	});

	it("adds exactly the endpoints the enabled metrics need, once each", () => {
		expect(getRequiredEndpoints(["steps", "stress", "sleep_score", "hrv"])).toEqual(["activities", "dailySummary", "sleep", "hrv"]);
		expect(getRequiredEndpoints(["body_battery_min", "body_battery_max"])).toEqual(["activities", "bodyBattery"]);
		expect(getRequiredEndpoints(["weight_kg", "body_fat_pct", "spo2", "respiration_rate", "vo2_max", "training_readiness"])).toEqual([
			"activities",
			"weight",
			"spo2",
			"respiration",
			"trainingStatus",
			"trainingReadiness",
		]);
	});

	it("ignores unknown metric keys", () => {
		expect(getRequiredEndpoints(["nonsense"])).toEqual(["activities"]);
	});
});

describe("calculateBatchDelay", () => {
	it("spreads the 50 requests a minute over the endpoint count, minus ~2 s of fetch time, minimum 1 s", () => {
		expect(calculateBatchDelay(1)).toBe(1200 - 2000 < 1000 ? 1000 : 1200 - 2000);
		expect(calculateBatchDelay(5)).toBe(Math.ceil(60000 / 10) - 2000);
		expect(calculateBatchDelay(11)).toBe(Math.ceil(60000 / 4) - 2000);
		expect(calculateBatchDelay(50)).toBe(58000);
	});

	it("never goes below one second and tolerates zero endpoints", () => {
		expect(calculateBatchDelay(0)).toBe(1000);
		expect(calculateBatchDelay(1)).toBe(1000);
	});
});

describe("session state", () => {
	it("is valid exactly while an OAuth1 token is present", () => {
		expect(api.isSessionValid()).toBe(false);
		signedIn();
		expect(api.isSessionValid()).toBe(true);
		expect(api.getTokens()).toEqual({ oauth1: OAUTH1, oauth2: fresh() });
	});

	it("clearSession forgets the tokens, the profile and the auth state", async () => {
		signedIn();
		routeData();
		await api.fetchDataForDate(DATE);
		await api.clearSession();
		expect(api.isSessionValid()).toBe(false);
		expect(api.getTokens()).toEqual({ oauth1: null, oauth2: null });
		expect(api.getAuthState()).toBe("unknown");
		signedIn();
		await api.fetchDataForDate(DATE);
		expect(net.callsTo("socialProfile")).toHaveLength(2);
	});

	it("starts willing to sync", () => {
		expect(api.shouldAttemptSync()).toBe(true);
	});
});

describe("token handling", () => {
	it("fetching without an OAuth1 token needs a login and clears everything", async () => {
		await expect(api.fetchDataForDate(DATE)).rejects.toBeInstanceOf(LoginRequiredError);
		expect(api.getAuthState()).toBe("needsUserLogin");
		expect(api.shouldAttemptSync()).toBe(false);
		expect(net.calls).toEqual([]);
	});

	it("reuses a valid access token and sends it as a bearer with the Garmin headers", async () => {
		signedIn();
		routeData();
		await api.fetchDataForDate(DATE);
		expect(net.callsTo("oauth/exchange")).toEqual([]);
		const call = net.callsTo("usersummary")[0]!;
		expect(call.headers).toEqual({
			"User-Agent": "com.garmin.android.apps.connectmobile",
			Authorization: "Bearer at-1",
			"Di-Backend": "connectapi.garmin.com",
		});
		expect(call.throw).toBe(false);
	});

	it("refreshes when the token expires within 60 seconds, not before", async () => {
		routeData();
		net.on(EX, { body: { access_token: "at-2", refresh_token: "rt", expires_in: 3600 } });
		signedIn({ ...fresh(), expires_at: NOW_S + 61 });
		await api.fetchDataForDate(DATE);
		expect(net.callsTo("oauth/exchange")).toHaveLength(0);
		signedIn({ ...fresh(), expires_at: NOW_S + 60 });
		await api.fetchDataForDate(DATE);
		expect(net.callsTo("oauth/exchange")).toHaveLength(1);
		expect(net.callsTo("usersummary").at(-1)!.headers?.["Authorization"]).toBe("Bearer at-2");
		expect(api.getTokens().oauth2?.expires_at).toBe(NOW_S + 3600);
		expect(api.getAuthState()).toBe("ready");
	});

	it("refreshes when only an OAuth1 token is stored (after a restart)", async () => {
		routeData();
		net.on(EX, { body: { access_token: "at-3", refresh_token: "rt", expires_in: 3600 } });
		signedIn(null);
		await api.fetchDataForDate(DATE);
		expect(net.callsTo("usersummary")[0]!.headers?.["Authorization"]).toBe("Bearer at-3");
	});

	it("does not send the MFA token or audience on a silent refresh", async () => {
		routeData();
		net.on(EX, { body: { access_token: "at-2", refresh_token: "rt", expires_in: 3600 } });
		api.setTokens({ ...OAUTH1, mfa_token: "MFA" }, null);
		await api.fetchDataForDate(DATE);
		expect(net.callsTo("oauth/exchange")[0]!.body).toBe("");
	});

	it.each([401, 403])("a refresh rejected with %i logs the user out: tokens gone, login required", async (status) => {
		net.on(EX, { status });
		signedIn(null);
		await expect(api.fetchDataForDate(DATE)).rejects.toBeInstanceOf(LoginRequiredError);
		expect(api.isSessionValid()).toBe(false);
		expect(api.getAuthState()).toBe("needsUserLogin");
	});

	it.each([429, 500, 503, 200])("a refresh failing with %i keeps the tokens and backs off (never a logout)", async (status) => {
		net.on(EX, status === 200 ? { body: "" } : { status });
		signedIn(null);
		await expect(api.fetchDataForDate(DATE)).rejects.toBeDefined();
		expect(api.isSessionValid()).toBe(true);
		if (status !== 200) {
			expect(api.getAuthState()).toBe("temporarilyUnavailable");
			expect(api.shouldAttemptSync()).toBe(false);
		}
	});

	it("a network failure during refresh is transient", async () => {
		net.fail(EX);
		signedIn(null);
		await expect(api.fetchDataForDate(DATE)).rejects.toMatchObject({ status: 0 });
		expect(api.isSessionValid()).toBe(true);
		expect(api.getAuthState()).toBe("temporarilyUnavailable");
	});

	it("caches the consumer keys across refreshes but not across a logout", async () => {
		net.reset();
		net.on(/thegarth/, { body: { consumer_key: "k", consumer_secret: "s" } });
		routeData();
		net.on(EX, { body: { access_token: "at-2", refresh_token: "rt", expires_in: 3600 } });
		signedIn(null);
		await api.fetchDataForDate(DATE);
		signedIn(null);
		await api.fetchDataForDate(DATE);
		expect(net.callsTo("thegarth")).toHaveLength(1);
		await api.clearSession();
		signedIn(null);
		await api.fetchDataForDate(DATE);
		expect(net.callsTo("thegarth")).toHaveLength(2);
	});
});

describe("the profile (display name)", () => {
	beforeEach(() => signedIn());

	it("is fetched once and used in the user-specific urls", async () => {
		routeData();
		await api.fetchDataForDate(DATE);
		await api.fetchDataForDate(DATE);
		expect(net.callsTo("socialProfile")).toHaveLength(1);
		expect(net.callsTo("usersummary")[0]!.url).toBe(`${BASE}/usersummary-service/usersummary/daily/${PRIVATE}?calendarDate=${DATE}`);
		expect(net.callsTo("dailySleepData")[0]!.url).toBe(`${BASE}/wellness-service/wellness/dailySleepData/${PRIVATE}?date=${DATE}&nonSleepBufferMinutes=60`);
	});

	it("falls back to userName when there is no displayName", async () => {
		routeData({ profile: { body: { userName: "the-user" } } });
		await api.fetchDataForDate(DATE);
		expect(net.callsTo("usersummary")[0]!.url).toContain("/daily/the-user?");
	});

	it("fails with the profile's status when it has no name", async () => {
		routeData({ profile: { body: { displayName: "", userName: 5 } } });
		await expect(api.fetchDataForDate(DATE)).rejects.toMatchObject({ name: "GarminAuthError", status: 200 });
		expect(api.getAuthState()).toBe("temporarilyUnavailable");
		expect(api.isSessionValid()).toBe(true);
	});

	it("fails on an empty or non-object profile answer", async () => {
		routeData({ profile: { body: "" } });
		await expect(api.fetchDataForDate(DATE)).rejects.toBeDefined();
		net.reset();
		routeData({ profile: { body: "just text" } });
		await expect(api.fetchDataForDate(DATE)).rejects.toBeDefined();
	});

	it.each([401, 403])("a profile %i means the grant is dead: logged out", async (status) => {
		routeData({ profile: { status } });
		await expect(api.fetchDataForDate(DATE)).rejects.toBeInstanceOf(LoginRequiredError);
		expect(api.getAuthState()).toBe("needsUserLogin");
		expect(api.isSessionValid()).toBe(false);
	});

	it.each([429, 500])("a profile %i is transient", async (status) => {
		routeData({ profile: { status } });
		await expect(api.fetchDataForDate(DATE)).rejects.toMatchObject({ status });
		expect(api.getAuthState()).toBe("temporarilyUnavailable");
		expect(api.isSessionValid()).toBe(true);
	});

	it("a network failure on the profile propagates and leaves the state alone", async () => {
		routeData();
		net.routes.unshift({ match: /socialProfile/, respond: "network-error" });
		await expect(api.fetchDataForDate(DATE)).rejects.toThrow();
		expect(api.isSessionValid()).toBe(true);
	});
});

describe("fetching endpoints", () => {
	beforeEach(() => signedIn());

	it("requests every endpoint by default and returns each answer under its key", async () => {
		routeData();
		const results = await api.fetchDataForDate(DATE);
		expect(Object.keys(results).sort()).toEqual(
			["activities", "bodyBattery", "dailySummary", "hrv", "respiration", "sleep", "spo2", "trainingReadiness", "trainingStatus", "weight"].sort(),
		);
		expect(results["dailySummary"]).toEqual({ totalSteps: 8123 });
	});

	it("requests only the required endpoints", async () => {
		routeData();
		api.setRequiredEndpoints(["activities", "hrv"]);
		await api.fetchDataForDate(DATE);
		expect(dataCalls().map((u) => u.replace(BASE, ""))).toEqual([
			`/activitylist-service/activities/search/activities?startDate=${DATE}&endDate=${DATE}&limit=20`,
			`/hrv-service/hrv/${DATE}`,
		]);
	});

	it("ignores a required endpoint name it does not know", async () => {
		routeData();
		api.setRequiredEndpoints(["hrv", "nonsense"]);
		const results = await api.fetchDataForDate(DATE);
		expect(Object.keys(results)).toEqual(["hrv"]);
	});

	it("builds every endpoint url for the date", async () => {
		routeData();
		await api.fetchDataForDate(DATE);
		const urls = new Set(dataCalls().map((u) => u.replace(BASE, "")));
		expect(urls).toEqual(
			new Set([
				`/usersummary-service/usersummary/daily/${PRIVATE}?calendarDate=${DATE}`,
				`/wellness-service/wellness/dailySleepData/${PRIVATE}?date=${DATE}&nonSleepBufferMinutes=60`,
				`/hrv-service/hrv/${DATE}`,
				`/wellness-service/wellness/bodyBattery/reports/daily?startDate=${DATE}&endDate=${DATE}`,
				`/activitylist-service/activities/search/activities?startDate=${DATE}&endDate=${DATE}&limit=20`,
				`/weight-service/weight/dateRange?startDate=${DATE}&endDate=${DATE}`,
				`/wellness-service/wellness/daily/spo2/${DATE}`,
				`/wellness-service/wellness/daily/respiration/${DATE}`,
				`/metrics-service/metrics/maxmet/daily/${DATE}/${DATE}`,
				`/metrics-service/metrics/trainingreadiness/${DATE}`,
			]),
		);
	});

	it("uses the China API host after setRegion", async () => {
		api.setRegion("china");
		net.on(/connectapi\.garmin\.cn/, (req) => (req.url.includes("socialProfile") ? { body: { displayName: "dn" } } : { body: {} }));
		api.setRequiredEndpoints(["hrv"]);
		await api.fetchDataForDate(DATE);
		expect(net.calls.every((c) => c.url.startsWith("https://connectapi.garmin.cn"))).toBe(true);
		expect(net.calls[0]!.headers?.["Di-Backend"]).toBe("connectapi.garmin.cn");
	});

	it("unwraps the sleep payload's dailySleepDTO, or keeps the whole answer without one", async () => {
		routeData();
		expect((await api.fetchDataForDate(DATE))["sleep"]).toEqual({ sleepTimeSeconds: 27000 });
		net.reset();
		routeData({ sleep: { body: { sleepTimeSeconds: 1 } } });
		expect((await api.fetchDataForDate(DATE))["sleep"]).toEqual({ sleepTimeSeconds: 1 });
	});

	it("takes the first entry of an array-shaped training readiness answer", async () => {
		routeData();
		expect((await api.fetchDataForDate(DATE))["trainingReadiness"]).toEqual({ score: 70 });
		net.reset();
		routeData({ trainingReadiness: { body: { score: 5 } } });
		expect((await api.fetchDataForDate(DATE))["trainingReadiness"]).toEqual({ score: 5 });
	});

	describe("days and endpoints without data", () => {
		it("treats a 200 with an empty body as no data, not as a failure", async () => {
			routeData({ hrv: { status: 200, body: "" } });
			api.setRequiredEndpoints(["hrv"]);
			const results = await api.fetchDataForDate(DATE);
			expect(results).toEqual({});
			expect(api.getAuthState()).toBe("ready");
		});

		it("treats a 404 as no data without counting a failure", async () => {
			routeData({ hrv: { status: 404 }, activities: { body: [] } });
			api.setRequiredEndpoints(["hrv", "activities"]);
			const results = await api.fetchDataForDate(DATE);
			expect(Object.keys(results)).toEqual(["activities"]);
			expect(api.getSyncDiagnostics()).not.toContain("partial failure");
		});

		it("a null JSON body is no data", async () => {
			routeData({ hrv: { body: "null" } });
			api.setRequiredEndpoints(["hrv"]);
			expect(await api.fetchDataForDate(DATE)).toEqual({});
		});

		it("an all-404 day is empty, not an error", async () => {
			routeData({ hrv: { status: 404 } });
			api.setRequiredEndpoints(["hrv"]);
			await expect(api.fetchDataForDate(DATE)).resolves.toEqual({});
		});
	});

	describe("failures", () => {
		it("keeps the endpoints that worked when others fail, and records the partial failure", async () => {
			routeData({ hrv: { status: 500 }, spo2: { status: 429 } });
			api.setRequiredEndpoints(["dailySummary", "hrv", "spo2"]);
			const results = await api.fetchDataForDate(DATE);
			expect(Object.keys(results)).toEqual(["dailySummary"]);
			expect(api.getSyncDiagnostics()).toContain("partial failure: hrv, spo2");
			expect(api.getAuthState()).toBe("ready");
		});

		it("records an endpoint that throws (network) as failed", async () => {
			routeData();
			net.routes.unshift({ match: /hrv-service/, respond: "network-error" });
			api.setRequiredEndpoints(["dailySummary", "hrv"]);
			const results = await api.fetchDataForDate(DATE);
			expect(Object.keys(results)).toEqual(["dailySummary"]);
			expect(api.getSyncDiagnostics()).toContain("hrv: threw Error");
		});

		it("raises a fetch error, not 'no data', when every endpoint failed", async () => {
			routeData({ hrv: { status: 500 }, spo2: { status: 503 } });
			api.setRequiredEndpoints(["hrv", "spo2"]);
			await expect(api.fetchDataForDate(DATE)).rejects.toBeInstanceOf(SyncFetchError);
			expect(api.getAuthState()).not.toBe("ready");
		});

		it("does not raise when something returned an empty answer next to failures", async () => {
			routeData({ hrv: { status: 500 }, spo2: { body: "" } });
			api.setRequiredEndpoints(["hrv", "spo2"]);
			await expect(api.fetchDataForDate(DATE)).resolves.toEqual({});
		});
	});

	describe("a token that dies mid-batch", () => {
		it("refreshes once and re-requests only the endpoints that had no answer", async () => {
			let first = true;
			routeData({
				hrv: () => (first ? { status: 401 } : { body: { hrvSummary: { lastNightAvg: 40 } } }),
				dailySummary: () => ({ body: { totalSteps: 1 } }),
			});
			net.on(EX, { body: { access_token: "at-2", refresh_token: "rt", expires_in: 3600 } });
			api.setRequiredEndpoints(["dailySummary", "hrv"]);
			const run = api.fetchDataForDate(DATE);
			await vi.advanceTimersByTimeAsync(0);
			first = false;
			const results = await run;
			expect(results["hrv"]).toEqual({ hrvSummary: { lastNightAvg: 40 } });
			expect(results["dailySummary"]).toEqual({ totalSteps: 1 });
			expect(net.callsTo("oauth/exchange")).toHaveLength(1);
			expect(net.callsTo("usersummary")).toHaveLength(1);
			expect(net.callsTo("hrv-service")).toHaveLength(2);
			expect(net.callsTo("hrv-service")[1]!.headers?.["Authorization"]).toBe("Bearer at-2");
			expect(api.getAuthState()).toBe("ready");
		});

		it("logs the user out when the retry is rejected as well", async () => {
			routeData({ hrv: { status: 401 } });
			net.on(EX, { body: { access_token: "at-2", refresh_token: "rt", expires_in: 3600 } });
			api.setRequiredEndpoints(["hrv"]);
			await expect(api.fetchDataForDate(DATE)).rejects.toBeInstanceOf(LoginRequiredError);
			expect(api.isSessionValid()).toBe(false);
			expect(api.getAuthState()).toBe("needsUserLogin");
		});

		it("logs the user out when the refresh itself is rejected", async () => {
			routeData({ hrv: { status: 403 } });
			net.on(EX, { status: 401 });
			api.setRequiredEndpoints(["hrv"]);
			await expect(api.fetchDataForDate(DATE)).rejects.toBeInstanceOf(LoginRequiredError);
		});

		it("counts the retry's failures instead of the first pass's", async () => {
			let phase = 0;
			routeData({ hrv: () => (phase++ === 0 ? { status: 401 } : { status: 500 }), dailySummary: { body: { totalSteps: 1 } } });
			net.on(EX, { body: { access_token: "at-2", refresh_token: "rt", expires_in: 3600 } });
			api.setRequiredEndpoints(["dailySummary", "hrv"]);
			const results = await api.fetchDataForDate(DATE);
			expect(Object.keys(results)).toEqual(["dailySummary"]);
			expect(api.getSyncDiagnostics()).toContain("partial failure: hrv");
		});
	});
});

describe("per-endpoint accessors and the shared cache", () => {
	beforeEach(() => signedIn());

	it("one request per endpoint serves all accessors for a date", async () => {
		routeData();
		api.setRequiredEndpoints(["dailySummary", "sleep", "hrv", "bodyBattery", "activities", "weight", "spo2", "respiration", "trainingStatus", "trainingReadiness"]);
		const [summary, sleep, hrv, bb, acts, weight, spo2, resp, status, readiness] = await Promise.all([
			api.fetchDailySummary(DATE),
			api.fetchSleepData(DATE),
			api.fetchHrv(DATE),
			api.fetchBodyBattery(DATE),
			api.fetchActivities(DATE),
			api.fetchWeight(DATE),
			api.fetchSpO2(DATE),
			api.fetchRespiration(DATE),
			api.fetchTrainingStatus(DATE),
			api.fetchTrainingReadiness(DATE),
		]);
		expect(summary).toEqual({ totalSteps: 8123 });
		expect(sleep).toEqual({ sleepTimeSeconds: 27000 });
		expect(hrv).toEqual({ hrvSummary: { lastNightAvg: 48 } });
		expect(bb).toEqual({ charged: 60 });
		expect(acts).toHaveLength(1);
		expect(weight).toEqual({ dailyWeightSummaries: [{ weight: 80000 }] });
		expect(spo2).toEqual({ averageSpo2: 96 });
		expect(resp).toEqual({ avgWakingRespirationValue: 14 });
		expect(status).toEqual({ vo2MaxValue: 50 });
		expect(readiness).toEqual({ score: 70 });
		expect(net.callsTo("socialProfile")).toHaveLength(1);
		for (const fragment of ["usersummary", "dailySleepData", "hrv-service", "bodyBattery", "activitylist", "weight-service", "spo2", "respiration", "maxmet", "trainingreadiness"]) {
			expect(net.callsTo(fragment), fragment).toHaveLength(1);
		}
	});

	it("serves a later accessor for the same date from the cache", async () => {
		routeData();
		await api.fetchDailySummary(DATE);
		const before = net.calls.length;
		await api.fetchHrv(DATE);
		expect(net.calls.length).toBe(before);
	});

	it("returns empty values for endpoints without data", async () => {
		routeData({ bodyBattery: { body: "" }, activities: { body: {} }, hrv: { body: "" } });
		api.setRequiredEndpoints(["bodyBattery", "activities", "hrv", "dailySummary"]);
		expect(await api.fetchBodyBattery(DATE)).toEqual({});
		expect(await api.fetchActivities(DATE)).toEqual([]);
		expect(await api.fetchHrv(DATE)).toEqual({});
	});

	it("accepts an object-shaped body battery answer and rejects other shapes", async () => {
		routeData({ bodyBattery: { body: { charged: 55 } } });
		api.setRequiredEndpoints(["bodyBattery"]);
		expect(await api.fetchBodyBattery(DATE)).toEqual({ charged: 55 });
		api.clearCache();
		net.reset();
		routeData({ bodyBattery: { body: "text" } });
		expect(await api.fetchBodyBattery(DATE)).toEqual({});
		api.clearCache();
		net.reset();
		routeData({ bodyBattery: { body: [] } });
		expect(await api.fetchBodyBattery(DATE)).toEqual({});
	});

	it("asks again for a different date and after clearCache", async () => {
		routeData();
		api.setRequiredEndpoints(["hrv"]);
		await api.fetchHrv(DATE);
		await api.fetchHrv("2026-10-23");
		expect(net.callsTo("hrv-service")).toHaveLength(2);
		api.clearCache();
		await api.fetchHrv("2026-10-23");
		expect(net.callsTo("hrv-service")).toHaveLength(3);
	});

	it("turns every failure except 'log in again' into a fetch error, so a failed day does not look empty", async () => {
		routeData({ hrv: { status: 500 } });
		api.setRequiredEndpoints(["hrv"]);
		await expect(api.fetchHrv(DATE)).rejects.toMatchObject({ name: "SyncFetchError", message: "all_endpoints_failed" });
		api.clearCache();
		api.setTokens(null, null);
		await expect(api.fetchHrv(DATE)).rejects.toBeInstanceOf(LoginRequiredError);
		api.setTokens(OAUTH1, null);
		net.reset();
		net.fail(/thegarth/);
		net.on(EX, { status: 500 });
		await expect(api.fetchHrv(DATE)).rejects.toMatchObject({ name: "SyncFetchError", message: "fetch_failed: GarminAuthError HTTP 500" });
	});

	it("does not cache a failed fetch: the next call asks again", async () => {
		let fail = true;
		routeData({ hrv: () => (fail ? { status: 500 } : { body: { hrvSummary: { lastNightAvg: 1 } } }) });
		api.setRequiredEndpoints(["hrv"]);
		await expect(api.fetchHrv(DATE)).rejects.toBeDefined();
		fail = false;
		expect(await api.fetchHrv(DATE)).toEqual({ hrvSummary: { lastNightAvg: 1 } });
	});

	it("gives up after 30 seconds, tells the diagnostics and reports a fetch error", async () => {
		routeData({ hrv: () => new Promise<MockReply>(() => undefined) });
		api.setRequiredEndpoints(["hrv"]);
		const run = api.fetchHrv(DATE).catch((e: unknown) => e);
		await vi.advanceTimersByTimeAsync(29_999);
		expect(api.getSyncDiagnostics()).not.toContain("timeout");
		await vi.advanceTimersByTimeAsync(1);
		const err = await run;
		expect(err).toBeInstanceOf(SyncFetchError);
		expect((err as Error).message).toBe("fetch_failed: Error");
		expect(api.getSyncDiagnostics()).toContain("fetch timeout after 30000ms");
	});

	it("a timeout that fires after the fetch finished writes nothing to the diagnostics", async () => {
		routeData();
		api.setRequiredEndpoints(["hrv"]);
		await api.fetchHrv(DATE);
		await vi.advanceTimersByTimeAsync(31_000);
		expect(api.getSyncDiagnostics()).not.toContain("timeout");
	});

	describe("an orphaned fetch (finished after clearCache, a newer run or the timeout)", () => {
		it("does not fill the cache and does not flip a logged-out state back to ready", async () => {
			let release: (r: MockReply) => void = () => undefined;
			routeData({ hrv: () => new Promise<MockReply>((resolve) => (release = resolve)) });
			api.setRequiredEndpoints(["hrv"]);
			const run = api.fetchHrv(DATE).catch((e: unknown) => e);
			await vi.advanceTimersByTimeAsync(0);
			await api.clearSession();
			signedIn();
			api.clearCache();
			release({ body: { hrvSummary: { lastNightAvg: 99 } } });
			await run;
			expect(api.getAuthState()).toBe("unknown");
			net.reset();
			routeData({ hrv: { body: { hrvSummary: { lastNightAvg: 1 } } } });
			expect(await api.fetchHrv(DATE)).toEqual({ hrvSummary: { lastNightAvg: 1 } });
		});

		it("a late failure of an orphaned fetch does not release a newer fetch's lock", async () => {
			let rejectFirst: (r: MockReply) => void = () => undefined;
			let calls = 0;
			routeData({
				hrv: () => (++calls === 1 ? new Promise<MockReply>((resolve) => (rejectFirst = resolve)) : { body: { hrvSummary: { lastNightAvg: 2 } } }),
			});
			api.setRequiredEndpoints(["hrv"]);
			const first = api.fetchHrv(DATE).catch((e: unknown) => e);
			await vi.advanceTimersByTimeAsync(0);
			api.clearCache();
			const second = await api.fetchHrv(DATE);
			rejectFirst({ status: 500 });
			await first;
			expect(second).toEqual({ hrvSummary: { lastNightAvg: 2 } });
			expect(await api.fetchHrv(DATE)).toEqual({ hrvSummary: { lastNightAvg: 2 } });
		});
	});
});

describe("sync diagnostics (copied into bug reports)", () => {
	beforeEach(() => signedIn());

	it("describes status, shape and timing per endpoint without any value, name, token or id", async () => {
		routeData({
			dailySummary: { body: { totalSteps: 8123, calendarDate: DATE, userNote: "private-note", empty: null } },
			sleep: { body: { dailySleepDTO: { calendarDate: DATE, sleepTimeSeconds: 27000, x: null } } },
			hrv: { body: "" },
		});
		api.setRequiredEndpoints(["dailySummary", "sleep", "hrv"]);
		await api.fetchDataForDate(DATE);
		const log = api.getSyncDiagnostics();
		expect(log.split("\n")[0]).toBe(`plugin v0.11.1-test, platform=desktop, region=garmin.com, date=${DATE}`);
		expect(log).toContain("dailySummary: HTTP 200");
		expect(log).toContain("fields=4, non-null=3");
		expect(log).toContain("sleepDTO non-null=2/3, calendarDate=" + DATE);
		expect(log).toContain("hrv: HTTP 200");
		expect(log).toContain("payload=none");
		for (const secret of [PRIVATE, "8123", "27000", "private-note", "at-1", "OT-secret", "OS-secret", "Bearer", "usersummary", "connectapi"]) {
			expect(log, secret).not.toContain(secret);
		}
		expect(log).toContain("profile id from displayName, guid-shaped=no");
	});

	it("notes when the profile id looks like a GUID, without printing it", async () => {
		const guid = "123e4567-e89b-12d3-a456-426614174000";
		routeData({ profile: { body: { displayName: guid } } });
		api.setRequiredEndpoints(["hrv"]);
		await api.fetchDataForDate(DATE);
		expect(api.getSyncDiagnostics()).toContain("guid-shaped=yes");
		expect(api.getSyncDiagnostics()).not.toContain(guid);
	});

	it("shows the response headers' names, cache hints and cookie names, never cookie values", async () => {
		routeData({
			hrv: { body: {}, headers: { "Content-Type": "application/json; charset=utf-8", "CF-Cache-Status": "HIT", Age: "30", "Set-Cookie": "session=SECRETVALUE; Path=/", "X-Custom": "hidden" } },
		});
		api.setRequiredEndpoints(["hrv"]);
		await api.fetchDataForDate(DATE);
		const log = api.getSyncDiagnostics();
		expect(log).toContain("cf-cache-status=HIT");
		expect(log).toContain("age=30");
		expect(log).toContain("set-cookie names: session");
		expect(log).toContain("type=application/json");
		expect(log).not.toContain("SECRETVALUE");
		expect(log).not.toContain("hidden");
	});

	it("handles responses without headers", async () => {
		routeData({ hrv: () => ({ body: {} }) });
		api.setRequiredEndpoints(["hrv"]);
		await api.fetchDataForDate(DATE);
		expect(api.getSyncDiagnostics()).toContain("set-cookie names: none");
	});

	it("says whether an unparseable body would have parsed as text (empty vs parse quirk)", async () => {
		routeData({ hrv: { body: "" }, spo2: { status: 200, body: "not json" }, respiration: { body: "null" } });
		api.setRequiredEndpoints(["hrv", "spo2"]);
		await api.fetchDataForDate(DATE);
		const log = api.getSyncDiagnostics();
		expect(log).toContain("json=threw, text-parses=no");
		api.clearCache();
		net.reset();
		routeData({ hrv: { body: "null" } });
		api.setRequiredEndpoints(["hrv"]);
		await api.fetchDataForDate(DATE);
		expect(api.getSyncDiagnostics()).toContain("json=ok");
	});

	it("starts a fresh log for every fetch and caps it at 90 lines", async () => {
		routeData();
		await api.fetchDataForDate(DATE);
		const first = api.getSyncDiagnostics();
		await api.fetchDataForDate("2026-10-23");
		expect(api.getSyncDiagnostics()).not.toBe(first);
		expect(api.getSyncDiagnostics()).toContain("date=2026-10-23");
		for (let i = 0; i < 200; i++) api.addSyncDiagnostic(`line ${i}`);
		expect(api.getSyncDiagnostics().split("\n").length).toBeLessThanOrEqual(90);
	});

	it("records the failed token refresh and profile failure", async () => {
		net.on(EX, { status: 500 });
		signedIn(null);
		await api.fetchDataForDate(DATE).catch(() => undefined);
		expect(api.getSyncDiagnostics()).toContain("token refresh: failed (GarminAuthError HTTP 500)");
		signedIn();
		routeData({ profile: { status: 500 } });
		await api.fetchDataForDate(DATE).catch(() => undefined);
		expect(api.getSyncDiagnostics()).toContain("socialProfile: failed (GarminAuthError HTTP 500)");
	});

	it("records an endpoint that throws a plain value as a generic error", async () => {
		routeData({ hrv: () => { throw "plain"; } });
		api.setRequiredEndpoints(["dailySummary", "hrv"]);
		await api.fetchDataForDate(DATE);
		expect(api.getSyncDiagnostics()).toContain("hrv: threw");
	});

	it("names non-HTTP errors by type only and falls back for odd throwables", async () => {
		signedIn(null);
		net.on(EX, () => {
			throw "not an error object";
		});
		await api.fetchDataForDate(DATE).catch(() => undefined);
		expect(api.getSyncDiagnostics()).toContain("token refresh: failed (");
	});

	it("labels the platform", async () => {
		routeData();
		api.setRequiredEndpoints(["hrv"]);
		Object.assign(Platform, { isDesktopApp: false, isIosApp: true });
		await api.fetchDataForDate(DATE);
		expect(api.getSyncDiagnostics()).toContain("platform=ios");
		Object.assign(Platform, { isIosApp: false, isAndroidApp: true });
		await api.fetchDataForDate(DATE);
		expect(api.getSyncDiagnostics()).toContain("platform=android");
		Object.assign(Platform, { isAndroidApp: false });
		await api.fetchDataForDate(DATE);
		expect(api.getSyncDiagnostics()).toContain("platform=other");
	});

	it("shows an unknown plugin version when none was set", async () => {
		const bare = new GarminApi();
		bare.setTokens(OAUTH1, fresh());
		routeData();
		bare.setRequiredEndpoints(["hrv"]);
		await bare.fetchDataForDate(DATE);
		expect(bare.getSyncDiagnostics()).toContain("plugin v?");
	});
});

describe("probeRequestVariants (mobile diagnostics for an empty answer)", () => {
	beforeEach(() => {
		signedIn();
		Object.assign(Platform, { isDesktopApp: false, isMobileApp: true, isIosApp: true });
	});

	async function primed(): Promise<void> {
		routeData();
		api.setRequiredEndpoints(["dailySummary"]);
		await api.fetchDataForDate(DATE); // resolves the display name
		net.calls = [];
	}

	it("does nothing on desktop", async () => {
		Object.assign(Platform, { isMobileApp: false });
		await primed();
		await api.probeRequestVariants(DATE);
		expect(net.calls).toEqual([]);
	});

	it("asks the daily summary once per variant, changing one request detail each time, and logs shapes only", async () => {
		await primed();
		await api.probeRequestVariants(DATE);
		expect(net.calls).toHaveLength(9);
		expect(net.calls.every((c) => c.url.includes("usersummary"))).toBe(true);
		const byHeader = (name: string) => net.calls.filter((c) => name in (c.headers ?? {}));
		expect(byHeader("Accept")).toHaveLength(1);
		expect(net.calls.filter((c) => !("User-Agent" in (c.headers ?? {})))).toHaveLength(1);
		expect(net.calls.filter((c) => c.url.includes("&_="))).toHaveLength(1);
		expect(net.calls.some((c) => c.headers?.["Cookie"] === "x=1")).toBe(true);
		const log = api.getSyncDiagnostics();
		expect(log).toContain("probe A baseline: HTTP 200");
		expect(log).toContain("probe H sentinel-cookie");
		expect(log).not.toContain(PRIVATE);
		expect(log).not.toContain("8123");
	});

	it("probes a date once and at most three dates per session", async () => {
		await primed();
		await api.probeRequestVariants(DATE);
		await api.probeRequestVariants(DATE);
		expect(net.calls).toHaveLength(9);
		await api.probeRequestVariants("2026-10-01");
		await api.probeRequestVariants("2026-10-02");
		await api.probeRequestVariants("2026-10-03");
		expect(net.calls).toHaveLength(27);
	});

	it("logs a variant that throws and one with an unreadable body, and keeps going", async () => {
		await primed();
		let n = 0;
		net.routes.unshift({
			match: /usersummary/,
			respond: () => {
				if (++n === 2) throw new Error("boom");
				return { body: n === 3 ? "" : { totalSteps: 1 }, headers: { "Set-Cookie": "a=1" } };
			},
		});
		await api.probeRequestVariants(DATE);
		const log = api.getSyncDiagnostics();
		expect(log).toContain("threw Error");
		expect(log).toContain("payload=none");
		expect(log).toContain("set-cookie names: a");
	});

	it("aborts quietly without a display name or when the token cannot be refreshed", async () => {
		await api.probeRequestVariants(DATE);
		expect(net.calls).toEqual([]);
		api.setTokens(OAUTH1, null);
		net.on(EX, { status: 500 });
		api.addSyncDiagnostic("x");
		await expect(api.probeRequestVariants("2026-10-02")).resolves.toBeUndefined();
	});
});
