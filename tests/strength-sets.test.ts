// Why it matters: strength sets (fork addition) turn Garmin's per-set exercise data into a
// `strength_sets` property. A wrong branch here logs the wrong exercise, the wrong weight unit
// (grams vs kg) or silently drops a session, which defeats the point of tracking progression.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, network as net, parseYaml } from "../testUtils/mocks/obsidian";
import { mapExerciseSets } from "../src/providers/garmin/garmin-mapper";
import { GarminApi } from "../src/providers/garmin/garmin-api";
import { GarminProvider } from "../src/providers/garmin/garmin-provider";
import { writeToDailyNote } from "../src/daily-note";
import type { HealthData } from "../src/providers/provider";

const DATE = "2026-10-24";
const NOW = 1_700_000_000_000;
const OAUTH1 = { oauth_token: "OT", oauth_token_secret: "OS" };
const OAUTH2 = { access_token: "at", refresh_token: "rt", expires_in: 3600, expires_at: NOW / 1000 + 3600 };
const SETS_URL = /activity-service\/activity\/([^/]+)\/exerciseSets/;

const set = (patch: Record<string, unknown>): Record<string, unknown> => ({ setType: "ACTIVE", ...patch });
const ex = (name: unknown, category: unknown = "SQUAT", probability: unknown = 100): Record<string, unknown> =>
	({ name, category, probability });

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	net.fail(/thegarth/);
});

describe("mapExerciseSets", () => {
	it("groups active sets per exercise in workout order and skips rest sets", () => {
		const result = mapExerciseSets([{
			exerciseSets: [
				set({ repetitionCount: 5, weight: 60000, exercises: [ex("BARBELL_BACK_SQUAT")] }),
				{ setType: "REST", duration: 120 },
				set({ repetitionCount: 8, weight: 47000, exercises: [ex("LAT_PULLDOWN", "PULL_UP")] }),
				set({ repetitionCount: 5, weight: 62500, exercises: [ex("BARBELL_BACK_SQUAT")] }),
			],
		}]);
		expect(result).toEqual([
			{ exercise: "Barbell Back Squat", sets: 2, reps: [5, 5], weights_kg: [60, 62.5], max_weight_kg: 62.5 },
			{ exercise: "Lat Pulldown", sets: 1, reps: [8], weights_kg: [47], max_weight_kg: 47 },
		]);
	});

	it("picks the most probable exercise, treating a missing probability as 0", () => {
		const result = mapExerciseSets([{
			exerciseSets: [
				set({ repetitionCount: 10, exercises: [ex("CRUNCH", "CRUNCH", "n/a"), ex("SIT_UP", "SIT_UP", 80), ex("PLANK", "PLANK", 20)] }),
				set({ repetitionCount: 10, exercises: [ex("SIT_UP", "SIT_UP", "n/a"), ex("CRUNCH", "CRUNCH", "n/a")] }),
			],
		}]);
		expect(result.map(r => r.exercise)).toEqual(["Sit Up"]);
		expect(result[0]!.sets).toBe(2);
	});

	it("falls back to the category, then to Unknown", () => {
		const result = mapExerciseSets([{
			exerciseSets: [
				set({ repetitionCount: 3, exercises: [ex(null, "DEADLIFT")] }),
				set({ repetitionCount: 4, exercises: [ex("", "")] }),
				set({ repetitionCount: 6, exercises: "not-a-list" }),
			],
		}]);
		expect(result).toEqual([
			{ exercise: "Deadlift", sets: 1, reps: [3] },
			{ exercise: "Unknown", sets: 2, reps: [4, 6] },
		]);
	});

	it("converts grams to kg, keeps kg values, and ignores missing or invalid weights", () => {
		const result = mapExerciseSets([{
			exerciseSets: [
				set({ repetitionCount: 12, weight: 17.5, exercises: [ex("FRONT_RAISE")] }),
				set({ repetitionCount: 12, weight: null, exercises: [ex("FRONT_RAISE")] }),
				set({ repetitionCount: 12, weight: "heavy", exercises: [ex("FRONT_RAISE")] }),
				set({ repetitionCount: 12, weight: 20000, exercises: [ex("FRONT_RAISE")] }),
			],
		}]);
		expect(result).toEqual([
			{ exercise: "Front Raise", sets: 4, reps: [12, 12, 12, 12], weights_kg: [17.5, 0, 0, 20], max_weight_kg: 20 },
		]);
	});

	it("counts a missing rep count as 0 and merges several activities, skipping malformed ones", () => {
		const result = mapExerciseSets([
			{ exerciseSets: "broken" },
			{ exerciseSets: [set({ exercises: [ex("HANGING_LEG_RAISE")] })] },
			{ exerciseSets: [set({ repetitionCount: 12.4, exercises: [ex("HANGING_LEG_RAISE")] })] },
		]);
		expect(result).toEqual([{ exercise: "Hanging Leg Raise", sets: 2, reps: [0, 12] }]);
	});

	it("returns nothing for no responses", () => {
		expect(mapExerciseSets([])).toEqual([]);
	});
});

