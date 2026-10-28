// Why it matters: the provider decides which Garmin groups are fetched for the enabled metrics, merges
// the mapped values, and must never let one failing group drop the others or write garbage (NaN) into a note.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Platform, network as net, type MockReply } from "../testUtils/mocks/obsidian";
import { GarminProvider } from "../src/providers/garmin/garmin-provider";
import * as mapper from "../src/providers/garmin/garmin-mapper";
import { LoginRequiredError, SyncFetchError } from "../src/errors";
import { FakeBrowserWindow, installElectron } from "../testUtils/fakeElectron";

const DATE = "2026-10-24";
const NOW = 1_700_000_000_000;
const OAUTH1 = { oauth_token: "OT", oauth_token_secret: "OS" };
const OAUTH2 = { access_token: "at", refresh_token: "rt", expires_in: 3600, expires_at: NOW / 1000 + 3600 };

type Reply = MockReply | (() => MockReply);
function route(replies: Record<string, Reply> = {}): void {
	const table: [string, RegExp, Reply][] = [
		["profile", /socialProfile/, { body: { displayName: "dn" } }],
		["dailySummary", /usersummary\/daily/, { body: { totalSteps: 8123, restingHeartRate: 52, averageStressLevel: 30, moderateIntensityMinutes: 10, vigorousIntensityMinutes: 5 } }],
		["sleep", /dailySleepData/, { body: { dailySleepDTO: { sleepTimeSeconds: 27030, sleepScores: { overall: { value: 80 } } } } }],
		["hrv", /hrv-service/, { body: { hrvSummary: { lastNightAvg: 48 } } }],
		["bodyBattery", /bodyBattery/, { body: [{ charged: 60 }] }],
		["activities", /activitylist/, { body: [{ activityType: { typeKey: "running" }, distance: 5000, duration: 1800, startLatitude: 50.6, startLongitude: 7.2 }] }],
		["weight", /weight-service/, { body: { dailyWeightSummaries: [{ weight: 80000 }] } }],
		["spo2", /spo2/, { body: { averageSpo2: 96 } }],
		["respiration", /respiration/, { body: { avgWakingRespirationValue: 14 } }],
		["hydration", /hydration/, { body: { valueInML: 1800, goalInML: 2500 } }],
		["trainingStatus", /maxmet/, { body: { vo2MaxValue: 50, trainingStatusPhrase: "PRODUCTIVE" } }],
		["trainingReadiness", /trainingreadiness/, { body: [{ score: 70 }] }],
	];
	for (const [key, re, def] of table) net.on(re, replies[key] ?? def);
}

let provider: GarminProvider;
const endpointsCalled = (): string[] =>
	net.calls.map((c) => c.url).filter((u) => !/socialProfile|oauth/.test(u)).map((u) => u.replace(/^.*connectapi\.garmin\.com\//, "").split("/")[0]!);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	provider = new GarminProvider();
	provider.setTokens(OAUTH1, OAUTH2);
	net.fail(/thegarth/);
});

describe("identity and passthroughs", () => {
	it("identifies itself and is always configured (the login needs no preset)", () => {
		expect(provider.id).toBe("garmin");
		expect(provider.name).toBe("Garmin Connect");
		expect(provider.isConfigured()).toBe(true);
	});

	it("reports the session and auth state of the API layer", () => {
		expect(provider.isSessionValid()).toBe(true);
		expect(provider.getAuthState()).toBe("unknown");
		expect(provider.shouldAttemptSync()).toBe(true);
		expect(provider.getTokens()).toEqual({ oauth1: OAUTH1, oauth2: OAUTH2 });
	});

	it("clears the session", async () => {
		await provider.clearSession();
		expect(provider.isSessionValid()).toBe(false);
	});

	it("switches region and exposes the sign-in url for the manual fallback", () => {
		expect(provider.getSigninUrl()).toContain("sso.garmin.com");
		provider.setRegion("china");
		expect(provider.getSigninUrl()).toContain("sso.garmin.cn");
	});

	it("records the plugin version in the diagnostics", async () => {
		provider.setVersion("9.9.9");
		route();
		await provider.fetchData(DATE, ["steps"]);
		expect(provider.getSyncDiagnostics()).toContain("plugin v9.9.9");
	});

	it("recommends a delay from the endpoints the metrics need", () => {
		expect(provider.getRecommendedBatchDelay([])).toBe(1000);
		expect(provider.getRecommendedBatchDelay(["steps", "hrv", "sleep_score", "spo2"])).toBe(Math.ceil(60000 / 10) - 2000);
	});
});

