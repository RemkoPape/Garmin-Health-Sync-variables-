// Why it matters: the index is the panel's only data source. It must read just the daily notes it should,
// understand both key styles, ignore junk values and pick up edits, without ever reading a file.
import { describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { HistoryStore } from "../src/history/store";
import { serializeMonth } from "../src/history/format";

const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };

describe("DayIndex", () => {
	it("reads numeric values by date", async () => {
		const app = new App();
		await seedHistory(app, { end: "2026-10-22", days: 3, frontmatter: (ago) => ({ hrv: 60 - ago }) });
		const index = new DayIndex(app as never, () => settings);
		expect(index.value("hrv", "2026-10-22")).toBe(60);
		expect(index.value("hrv", "2026-10-20")).toBe(58);
	});

	it("understands the ohs_ prefix, so notes from both settings work", async () => {
		const app = new App();
		await seedHistory(app, { end: "2026-10-22", days: 2, frontmatter: (ago) => (ago === 0 ? { ohs_hrv: 61 } : { hrv: 59 }) });
		const index = new DayIndex(app as never, () => settings);
		expect(index.value("hrv", "2026-10-22")).toBe(61);
		expect(index.value("hrv", "2026-10-21")).toBe(59);
	});

	it("ignores missing notes, missing keys and values that are not finite numbers", async () => {
		const app = new App();
		await seedHistory(app, { end: "2026-10-22", days: 6, frontmatter: (ago) => [{ hrv: Number.NaN }, {}, null, { hrv: Number.POSITIVE_INFINITY }, { hrv: "62 ms" }, { hrv: "abc" }][ago] ?? null });
		const index = new DayIndex(app as never, () => settings);
		for (const day of ["2026-10-22", "2026-10-21", "2026-10-20", "2026-10-19", "2026-10-18", "2026-10-17", "2020-01-01"]) expect(index.value("hrv", day), day).toBeNull();
	});

	it("reads a number typed into a text property as the number it says, and nothing else that is a string", async () => {
		const app = new App();
		await seedHistory(app, { end: "2026-10-22", days: 4, frontmatter: (ago) => [{ hrv: "62" }, { hrv: " 61.5 " }, { hrv: "-1" }, { hrv: "" }][ago] ?? null });
		const index = new DayIndex(app as never, () => settings);
		expect(index.value("hrv", "2026-10-22")).toBe(62);
		expect(index.value("hrv", "2026-10-21")).toBe(61.5);
		expect(index.value("hrv", "2026-10-20")).toBe(-1);
		expect(index.value("hrv", "2026-10-19")).toBeNull();
	});

	it("skips notes without frontmatter and files that are no daily notes", async () => {
		const app = new App();
		await app.vault.create("2026-10-22.md", "no frontmatter");
		await app.vault.create("meeting.md", "x");
		app.metadataCache.frontmatter.set("meeting.md", { hrv: 99 });
		const index = new DayIndex(app as never, () => settings);
		expect(index.value("hrv", "2026-10-22")).toBeNull();
	});

	it("only looks inside the configured daily note folder", async () => {
		const app = new App();
		await seedHistory(app, { end: "2026-10-22", days: 1, folder: "Journal", frontmatter: () => ({ hrv: 55 }) });
		await seedHistory(app, { end: "2026-10-21", days: 1, frontmatter: () => ({ hrv: 77 }) });
		const index = new DayIndex(app as never, () => ({ ...settings, dailyNotePath: "Journal" }));
		expect(index.value("hrv", "2026-10-22")).toBe(55);
		expect(index.value("hrv", "2026-10-21")).toBeNull();
	});

	it("finds daily notes in any folder while no daily note folder is set (a device whose plugin settings did not come along)", async () => {
		const app = new App();
		await seedHistory(app, { end: "2026-10-22", days: 2, folder: "Journal", frontmatter: (ago) => ({ hrv: 60 - ago }) });
		const index = new DayIndex(app as never, () => settings);
		expect(index.value("hrv", "2026-10-22")).toBe(60);
		expect(index.value("hrv", "2026-10-21")).toBe(59);
	});

	it("reads duration strings as minutes", async () => {
		const app = new App();
		await seedHistory(app, { end: "2026-10-22", days: 3, frontmatter: (ago) => [{ sleep_duration: "6h 13min" }, { ohs_sleep_duration: "7h" }, { sleep_duration: 5 }][ago]! });
		const index = new DayIndex(app as never, () => settings);
		expect(index.minutes("sleep_duration", "2026-10-22")).toBe(373);
		expect(index.minutes("sleep_duration", "2026-10-21")).toBe(420);
		expect(index.minutes("sleep_duration", "2026-10-20")).toBeNull();
		expect(index.minutes("sleep_duration", "2020-01-01")).toBeNull();
	});

	it("reads clock times as minutes since midnight", async () => {
		const app = new App();
		await seedHistory(app, { end: "2026-10-22", days: 2, frontmatter: (ago) => [{ sleep_start: "23:15" }, { ohs_sleep_start: "00:30" }][ago]! });
		const index = new DayIndex(app as never, () => settings);
		expect(index.clock("sleep_start", "2026-10-22")).toBe(1395);
		expect(index.clock("sleep_start", "2026-10-21")).toBe(30);
		expect(index.clock("sleep_start", "2020-01-01")).toBeNull();
	});

	it("rebuilds after invalidate and not before", async () => {
		const app = new App();
		await seedHistory(app, { end: "2026-10-22", days: 1, frontmatter: () => ({ hrv: 50 }) });
		const index = new DayIndex(app as never, () => settings);
		expect(index.value("hrv", "2026-10-22")).toBe(50);
		app.metadataCache.frontmatter.set("2026-10-22.md", { hrv: 51 });
		expect(index.value("hrv", "2026-10-22")).toBe(50);
		index.invalidate();
		expect(index.value("hrv", "2026-10-22")).toBe(51);
	});
});

