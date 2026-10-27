// Why it matters: the history notes are the only copy of days that have no daily note. They must round-trip
// without loss, never throw on a file that was touched by hand or by a sync conflict, merge instead of
// overwrite, and never make two devices disagree about the text of the same data.
import { describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { mergeRecord, parseMonth, sameRecord, serializeMonth } from "../src/history/format";
import { recordFromData, recordFromNote } from "../src/history/record";
import { HistoryStore } from "../src/history/store";
import { importFromNotes } from "../src/history/import";

const FILE = "Daily/Garmin history/Garmin history 2026-10.md";
const store = (app: App, dailyNotePath = "Daily"): HistoryStore => new HistoryStore(app as never, { dailyNotePath });
const lineOf = (app: App, path = FILE): string[] => app.vault.text(path).split("\n").filter((l) => /^\d{4}-/.test(l));

describe("month notes", () => {
	it("writes the days oldest first, one line each, with the keys in a fixed order", () => {
		const days = new Map([
			["2026-10-02", { steps: 5, hrv: 40 }],
			["2026-10-01", { z: [{ b: 2, a: 1 }], hrv: 41, gone: undefined }],
		]);
		const text = serializeMonth("2026-10", days);
		expect(text.startsWith("---\ngarmin-history: 1\n---\n")).toBe(true);
		expect(text).toContain("```garmin-history\n2026-10-01 {\"hrv\":41,\"z\":[{\"a\":1,\"b\":2}]}\n2026-10-02 {\"hrv\":40,\"steps\":5}\n```");
	});

	it("reads back what it wrote", () => {
		const days = new Map<string, Record<string, unknown>>([["2026-10-01", { hrv: 41, sleep_duration: "6h 24min", trainings: [{ type: "running", duration_min: 30 }] }]]);
		expect(parseMonth(serializeMonth("2026-10", days))).toEqual(days);
	});

	it("ignores every line that is not a day, instead of failing", () => {
		const text = ["# title", "<<<<<<< conflict", "2026-10-01 {broken}", "2026-10-02 [1,2]", "2026-10-03 \"text\"", "2026-10-04 {\"hrv\":40}", "garbage 2026-10-05 {\"hrv\":1}"].join("\n");
		expect([...parseMonth(text).keys()]).toEqual(["2026-10-04"]);
	});

	it("merges a date that appears twice, the later line winning key by key", () => {
		const text = "2026-10-01 {\"a\":1,\"b\":1}\n2026-10-01 {\"b\":2}";
		expect(parseMonth(text).get("2026-10-01")).toEqual({ a: 1, b: 2 });
	});

	it("compares records regardless of key order", () => {
		expect(sameRecord({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
		expect(sameRecord({ a: 1 }, { a: 2 })).toBe(false);
	});

	it("merges records key by key and joins the lists of requested metrics", () => {
		expect(mergeRecord(undefined, { a: 1 })).toEqual({ a: 1 });
		expect(mergeRecord({ a: 1, _m: ["hrv"] }, { b: 2, _m: ["steps", "hrv"] })).toEqual({ a: 1, b: 2, _m: ["hrv", "steps"] });
		expect(mergeRecord({ a: 1 }, { _m: ["hrv"] })).toEqual({ a: 1, _m: ["hrv"] });
		expect(mergeRecord({ a: 1, _m: ["hrv"] }, { a: 2 })).toEqual({ a: 2, _m: ["hrv"] });
	});
});

describe("records", () => {
	it("keeps a fetched day as it came, with the training list and the requested metrics sorted", () => {
		const data = { metrics: { hrv: 40 }, activities: { running: "30min" }, trainings: [{ type: "running", category: "running", duration_min: 30 }] };
		expect(recordFromData(data, ["steps", "hrv"])).toEqual({ hrv: 40, running: "30min", trainings: data.trainings, _m: ["hrv", "steps"] });
		expect(recordFromData({ metrics: { hrv: 40 }, activities: {}, trainings: [] }, [])).toEqual({ hrv: 40, _m: [] });
		expect(recordFromData({ metrics: {}, activities: {} }, ["hrv"])).toEqual({ _m: ["hrv"] });
	});

	it("takes the Garmin values out of a note and leaves the user's properties", () => {
		const note = { tags: ["x"], title: "Mon", ohs_hrv: 40, steps: 9000, sleep_duration: "6h 24min", running: "30min · Ø150 bpm", workout_location: "Park", distance_mi: 3.1, trainings: [{ type: "running" }], mood: "good", hiking: "no data" };
		expect(recordFromNote(note)).toEqual({ hrv: 40, steps: 9000, sleep_duration: "6h 24min", running: "30min · Ø150 bpm", distance_mi: 3.1, trainings: [{ type: "running" }] });
	});

	it("gives nothing for a note without Garmin values, or with values of the wrong kind", () => {
		expect(recordFromNote({ tags: ["x"] })).toBeNull();
		expect(recordFromNote({ hrv: [1], trainings: "none", distance_mi: {} })).toBeNull();
	});
});

describe("the history store", () => {
	it("recognises history notes, also a conflict copy, and nothing else", () => {
		const s = store(new App());
		const file = (name: string) => ({ name }) as never;
		expect(s.isHistoryFile(file("Garmin history 2026-10.md"))).toBe(true);
		expect(s.isHistoryFile(file("Garmin history 2026-10 (conflicted copy).md"))).toBe(true);
		expect(s.isHistoryFile(file("Garmin history 2026-10.txt"))).toBe(false);
		expect(s.isHistoryFile(file("Garmin history 2026-100.md"))).toBe(false);
		expect(s.isHistoryFile(file("2026-10-22.md"))).toBe(false);
	});

	it("creates the folder and the month note on the first write, next to the daily notes", async () => {
		const app = new App();
		await store(app).put("2026-10-22", { hrv: 40 });
		expect(app.vault.log.filter((l) => l.op === "createFolder").map((l) => l.path)).toEqual(["Daily", "Daily/Garmin history"]);
		expect(lineOf(app)).toEqual(['2026-10-22 {"hrv":40}']);
		const root = new App();
		await store(root, "").put("2026-10-22", { hrv: 40 });
		expect(root.vault.paths()).toEqual(["Garmin history/Garmin history 2026-10.md"]);
	});

	it("adds days to the note, keeps the others and merges a day that is there", async () => {
		const app = new App();
		const s = store(app);
		await s.put("2026-10-22", { hrv: 40, steps: 1 });
		await s.put("2026-10-21", { hrv: 39 });
		await s.put("2026-10-22", { steps: 2, spo2: 95 });
		expect(lineOf(app)).toEqual(['2026-10-21 {"hrv":39}', '2026-10-22 {"hrv":40,"spo2":95,"steps":2}']);
	});

	it("leaves the note as it is when nothing changed", async () => {
		const app = new App();
		const s = store(app);
		await s.put("2026-10-22", { hrv: 40 });
		const before = app.vault.text(FILE);
		await s.put("2026-10-22", { hrv: 40 });
		expect(app.vault.text(FILE)).toBe(before);
	});

	it("writes one note per month and keeps writers from racing", async () => {
		const app = new App();
		const s = store(app);
		await Promise.all([
			s.putMany(new Map([["2026-09-30", { a: 1 }], ["2026-10-01", { a: 2 }]])),
			s.put("2026-10-02", { a: 3 }),
			s.put("2026-10-03", { a: 4 }),
		]);
		expect(lineOf(app, "Daily/Garmin history/Garmin history 2026-09.md")).toEqual(['2026-09-30 {"a":1}']);
		expect(lineOf(app)).toEqual(['2026-10-01 {"a":2}', '2026-10-02 {"a":3}', '2026-10-03 {"a":4}']);
	});

	it("goes on with the next write after one failed", async () => {
		const app = new App();
		const s = store(app);
		await s.put("2026-10-22", { a: 1 });
		let failures = 1;
		app.vault.failOn = (op) => (op === "process" && failures-- > 0 ? new Error("disk") : null);
		await expect(s.put("2026-10-23", { a: 2 })).rejects.toThrow("disk");
		await s.put("2026-10-24", { a: 3 });
		expect(lineOf(app)).toEqual(['2026-10-22 {"a":1}', '2026-10-24 {"a":3}']);
	});

	it("reads the months of a range into the cache, which then answers synchronously", async () => {
		const app = new App();
		app.vault.seed(FILE, serializeMonth("2026-10", new Map([["2026-10-22", { hrv: 40 }]])));
		app.vault.seed("Daily/Garmin history/Garmin history 2026-09.md", serializeMonth("2026-09", new Map([["2026-09-30", { hrv: 39 }]])));
		const s = store(app);
		expect(s.get("2026-10-22")).toBeNull();
		expect(s.covers("2026-09-30", "2026-10-22")).toBe(false);
		expect(await s.warm("2026-09-30", "2026-10-22")).toBe(true);
		expect(s.covers("2026-09-30", "2026-10-22")).toBe(true);
		expect(s.get("2026-10-22")).toEqual({ hrv: 40 });
		expect(s.has("2026-09-30")).toBe(true);
		expect(s.has("2026-10-21")).toBe(false);
	});

	it("reports no note found and does not look again for a month without one", async () => {
		const app = new App();
		const s = store(app);
		expect(await s.warm("2026-08-01", "2026-12-31")).toBe(false);
		expect(s.covers("2026-08-01", "2026-12-31")).toBe(true);
		expect(await s.warm("2026-12-01", "2027-01-31")).toBe(false);
		expect(s.covers("2026-12-01", "2027-01-31")).toBe(true);
	});

	it("merges a sync conflict copy into its month", async () => {
		const app = new App();
		app.vault.seed(FILE, serializeMonth("2026-10", new Map([["2026-10-21", { a: 1 }], ["2026-10-22", { a: 1 }]])));
		app.vault.seed("Elsewhere/Garmin history 2026-10 (conflict).md", serializeMonth("2026-10", new Map([["2026-10-22", { b: 2 }], ["2026-10-23", { a: 3 }]])));
		const s = store(app);
		await s.warm("2026-10-01", "2026-10-31");
		expect(s.get("2026-10-22")).toEqual({ a: 1, b: 2 });
		expect(s.get("2026-10-23")).toEqual({ a: 3 });
	});

	it("reads a month again after its note changed, and forgets everything on request", async () => {
		const app = new App();
		app.vault.seed(FILE, serializeMonth("2026-10", new Map([["2026-10-22", { hrv: 40 }]])));
		const s = store(app);
		await s.warm("2026-10-01", "2026-10-31");
		app.vault.overwrite(FILE, serializeMonth("2026-10", new Map([["2026-10-22", { hrv: 41 }]])));
		expect(s.get("2026-10-22")).toEqual({ hrv: 40 });
		s.invalidate(app.vault.getAbstractFileByPath(FILE) as never);
		expect(s.covers("2026-10-01", "2026-10-31")).toBe(false);
		await s.warm("2026-10-01", "2026-10-31");
		expect(s.get("2026-10-22")).toEqual({ hrv: 41 });
		s.invalidate({ name: "2026-10-22.md" } as never);
		expect(s.covers("2026-10-01", "2026-10-31")).toBe(false);
		await s.warm("2026-10-01", "2026-10-31");
		s.invalidate();
		expect(s.covers("2026-10-01", "2026-10-31")).toBe(false);
	});

	it("drops what it had read of a month after writing to it", async () => {
		const app = new App();
		const s = store(app);
		await s.put("2026-10-22", { hrv: 40 });
		await s.warm("2026-10-01", "2026-10-31");
		expect(s.get("2026-10-22")).toEqual({ hrv: 40 });
		await s.put("2026-10-23", { hrv: 41 });
		expect(s.get("2026-10-23")).toBeNull();
		await s.warm("2026-10-01", "2026-10-31");
		expect(s.get("2026-10-23")).toEqual({ hrv: 41 });
	});
});

describe("importing the daily notes", () => {
	const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };

	it("copies the Garmin values of every daily note into the history and leaves the rest", async () => {
		const app = new App();
		await seedHistory(app, { end: "2026-10-22", days: 3, frontmatter: (ago) => (ago === 1 ? { tags: ["x"] } : { hrv: 40 + ago, mood: "good" }) });
		app.vault.seed("Notes/idea.md", "text");
		const s = store(app, "");
		expect(await importFromNotes(app as never, s, settings)).toBe(2);
		expect(lineOf(app, "Garmin history/Garmin history 2026-10.md")).toEqual(['2026-10-20 {"hrv":42}', '2026-10-22 {"hrv":40}']);
	});

	it("does not count the history notes themselves and writes nothing when there is nothing to copy", async () => {
		const app = new App();
		app.vault.seed("Garmin history/Garmin history 2026-10.md", serializeMonth("2026-10", new Map([["2026-10-22", { hrv: 40 }]])));
		app.metadataCache.frontmatter.set("Garmin history/Garmin history 2026-10.md", { "garmin-history": 1, hrv: 99 });
		const before = app.vault.log.length;
		expect(await importFromNotes(app as never, store(app, ""), settings)).toBe(0);
		expect(app.vault.log.length).toBe(before);
	});
});

describe("history notes that lie elsewhere", () => {
	const OLD = "Journal/2026/Garmin history/Garmin history 2026-10.md";
	const NEW = "Journal/2027/Garmin history/Garmin history 2026-10.md";
	const month = (...days: [string, Record<string, unknown>][]): string => serializeMonth("2026-10", new Map(days));

	it("are moved into the history folder of the current daily notes folder, content and all, and the emptied folder goes", async () => {
		const app = new App();
		app.vault.seed(OLD, month(["2026-10-01", { a: 1 }]));
		app.vault.seed("Journal/2026/Garmin history/Garmin history 2026-09.md", serializeMonth("2026-09", new Map([["2026-09-30", { a: 2 }]])));
		app.vault.seed("Journal/2027/2027-01-01.md", "note");
		const s = store(app, "Journal/2027");
		expect(await s.relocate()).toBe(2);
		expect(app.vault.paths()).toEqual(["Journal/2027/2027-01-01.md", "Journal/2027/Garmin history/Garmin history 2026-09.md", NEW]);
		expect(app.vault.text(NEW)).toContain('2026-10-01 {"a":1}');
		expect(app.vault.getAbstractFileByPath("Journal/2026/Garmin history")).toBeNull();
		expect(app.vault.getAbstractFileByPath("Journal/2026")).not.toBeNull();
		expect(await s.relocate()).toBe(0);
	});

	it("leave a folder that was not made for them where it is, and come from the root when there is no daily notes folder", async () => {
		const app = new App();
		app.vault.seed("Archive/Garmin history 2026-10.md", month(["2026-10-01", { a: 1 }]));
		const s = store(app, "");
		expect(await s.relocate()).toBe(1);
		expect(app.vault.paths()).toEqual(["Garmin history/Garmin history 2026-10.md"]);
		expect(app.vault.getAbstractFileByPath("Archive")).not.toBeNull();
	});

	it("stay when their place is taken, and the one that is in place gets the next write", async () => {
		const app = new App();
		app.vault.seed(OLD, month(["2026-10-01", { a: 1 }]));
		app.vault.seed(NEW, month(["2026-10-02", { a: 2 }]));
		app.vault.seed("Other/Garmin history/Garmin history 2026-10.md", month(["2026-10-03", { a: 3 }]));
		const s = store(app, "Journal/2027");
		expect(await s.relocate()).toBe(0);
		await s.put("2026-10-04", { a: 4 });
		expect(lineOf(app, NEW)).toEqual(['2026-10-02 {"a":2}', '2026-10-04 {"a":4}']);
		expect(lineOf(app, OLD)).toEqual(['2026-10-01 {"a":1}']);
		await s.warm("2026-10-01", "2026-10-31");
		expect([1, 2, 3, 4].map((d) => s.has(`2026-10-0${d}`))).toEqual([true, true, true, true]);
	});

	it("moves only one of two notes with the same name and keeps the other", async () => {
		const app = new App();
		app.vault.seed("A/Garmin history/Garmin history 2026-10.md", month(["2026-10-01", { a: 1 }]));
		app.vault.seed("B/Garmin history/Garmin history 2026-10.md", month(["2026-10-02", { a: 2 }]));
		expect(await store(app, "C").relocate()).toBe(1);
		expect(app.vault.paths().filter((p) => p.startsWith("C/"))).toHaveLength(1);
		expect(app.vault.paths()).toHaveLength(2);
	});

	it("are merged into by the next write instead of a second note being started", async () => {
		const app = new App();
		app.vault.seed(OLD, month(["2026-10-01", { a: 1 }]));
		await store(app, "Journal/2027").put("2026-10-02", { a: 2 });
		expect(app.vault.paths()).toEqual([NEW]);
		expect(lineOf(app, NEW)).toEqual(['2026-10-01 {"a":1}', '2026-10-02 {"a":2}']);
	});

	it("do not stop later writes when a move fails", async () => {
		const app = new App();
		app.vault.seed(OLD, month(["2026-10-01", { a: 1 }]));
		const s = store(app, "Journal/2027");
		app.vault.failOn = (op) => (op === "rename" ? new Error("locked") : null);
		await expect(s.relocate()).rejects.toThrow("locked");
		app.vault.failOn = null;
		await s.put("2026-10-02", { a: 2 });
		expect(lineOf(app, NEW)).toEqual(['2026-10-01 {"a":1}', '2026-10-02 {"a":2}']);
	});

	it("also move when the notes are read after a move, because what was read before is dropped", async () => {
		const app = new App();
		app.vault.seed(OLD, month(["2026-10-01", { a: 1 }]));
		const s = store(app, "Journal/2027");
		await s.warm("2026-10-01", "2026-10-31");
		await s.relocate();
		expect(s.covers("2026-10-01", "2026-10-31")).toBe(false);
		await s.warm("2026-10-01", "2026-10-31");
		expect(s.get("2026-10-01")).toEqual({ a: 1 });
	});
});
