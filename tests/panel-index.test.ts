// Why it matters: the index is the panel's only data source. It must read just the daily notes it should,
// understand both key styles, ignore junk values and pick up edits, without ever reading a file.
import { describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";

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
		await seedHistory(app, { end: "2026-10-22", days: 4, frontmatter: (ago) => [{ hrv: "62" }, { hrv: Number.NaN }, {}, null][ago] ?? null });
		const index = new DayIndex(app as never, () => settings);
		expect(index.value("hrv", "2026-10-22")).toBeNull();
		expect(index.value("hrv", "2026-10-21")).toBeNull();
		expect(index.value("hrv", "2026-10-20")).toBeNull();
		expect(index.value("hrv", "2026-10-19")).toBeNull();
		expect(index.value("hrv", "2020-01-01")).toBeNull();
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

	it("reads duration strings as minutes", async () => {
		const app = new App();
		await seedHistory(app, { end: "2026-10-22", days: 3, frontmatter: (ago) => [{ sleep_duration: "6h 13min" }, { ohs_sleep_duration: "7h" }, { sleep_duration: 5 }][ago]! });
		const index = new DayIndex(app as never, () => settings);
		expect(index.minutes("sleep_duration", "2026-10-22")).toBe(373);
		expect(index.minutes("sleep_duration", "2026-10-21")).toBe(420);
		expect(index.minutes("sleep_duration", "2026-10-20")).toBeNull();
		expect(index.minutes("sleep_duration", "2020-01-01")).toBeNull();
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