describe("the habits the notes hold", () => {
	it("names the habits by their keys, with and without the prefix, and reads count or yes/no from the amounts", async () => {
		const app = new App();
		await seedHistory(app, { end: "2026-10-22", days: 4, frontmatter: (ago) => ({ lifestyle_late_caffeine: ago === 0 ? 3 : 1, ohs_lifestyle_cold_showers: ago % 2, lifestyle_run: ago === 3 ? 1 : undefined, hrv: 50 }) });
		const habits = new DayIndex(app as never, () => settings).habitsInNotes();
		expect(habits).toEqual({
			lifestyle_late_caffeine: { name: "Late caffeine", kind: "count", last: "2026-10-22" },
			lifestyle_cold_showers: { name: "Cold showers", kind: "check", last: "2026-10-22" },
			lifestyle_run: { name: "Run", kind: "check", last: "2026-10-19" },
		});
	});

	it("ignores text, empty and non-finite values, the bare prefix and keys of other metrics", async () => {
		const app = new App();
		await seedHistory(app, { end: "2026-10-22", days: 1, frontmatter: () => ({ lifestyle_mood: "good", lifestyle_empty: "", lifestyle_nan: Number.NaN, lifestyle_: 1, lifestyle_list: [1], hrv: 50, steps: 9000 }) });
		expect(new DayIndex(app as never, () => settings).habitsInNotes()).toEqual({});
	});

	it("finds habits that only the history notes hold, and takes the later day of the two sources", async () => {
		const app = new App();
		app.vault.seed("Garmin history/Garmin history 2026-10.md", serializeMonth("2026-10", new Map([["2026-10-20", { lifestyle_run: 2, lifestyle_alcohol: 0 }], ["2026-10-21", { lifestyle_alcohol: 1 }]])));
		await seedHistory(app, { end: "2026-10-22", days: 1, frontmatter: () => ({ lifestyle_run: 1 }) });
		const history = new HistoryStore(app as never, settings);
		await history.warm("2026-10-01", "2026-10-31");
		const habits = new DayIndex(app as never, () => settings, history).habitsInNotes();
		expect(habits["lifestyle_run"]).toEqual({ name: "Run", kind: "count", last: "2026-10-22" });
		expect(habits["lifestyle_alcohol"]).toEqual({ name: "Alcohol", kind: "check", last: "2026-10-21" });
	});

	it("is empty for a vault without habits", () => {
		expect(new DayIndex(new App() as never, () => settings).habitsInNotes()).toEqual({});
	});
});

describe("DayIndex with the history notes", () => {
	const HISTORY = "Garmin history/Garmin history 2026-10.md";
	const month = (days: Record<string, Record<string, unknown>>): string => serializeMonth("2026-10", new Map(Object.entries(days)));

	async function build(days: Record<string, Record<string, unknown>>, notes: (ago: number) => Record<string, unknown> | null = () => null): Promise<DayIndex> {
		const app = new App();
		app.vault.seed(HISTORY, month(days));
		await seedHistory(app, { end: "2026-10-22", days: 3, frontmatter: notes });
		const history = new HistoryStore(app as never, settings);
		await history.warm("2026-10-01", "2026-10-31");
		return new DayIndex(app as never, () => settings, history);
	}

	it("answers for a day that has no note", async () => {
		const index = await build({ "2026-10-10": { hrv: 44, sleep_duration: "6h 24min", sleep_start: "23:10", training_status: "Productive" } });
		expect(index.value("hrv", "2026-10-10")).toBe(44);
		expect(index.minutes("sleep_duration", "2026-10-10")).toBe(384);
		expect(index.clock("sleep_start", "2026-10-10")).toBe(23 * 60 + 10);
		expect(index.text("training_status", "2026-10-10")).toBe("Productive");
		expect(index.hasNote("2026-10-10")).toBe(false);
		expect(index.hasDay("2026-10-10")).toBe(true);
		expect(index.hasDay("2026-10-11")).toBe(false);
	});

	it("lets the note win per value and fills the others from the history, prefixed notes included", async () => {
		const index = await build({ "2026-10-22": { hrv: 44, steps: 7000 }, "2026-10-21": { hrv: 50 } }, (ago) => (ago === 0 ? { hrv: 61 } : ago === 1 ? { ohs_hrv: 62 } : null));
		expect(index.value("hrv", "2026-10-22")).toBe(61);
		expect(index.value("steps", "2026-10-22")).toBe(7000);
		expect(index.value("hrv", "2026-10-21")).toBe(62);
	});

	it("merges the sessions of the note and the history, the note's entry winning for a type both have", async () => {
		const index = await build({ "2026-10-22": { running: "30min · Ø150 bpm", cycling: "60min" } }, (ago) => (ago === 0 ? { running: "45min · Ø140 bpm" } : null));
		const sessions = index.sessions("2026-10-22").map((s) => [s.type, s.minutes]);
		expect(sessions).toEqual([["cycling", 60], ["running", 45]]);
		expect(index.sessions("2026-10-15")).toEqual([]);
	});

	it("does not take a history note for a daily note", async () => {
		const index = await build({ "2026-10-22": { hrv: 44 } });
		expect(index.hasNote("2026-10-22")).toBe(false);
		expect(new DayIndex(new App() as never, () => settings).hasDay("2026-10-22")).toBe(false);
	});
});