describe("fetchData one at a time", () => {
	/** Replaces the work of a fetch with a scripted one that records when it starts and ends. */
	function script(work: (date: string) => Promise<void>): string[] {
		const order: string[] = [];
		(provider as unknown as { fetchDataNow: (date: string) => Promise<unknown> }).fetchDataNow = async (date) => {
			order.push(`start ${date}`);
			await work(date);
			order.push(`end ${date}`);
			return { metrics: {}, activities: {} };
		};
		return order;
	}

	it("never lets two fetches overlap, because the API caches one day at a time", async () => {
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const order = script(async (date) => {
			if (date === "a") await gate;
		});
		const first = provider.fetchData("a", []);
		const second = provider.fetchData("b", []);
		await Promise.resolve();
		await Promise.resolve();
		expect(order).toEqual(["start a"]);
		release();
		await Promise.all([first, second]);
		expect(order).toEqual(["start a", "end a", "start b", "end b"]);
	});

	it("goes on with the next fetch after one failed, and still reports the failure to its caller", async () => {
		const order = script(async (date) => {
			if (date === "a") throw new Error("down");
		});
		const first = provider.fetchData("a", []);
		const second = provider.fetchData("b", []);
		await expect(first).rejects.toThrow("down");
		await second;
		expect(order).toEqual(["start a", "start b", "end b"]);
	});
});