describe("GarminApi.fetchExerciseSets", () => {
	let api: GarminApi;
	beforeEach(() => {
		api = new GarminApi();
		api.setTokens(OAUTH1, OAUTH2);
	});

	it("returns the parsed body of a successful request", async () => {
		net.on(SETS_URL, { body: { activityId: 7, exerciseSets: [] } });
		expect(await api.fetchExerciseSets(7)).toEqual({ activityId: 7, exerciseSets: [] });
		expect(net.calls.some(c => c.url.includes("/activity-service/activity/7/exerciseSets"))).toBe(true);
	});

	it("returns null for a non-2xx status", async () => {
		net.on(SETS_URL, { status: 404, body: {} });
		expect(await api.fetchExerciseSets("8")).toBeNull();
	});

	it("returns null for a 2xx answer without a usable body", async () => {
		net.on(SETS_URL, { status: 200 });
		expect(await api.fetchExerciseSets(9)).toBeNull();
	});

	it("returns null instead of throwing when the request fails", async () => {
		net.fail(SETS_URL);
		expect(await api.fetchExerciseSets(10)).toBeNull();
	});
});

describe("GarminProvider strength sets", () => {
	let provider: GarminProvider;
	beforeEach(() => {
		provider = new GarminProvider();
		provider.setTokens(OAUTH1, OAUTH2);
		net.on(/socialProfile/, { body: { displayName: "dn" } });
		net.on(/activitylist/, { body: [
			{ activityId: 1, activityType: { typeKey: "strength_training" }, duration: 3600 },
			{ activityId: "2", activityType: { typeKey: "strength_training" }, duration: 1800 },
			{ activityId: 3, activityType: { typeKey: "running" }, distance: 5000, duration: 1500 },
			{ activityType: { typeKey: "strength_training" }, duration: 600 },
			{ activityId: 4 },
		] });
		net.on(SETS_URL, (req) => {
			const id = SETS_URL.exec(req.url)?.[1];
			return id === "1"
				? { body: { exerciseSets: [set({ repetitionCount: 5, weight: 60000, exercises: [ex("BARBELL_BACK_SQUAT")] })] } }
				: { status: 404, body: {} };
		});
	});

	const setsCalls = (): string[] => net.calls.map(c => c.url).filter(u => SETS_URL.test(u));

	it("fetches sets only for strength activities with an id and maps them", async () => {
		provider.setOptions({ strengthSets: true });
		const data = await provider.fetchData(DATE, []);
		expect(setsCalls()).toHaveLength(2);
		expect(data.strength).toEqual([
			{ exercise: "Barbell Back Squat", sets: 1, reps: [5], weights_kg: [60], max_weight_kg: 60 },
		]);
	});

	it("makes no extra requests and returns no strength data when the option is off", async () => {
		provider.setOptions({ strengthSets: false });
		const data = await provider.fetchData(DATE, []);
		expect(setsCalls()).toHaveLength(0);
		expect(data.strength).toBeUndefined();
	});
});

describe("writing strength_sets to the daily note", () => {
	type Options = Parameters<typeof writeToDailyNote>[3];
	const note = `Daily/${DATE}.md`;
	let app: App;
	const asApp = (): never => app as never;
	const opts = (patch: Partial<Options> = {}): Options => ({
		dailyNotePath: "Daily",
		dailyNoteFormat: "YYYY-MM-DD",
		prefix: "",
		template: "",
		writeTrainings: false,
		writeWorkoutLocation: false,
		createIfMissing: true,
		language: "en",
		...patch,
	});
	const health = (patch: Partial<HealthData> = {}): HealthData => ({ metrics: { steps: 8000 }, activities: {}, ...patch });
	const frontmatter = (): Record<string, unknown> => {
		const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(app.vault.text(note));
		return (parseYaml(m?.[1] ?? "") ?? {}) as Record<string, unknown>;
	};
	const squat = [{ exercise: "Barbell Back Squat", sets: 1, reps: [5], weights_kg: [60], max_weight_kg: 60 }];

	beforeEach(() => {
		vi.setSystemTime(new Date("2026-10-25T08:09:10"));
		app = new App();
		app.vault.seed(note, "Body\n");
	});

	it("writes the sets when the setting is on, with the property prefix", async () => {
		await writeToDailyNote(asApp(), DATE, health({ strength: squat }), opts({ writeStrengthSets: true, prefix: "ohs_" }));
		expect(frontmatter()["ohs_strength_sets"]).toEqual(squat);
	});

	it("writes nothing when the setting is off, the list is empty, or there is no strength data", async () => {
		await writeToDailyNote(asApp(), DATE, health({ strength: squat }), opts({ writeStrengthSets: false }));
		await writeToDailyNote(asApp(), DATE, health({ strength: [] }), opts({ writeStrengthSets: true }));
		await writeToDailyNote(asApp(), DATE, health(), opts({ writeStrengthSets: true }));
		expect(frontmatter()).not.toHaveProperty("strength_sets");
	});
});