describe("fetchData", () => {
	it("needs a login when there is no session and calls nothing", async () => {
		provider.setTokens(null, null);
		await expect(provider.fetchData(DATE, ["steps"])).rejects.toBeInstanceOf(LoginRequiredError);
		expect(net.calls).toEqual([]);
	});

	it("fetches only the groups the enabled metrics need, plus activities", async () => {
		route();
		await provider.fetchData(DATE, ["steps", "hrv"]);
		expect(endpointsCalled().sort()).toEqual(["activitylist-service", "hrv-service", "usersummary-service"]);
	});

	it("fetches activities even with no metric enabled", async () => {
		route();
		const data = await provider.fetchData(DATE, []);
		expect(endpointsCalled()).toEqual(["activitylist-service"]);
		expect(data.metrics).toEqual({});
		expect(data.activities).toEqual({ running: "5 km · 30min" });
	});

	it("maps every group into the metrics, activities, trainings and start location", async () => {
		route();
		const all = [
			"steps", "resting_hr", "stress", "intensity_min", "sleep_duration", "sleep_score", "hrv", "body_battery",
			"spo2", "respiration_rate", "hydration_ml", "hydration_goal_ml", "weight_kg", "training_readiness", "training_status", "vo2_max",
		];
		const data = await provider.fetchData(DATE, all);
		expect(data.metrics).toEqual({
			steps: 8123,
			resting_hr: 52,
			stress: 30,
			intensity_min: 15,
			sleep_duration: "7h 31min",
			sleep_score: 80,
			hrv: 48,
			body_battery: 60,
			spo2: 96,
			respiration_rate: 14,
			hydration_ml: 1800,
			hydration_goal_ml: 2500,
			weight_kg: 80,
			training_readiness: 70,
			training_status: "PRODUCTIVE",
			vo2_max: 50,
		});
		expect(data.activities).toEqual({ running: "5 km · 30min" });
		expect(data.trainings).toEqual([{ type: "running", category: "running", distance_km: 5, duration_min: 30 }]);
		expect(data.startLocation).toEqual({ lat: 50.6, lon: 7.2 });
	});

	it("starts each fetch from a clean cache (a second call for the same date asks again)", async () => {
		route();
		await provider.fetchData(DATE, ["hrv"]);
		await provider.fetchData(DATE, ["hrv"]);
		expect(net.callsTo("hrv-service")).toHaveLength(2);
	});

	it("leaves start location out when no activity has GPS", async () => {
		route({ activities: { body: [{ activityType: { typeKey: "yoga" }, duration: 600 }] } });
		const data = await provider.fetchData(DATE, []);
		expect(data.startLocation).toBeUndefined();
	});

	it("handles days with nothing at all", async () => {
		route({ dailySummary: { body: "" }, activities: { body: [] } });
		net.on(/./, { body: "" });
		const data = await provider.fetchData(DATE, ["steps"]);
		expect(data).toEqual({ metrics: {}, activities: {}, trainings: [], startLocation: undefined, failedEndpoints: [] });
	});

	it("a failing group does not drop the others", async () => {
		route({ hrv: { status: 500 }, spo2: () => { throw new Error("boom"); } });
		const data = await provider.fetchData(DATE, ["steps", "hrv", "spo2"]);
		expect(data.metrics).toEqual({ steps: 8123 });
		expect(data.activities).toHaveProperty("running");
	});

	it("passes a total failure on as a fetch error, not as an empty day", async () => {
		route({ dailySummary: { status: 500 }, activities: { status: 500 } });
		await expect(provider.fetchData(DATE, ["steps"])).rejects.toBeInstanceOf(SyncFetchError);
	});

	it("passes a mid-fetch logout on to the caller", async () => {
		route({ dailySummary: { status: 401 }, activities: { status: 401 } });
		net.on(/oauth\/exchange/, { status: 401 });
		await expect(provider.fetchData(DATE, ["steps"])).rejects.toBeInstanceOf(LoginRequiredError);
		expect(provider.isSessionValid()).toBe(false);
	});

	it("records, per mapper, how many fields it filled and which response keys it ignored", async () => {
		route({ dailySummary: { body: { unexpectedShape: 1, other: 2 } } });
		await provider.fetchData(DATE, ["steps"]);
		const log = provider.getSyncDiagnostics();
		expect(log).toContain("mapper dailySummary: response keys: unexpectedShape, other");
		expect(log).toContain("mapper dailySummary: mapped 0 field(s)");
	});

	it("names the metrics a mapper filled, never their values", async () => {
		route({ dailySummary: { body: { totalSteps: 8123, restingHeartRate: 61 } } });
		await provider.fetchData(DATE, ["steps", "resting_hr"]);
		const log = provider.getSyncDiagnostics();
		expect(log).toContain("mapper dailySummary: mapped 2 field(s): steps, resting_hr");
		expect(log).not.toContain("8123");
		expect(log).not.toContain("61");
	});

	it("describes unmapped array answers by length and first-element keys", async () => {
		route({ trainingReadiness: { body: [{ unknownField: 1 }] }, weight: { body: [] } });
		await provider.fetchData(DATE, ["training_readiness", "weight_kg"]);
		const log = provider.getSyncDiagnostics();
		expect(log).toContain("mapper trainingReadiness: response keys: unknownField");
		expect(log).toContain("mapper weight: mapped 0 field(s)");
	});

	it("describes an unmapped primitive-element array", async () => {
		route({ trainingStatus: { body: [1, 2] } });
		await provider.fetchData(DATE, ["vo2_max"]);
		expect(provider.getSyncDiagnostics()).toContain("response keys: array[2]");
	});

	it("describes an unmapped empty object", async () => {
		route({ spo2: { body: { x: null } } });
		await provider.fetchData(DATE, ["spo2"]);
		expect(provider.getSyncDiagnostics()).toContain("mapper spo2: response keys: x");
	});
});

describe("C1: values that are not numbers never reach the note", () => {
	it("drops NaN from a non-numeric steps value and a non-numeric HRV status", async () => {
		route({
			dailySummary: { body: { totalSteps: "many", restingHeartRate: 51 } },
			hrv: { body: { hrvStatus: "BALANCED" } },
		});
		const data = await provider.fetchData(DATE, ["steps", "resting_hr", "hrv"]);
		expect(data.metrics).toEqual({ resting_hr: 51 });
		for (const v of Object.values(data.metrics)) expect(v).not.toBeNaN();
	});

	it("drops Infinity and keeps real strings and zeros", async () => {
		route({
			dailySummary: { body: { totalSteps: 0, restingHeartRate: 1e999 } },
			sleep: { body: { sleepTimeSeconds: 27000 } },
		});
		const data = await provider.fetchData(DATE, ["steps", "resting_hr", "sleep_duration"]);
		expect(data.metrics).toEqual({ steps: 0, sleep_duration: "7h 30min" });
	});

	it("never produces NaN, Infinity or empty strings for any of the mapped groups, whatever Garmin sends", async () => {
		const junk = ["x", "", null, true, {}, [], [{}], -1, "NaN", { a: { b: "c" } }];
		for (const j of junk) {
			net.reset();
			net.fail(/thegarth/);
			const same = { body: j } as MockReply;
			route({ dailySummary: same, sleep: same, hrv: same, bodyBattery: same, activities: same, weight: same, spo2: same, respiration: same, hydration: same, trainingStatus: same, trainingReadiness: same });
			const data = await provider.fetchData(DATE, [
				"steps", "resting_hr", "stress", "calories_total", "calories_active", "distance_km", "floors", "intensity_min",
				"sleep_duration", "sleep_score", "sleep_deep", "hrv", "body_battery", "body_battery_min", "spo2", "respiration_rate", "hydration_ml", "hydration_goal_ml",
				"weight_kg", "body_fat_pct", "training_readiness", "training_status", "vo2_max",
			]);
			for (const [k, v] of Object.entries(data.metrics)) {
				if (typeof v === "number") expect(Number.isFinite(v), `${k} from ${JSON.stringify(j)}`).toBe(true);
				else expect(v, `${k} from ${JSON.stringify(j)}`).not.toBe("");
			}
		}
	});
});

describe("the stress and recovery minutes (issue 31)", () => {
	it("are requested from the daily summary and written in minutes", async () => {
		route({ dailySummary: { body: { mediumStressDuration: 3600, highStressDuration: 1800, restStressDuration: 19800 } } });
		const data = await provider.fetchData(DATE, ["stress_high", "recovery_high"]);
		expect(endpointsCalled()).toContain("usersummary-service");
		expect(data.metrics).toEqual({ stress_high: 90, recovery_high: 330 });
	});

	it("every metric the settings offer is requested from an endpoint and written by a mapper (no dead toggle)", async () => {
		route({
			dailySummary: { body: { totalSteps: 1, restingHeartRate: 50, averageStressLevel: 30, mediumStressDuration: 600, highStressDuration: 600, restStressDuration: 1200, totalKilocalories: 2000, activeKilocalories: 500, totalDistanceMeters: 5000, floorsAscended: 4, moderateIntensityMinutes: 5, vigorousIntensityMinutes: 5 } },
			sleep: { body: { dailySleepDTO: { sleepTimeSeconds: 27000, sleepScores: { overall: { value: 80 } }, deepSleepSeconds: 1, lightSleepSeconds: 60, remSleepSeconds: 60, awakeSleepSeconds: 60, sleepStartTimestampLocal: Date.UTC(2026, 9, 21, 23, 0), sleepEndTimestampLocal: Date.UTC(2026, 9, 22, 6, 30) } } },
			bodyBattery: { body: [{ charged: 60, bodyBatteryValuesArray: [[1, 20], [2, 90]] }] },
			weight: { body: { dailyWeightSummaries: [{ weight: 80000, bodyFat: 20 }] } },
			hydration: { body: { valueInML: 1800, goalInML: 2500 } },
		});
		const { METRICS } = await import("../src/metrics");
		const keys = METRICS.map((m) => m.key);
		const data = await provider.fetchData(DATE, keys);
		expect(keys.filter((k) => !(k in data.metrics))).toEqual([]);
	});
});

describe("a mapper that cannot cope with a payload", () => {
	it("is logged and skipped without dropping the other groups", async () => {
		route();
		vi.spyOn(mapper, "mapBodyBattery").mockImplementation(() => { throw new RangeError("mapper cannot cope"); });
		const warn = vi.spyOn(console, "warn");
		const data = await provider.fetchData(DATE, ["steps", "body_battery_min"]);
		expect(data.metrics).toEqual({ steps: 8123 });
		expect(warn.mock.calls.some((c) => String(c[0]).includes("Body Battery fetch failed"))).toBe(true);
	});
});

describe("login passthroughs", () => {
	it("authenticates through the desktop window and reports cancellation", async () => {
		installElectron();
		FakeBrowserWindow.reset();
		const p = provider.authenticate();
		await vi.advanceTimersByTimeAsync(0);
		FakeBrowserWindow.instances[0]!.userClose();
		expect(await p).toEqual({ ok: false, cancelled: true });
	});

	it("reports a successful desktop login", async () => {
		installElectron();
		FakeBrowserWindow.reset();
		net.on(/preauthorized/, { body: "oauth_token=OT&oauth_token_secret=OS" });
		net.on(/exchange/, { body: { access_token: "a", refresh_token: "r", expires_in: 3600 } });
		const p = provider.authenticate();
		await vi.advanceTimersByTimeAsync(0);
		FakeBrowserWindow.instances[0]!.emit("will-navigate", "https://sso.garmin.com/sso/embed?ticket=ST-12345-abc");
		expect(await p).toEqual({ ok: true, cancelled: false });
	});

	it("reports a failed (not cancelled) desktop login", async () => {
		Platform.isDesktopApp = false;
		expect(await provider.authenticate()).toEqual({ ok: false, cancelled: false });
	});

	it("signs in with a manual ticket", async () => {
		net.on(/preauthorized/, { body: "oauth_token=OT2&oauth_token_secret=OS2" });
		net.on(/exchange/, { body: { access_token: "a2", refresh_token: "r2", expires_in: 3600 } });
		expect(await provider.authenticateWithTicket("ST-123456-abc")).toBe(true);
		expect(provider.getTokens().oauth1?.oauth_token).toBe("OT2");
		expect(await provider.authenticateWithTicket("nope")).toBe(false);
	});

	it("delegates credential and MFA login and exposes the redacted log", async () => {
		net.on(/mobile\/api\/login/, { body: { responseStatus: { type: "MFA_REQUIRED" } } });
		expect(await provider.loginWithCredentials("a@b.c", "pw")).toEqual({ status: "mfa", method: "email" });
		net.on(/verifyCode/, { body: { responseStatus: { type: "NOPE" } } });
		expect(await provider.completeMfaLogin("1")).toMatchObject({ status: "error" });
		expect(provider.getLoginDiagnostics()).toContain("MFA required");
		expect(provider.getLoginDiagnostics()).not.toContain("pw");
	});

	it("closes an open login window on unload", async () => {
		installElectron();
		FakeBrowserWindow.reset();
		const p = provider.authenticate();
		await vi.advanceTimersByTimeAsync(0);
		provider.closeActiveLogin();
		expect(FakeBrowserWindow.instances[0]!.destroyed).toBe(true);
		await p;
	});
});
