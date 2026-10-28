// Why it matters: this module writes into the user's own notes. It must find the right note, never
// damage existing content (body, other properties, line endings), never rewrite a note that already
// matches, and refuse to touch a note whose frontmatter it cannot parse. Whole files are asserted.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "../testUtils/mocks/obsidian";
import { App, Notice, moment, network as net, parseYaml } from "../testUtils/mocks/obsidian";
import { dailyNoteExists, matchDailyNoteDate, writeToDailyNote } from "../src/daily-note";
import type { HealthData } from "../src/providers/provider";

type Options = Parameters<typeof writeToDailyNote>[3];

const DATE = "2026-10-24";
const BACKUP_DIR = "_garmin-health-sync/backups";

let app: App;
let vault: App["vault"];

const asApp = (): never => app as never;
const health = (patch: Partial<HealthData> = {}): HealthData => ({
	metrics: { steps: 8000, sleep_duration: "7h 30min" },
	activities: {},
	...patch,
});
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
/** The parsed frontmatter of a file in the test vault. */
function frontmatter(path: string): Record<string, unknown> {
	const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(vault.text(path));
	return (parseYaml(m?.[1] ?? "") ?? {}) as Record<string, unknown>;
}
const note = `Daily/${DATE}.md`;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-25T08:09:10"));
	app = new App();
	vault = app.vault;
});

describe("finding the note", () => {
	it("writes into the note at the exact path", async () => {
		vault.seed(note, "Body\n");
		await writeToDailyNote(asApp(), DATE, health(), opts());
		expect(vault.paths()).toEqual([note]);
		expect(frontmatter(note)).toEqual({ steps: 8000, sleep_duration: "7h 30min" });
	});

	it("searches sibling folders until it finds the note (a folder without it is skipped)", async () => {
		vault.seed("Daily/a/other.md", "x");
		vault.seed("Daily/b/deeper/more.md", "x");
		vault.seed(`Daily/c/${DATE}.md`, "Body\n");
		await writeToDailyNote(asApp(), DATE, health(), opts());
		expect(frontmatter(`Daily/c/${DATE}.md`)).toMatchObject({ steps: 8000 });
		expect(vault.paths()).toHaveLength(3);
	});

	it("finds the note in a subfolder when the format has no slash", async () => {
		vault.seed(`Daily/2026/October/${DATE}.md`, "Body\n");
		await writeToDailyNote(asApp(), DATE, health(), opts());
		expect(vault.paths()).toEqual([`Daily/2026/October/${DATE}.md`]);
		expect(vault.modifyCount()).toBe(1);
	});

	it("does not pick a same-named note elsewhere when the format pins a subfolder", async () => {
		vault.seed(`Daily/Other/${DATE}.md`, "Elsewhere\n");
		await writeToDailyNote(asApp(), DATE, health(), opts({ dailyNoteFormat: "YYYY/YYYY-MM-DD" }));
		expect(vault.text(`Daily/Other/${DATE}.md`)).toBe("Elsewhere\n");
		expect(vault.paths()).toContain(`Daily/2026/${DATE}.md`);
	});

	it("finds a note at the exact pinned subfolder path", async () => {
		vault.seed(`Daily/2026/${DATE}.md`, "Body\n");
		await writeToDailyNote(asApp(), DATE, health(), opts({ dailyNoteFormat: "YYYY/YYYY-MM-DD" }));
		expect(vault.paths()).toEqual([`Daily/2026/${DATE}.md`]);
		expect(vault.modifyCount()).toBe(1);
	});

	it("works with an empty folder setting (vault root) and with slashes around it", async () => {
		vault.seed(`${DATE}.md`, "Root note\n");
		await writeToDailyNote(asApp(), DATE, health(), opts({ dailyNotePath: "" }));
		expect(frontmatter(`${DATE}.md`)).toMatchObject({ steps: 8000 });

		vault.seed(`Journal/${DATE}.md`, "Journal note\n");
		await writeToDailyNote(asApp(), DATE, health(), opts({ dailyNotePath: "/Journal/" }));
		expect(frontmatter(`Journal/${DATE}.md`)).toMatchObject({ steps: 8000 });
	});

	it("formats the file name with any moment token, including weekday and month names", async () => {
		vault.seed("Daily/2026-10-24 Sat.md", "Body\n");
		await writeToDailyNote(asApp(), DATE, health(), opts({ dailyNoteFormat: "YYYY-MM-DD ddd" }));
		expect(vault.paths()).toEqual(["Daily/2026-10-24 Sat.md"]);
		vault.seed("Daily/24 Oct 2026.md", "Body\n");
		await writeToDailyNote(asApp(), DATE, health(), opts({ dailyNoteFormat: "D MMM YYYY" }));
		expect(frontmatter("Daily/24 Oct 2026.md")).toMatchObject({ steps: 8000 });
	});
});

describe("creating the note", () => {
	it("creates a missing note with the template as its body and the properties on top", async () => {
		await writeToDailyNote(asApp(), DATE, health(), opts({ template: "# Today\n\nNotes\n" }));
		expect(vault.text(note)).toMatch(/^---\nsteps: 8000\nsleep_duration: 7h 30min\n---\n# Today\n\nNotes\n$/);
	});

	it("creates an empty note when there is no template", async () => {
		await writeToDailyNote(asApp(), DATE, health(), opts());
		expect(vault.text(note)).toBe("---\nsteps: 8000\nsleep_duration: 7h 30min\n---\n");
	});

	it("creates every missing folder level from the setting and the format", async () => {
		await writeToDailyNote(asApp(), DATE, health(), opts({ dailyNotePath: "A/B", dailyNoteFormat: "YYYY/MM/YYYY-MM-DD" }));
		expect(vault.paths()).toEqual([`A/B/2026/10/${DATE}.md`]);
		expect(vault.log.filter((l) => l.op === "createFolder").map((l) => l.path)).toEqual(["A", "A/B", "A/B/2026", "A/B/2026/10"]);
	});

	it("reuses folders that already exist", async () => {
		vault.seed("A/keep.md", "x");
		await writeToDailyNote(asApp(), DATE, health(), opts({ dailyNotePath: "A" }));
		expect(vault.log.filter((l) => l.op === "createFolder")).toEqual([]);
		expect(vault.paths()).toEqual([`A/${DATE}.md`, "A/keep.md"]);
	});

	it("creates the note in the vault root for an empty folder setting", async () => {
		await writeToDailyNote(asApp(), DATE, health(), opts({ dailyNotePath: "" }));
		expect(vault.paths()).toEqual([`${DATE}.md`]);
	});

	it("creates nothing and reports false when creation is off", async () => {
		const written = await writeToDailyNote(asApp(), DATE, health(), opts({ createIfMissing: false }));
		expect(written).toBe(false);
		expect(vault.paths()).toEqual([]);
		expect(vault.log).toEqual([]);
	});
});

describe("existence checks", () => {
	const o = { dailyNotePath: "Daily", dailyNoteFormat: "YYYY-MM-DD" };

	it("is true for a note with content, also deeper in the folder", () => {
		vault.seed(`Daily/x/${DATE}.md`, "text");
		expect(dailyNoteExists(asApp(), DATE, o)).toBe(true);
	});

	it("is false for a missing note and for another date", () => {
		vault.seed("Daily/2026-10-23.md", "text");
		expect(dailyNoteExists(asApp(), DATE, o)).toBe(false);
	});

	it("treats a 0-byte placeholder as not existing (the Calendar plugin creates those)", () => {
		vault.seed(note, "");
		expect(dailyNoteExists(asApp(), DATE, o)).toBe(false);
	});

	it("is false when the folder does not exist", () => {
		expect(dailyNoteExists(asApp(), DATE, o)).toBe(false);
	});

	it("only finds a pinned-subfolder note at its exact path", () => {
		vault.seed(`Daily/Other/${DATE}.md`, "text");
		expect(dailyNoteExists(asApp(), DATE, { ...o, dailyNoteFormat: "YYYY/YYYY-MM-DD" })).toBe(false);
		vault.seed(`Daily/2026/${DATE}.md`, "text");
		expect(dailyNoteExists(asApp(), DATE, { ...o, dailyNoteFormat: "YYYY/YYYY-MM-DD" })).toBe(true);
	});
});

describe("matching a changed file to its date", () => {
	const o = { dailyNotePath: "Daily", dailyNoteFormat: "YYYY-MM-DD" };
	const candidates = ["2026-10-22", "2026-10-23", DATE];

	it("returns the date whose note the file is", () => {
		const file = vault.seed(`Daily/${DATE}.md`, "text");
		expect(matchDailyNoteDate(file, candidates, o)).toBe(DATE);
	});

	it("matches a same-named file deeper in the folder", () => {
		const file = vault.seed(`Daily/2026/${DATE}.md`, "text");
		expect(matchDailyNoteDate(file, candidates, o)).toBe(DATE);
	});

	it("ignores files outside the daily notes folder, other dates and other names", () => {
		expect(matchDailyNoteDate(vault.seed(`Elsewhere/${DATE}.md`, "text"), candidates, o)).toBeNull();
		expect(matchDailyNoteDate(vault.seed("Daily/2026-01-01.md", "text"), candidates, o)).toBeNull();
		expect(matchDailyNoteDate(vault.seed("Daily/readme.md", "text"), candidates, o)).toBeNull();
	});

	it("ignores an empty placeholder", () => {
		expect(matchDailyNoteDate(vault.seed(`Daily/${DATE}.md`, ""), candidates, o)).toBeNull();
	});

	it("handles an empty folder setting", () => {
		const file = vault.seed(`${DATE}.md`, "text");
		expect(matchDailyNoteDate(file, candidates, { ...o, dailyNotePath: "" })).toBe(DATE);
	});

	it("only matches the exact path when the format pins a subfolder", () => {
		const f = { ...o, dailyNoteFormat: "YYYY/YYYY-MM-DD" };
		expect(matchDailyNoteDate(vault.seed(`Daily/2026/${DATE}.md`, "text"), candidates, f)).toBe(DATE);
		expect(matchDailyNoteDate(vault.seed(`Daily/Other/${DATE}.md`, "text"), candidates, f)).toBeNull();
	});

	it("agrees with dailyNoteExists for weekday, month, literal and slash formats", () => {
		for (const format of ["YYYY-MM-DD ddd", "D MMM YYYY", "[Journal] YYYY-MM-DD", "YYYY/YYYY-MM-DD", "YYYY-MM-DD"]) {
			const other = new App();
			const path = `Daily/${formatFor(DATE, format)}.md`;
			const file = other.vault.seed(path, "text");
			const o2 = { dailyNotePath: "Daily", dailyNoteFormat: format };
			expect(dailyNoteExists(other as never, DATE, o2), format).toBe(true);
			expect(matchDailyNoteDate(file, [DATE], o2), format).toBe(DATE);
		}
	});
});

/** Same formatting the plugin uses (moment), without importing the module under test. */
function formatFor(date: string, format: string): string {
	return (moment as unknown as (d: string, f: string) => { format(f: string): string })(date, "YYYY-MM-DD").format(format);
}

describe("frontmatter handling", () => {
	it("adds frontmatter on top of a note without any and keeps the body byte for byte", async () => {
		const body = "# Title\n\nSome text with --- in it\n---\nmore\n";
		vault.seed(note, body);
		await writeToDailyNote(asApp(), DATE, health(), opts());
		expect(vault.text(note)).toBe(`---\nsteps: 8000\nsleep_duration: 7h 30min\n---\n${body}`);
	});

	it("fills an empty file with just the frontmatter", async () => {
		vault.seed(note, "");
		await writeToDailyNote(asApp(), DATE, health(), opts());
		expect(vault.text(note)).toBe("---\nsteps: 8000\nsleep_duration: 7h 30min\n---\n");
	});

	it("keeps the user's properties and body, and updates only the synced keys", async () => {
		vault.seed(note, "---\ntags:\n  - daily\nmood: good\nsteps: 100\n---\nBody line\n\n---\nrule above\n");
		await writeToDailyNote(asApp(), DATE, health(), opts());
		expect(frontmatter(note)).toEqual({ tags: ["daily"], mood: "good", steps: 8000, sleep_duration: "7h 30min" });
		expect(vault.text(note).endsWith("---\nBody line\n\n---\nrule above\n")).toBe(true);
	});

	it("handles frontmatter that ends with a block sequence", async () => {
		vault.seed(note, "---\nmood: ok\nbook_titles:\n  - '[[A]]'\n  - '[[B]]'\n---\nBody\n");
		await writeToDailyNote(asApp(), DATE, health(), opts());
		expect(frontmatter(note)).toEqual({
			mood: "ok",
			book_titles: ["[[A]]", "[[B]]"],
			steps: 8000,
			sleep_duration: "7h 30min",
		});
		expect(vault.text(note).endsWith("---\nBody\n")).toBe(true);
	});

	it("treats empty frontmatter (--- directly followed by ---) as an empty object", async () => {
		vault.seed(note, "---\n---\nBody\n");
		await writeToDailyNote(asApp(), DATE, health(), opts());
		expect(vault.text(note)).toBe("---\nsteps: 8000\nsleep_duration: 7h 30min\n---\nBody\n");
	});

	it("keeps Windows line endings throughout", async () => {
		vault.seed(note, "---\r\nmood: ok\r\n---\r\nBody\r\nline two\r\n");
		await writeToDailyNote(asApp(), DATE, health(), opts());
		const out = vault.text(note);
		expect(out).toBe("---\r\nmood: ok\r\nsteps: 8000\r\nsleep_duration: 7h 30min\r\n---\r\nBody\r\nline two\r\n");
		expect(out.replace(/\r\n/g, "")).not.toMatch(/\n/);
	});

	it("uses Windows line endings for the new block when the body has them", async () => {
		vault.seed(note, "Body\r\nline two\r\n");
		await writeToDailyNote(asApp(), DATE, health(), opts());
		expect(vault.text(note)).toBe("---\r\nsteps: 8000\r\nsleep_duration: 7h 30min\r\n---\r\nBody\r\nline two\r\n");
	});

	it("does not mistake a horizontal rule on the first line of the body for frontmatter", async () => {
		vault.seed(note, "Text first\n---\nnot frontmatter\n---\n");
		await writeToDailyNote(asApp(), DATE, health(), opts());
		expect(vault.text(note).endsWith("---\nText first\n---\nnot frontmatter\n---\n")).toBe(true);
		expect(frontmatter(note)).toEqual({ steps: 8000, sleep_duration: "7h 30min" });
	});
});

describe("damaged frontmatter", () => {
	const cases: [string, string][] = [
		["invalid YAML", "---\nkey: [unclosed\n---\nBody\n"],
		["a list instead of properties", "---\n- a\n- b\n---\nBody\n"],
		["a scalar instead of properties", "---\njust text\n---\nBody\n"],
		["no closing marker", "---\nmood: ok\nBody without end\n"],
		["only the opening line", "---\n"],
	];

	it.each(cases)("leaves the note untouched for %s, writes a backup and says so", async (_label, content) => {
		vault.seed(note, content);
		const written = await writeToDailyNote(asApp(), DATE, health(), opts());
		expect(written).toBe(false);
		expect(vault.text(note)).toBe(content);
		expect(vault.modifyCount()).toBe(0);
		const backups = vault.paths().filter((p) => p.startsWith(BACKUP_DIR));
		expect(backups).toEqual([`${BACKUP_DIR}/${DATE}.2026-10-25T08-09-10.md`]);
		const backup = vault.text(backups[0] as string);
		expect(backup.endsWith(`-->\n${content}`)).toBe(true);
		expect(backup).toContain(`Original: ${note}`);
		expect(Notice.recorded).toHaveLength(1);
		expect(Notice.recorded[0]?.duration).toBe(15000);
	});

	it("still reports false and shows the notice when the backup cannot be written", async () => {
		vault.seed(note, "---\nkey: [unclosed\n---\nBody\n");
		vault.failOn = (op, path) => (op === "create" && path.startsWith(BACKUP_DIR) ? new Error("disk full") : null);
		const written = await writeToDailyNote(asApp(), DATE, health(), opts());
		expect(written).toBe(false);
		expect(vault.text(note)).toBe("---\nkey: [unclosed\n---\nBody\n");
		expect(Notice.recorded).toHaveLength(1);
	});

	it("does not fail when the backup file already exists (two attempts in the same second)", async () => {
		vault.seed(note, "---\nkey: [unclosed\n---\nBody\n");
		await writeToDailyNote(asApp(), DATE, health(), opts());
		await expect(writeToDailyNote(asApp(), DATE, health(), opts())).resolves.toBe(false);
		expect(Notice.recorded).toHaveLength(2);
	});
});

describe("F6: the broken-frontmatter notice is in the user's language", () => {
	const broken = "---\nkey: [unclosed\n---\nBody\n";

	it("says it in English for English users and names the file", async () => {
		vault.seed(note, broken);
		await writeToDailyNote(asApp(), DATE, health(), opts({ language: "en" }));
		const message = Notice.recorded[0]?.message ?? "";
		expect(message).toContain(note);
		expect(message).toContain(BACKUP_DIR);
		expect(message).toMatch(/frontmatter/i);
		expect(message).not.toMatch(/kaputt|Ein Backup/);
	});

	it.each(["de", "es", "fr", "ja", "zh"])("uses the %s translation, filled in completely", async (lang) => {
		vault.seed(note, broken);
		await writeToDailyNote(asApp(), DATE, health(), opts({ language: lang }));
		const message = Notice.recorded[0]?.message ?? "";
		expect(message).toContain(note);
		expect(message).not.toMatch(/\{[a-z]+\}/);
	});

	it("differs between languages", async () => {
		const messages: string[] = [];
		for (const lang of ["en", "de", "ja"]) {
			vault.seed(`Daily/${lang}.md`, broken);
			Notice.recorded = [];
			await writeToDailyNote(asApp(), "2026-01-01", health(), opts({ language: lang, dailyNoteFormat: `[${lang}]` }));
			messages.push((Notice.recorded[0]?.message ?? "").split(`Daily/${lang}.md`).join("FILE"));
		}
		expect(new Set(messages).size).toBe(3);
	});
});

describe("a YAML parser that fails in an unusual way", () => {
	it("still leaves the note alone and tells the user when the error is not an Error object", async () => {
		const content = "---\nmood: ok\n---\nBody\n";
		vault.seed(note, content);
		const spy = vi.spyOn(obsidian, "parseYaml").mockImplementation(() => {
			throw "plain string failure";
		});
		try {
			expect(await writeToDailyNote(asApp(), DATE, health(), opts())).toBe(false);
		} finally {
			spy.mockRestore();
		}
		expect(vault.text(note)).toBe(content);
		expect(Notice.recorded[0]?.message).toContain("plain string failure");
	});
});

describe("C6: a byte order mark before the frontmatter", () => {
	it("recognises the frontmatter, keeps the mark first and does not add a second block", async () => {
		vault.seed(note, "﻿---\nmood: ok\n---\nBody\n");
		await writeToDailyNote(asApp(), DATE, health(), opts());
		const out = vault.text(note);
		expect(out).toBe("﻿---\nmood: ok\nsteps: 8000\nsleep_duration: 7h 30min\n---\nBody\n");
		expect(out.match(/^﻿?---$/gm)).toHaveLength(2);
	});

	it("does not rewrite a BOM note whose values already match", async () => {
		vault.seed(note, "﻿---\nsteps: 8000\nsleep_duration: 7h 30min\n---\nBody\n");
		expect(await writeToDailyNote(asApp(), DATE, health(), opts())).toBe(false);
		expect(vault.modifyCount()).toBe(0);
	});

	it("keeps a BOM on a note that has none of its own frontmatter yet", async () => {
		vault.seed(note, "﻿Body\n");
		await writeToDailyNote(asApp(), DATE, health(), opts());
		expect(vault.text(note).startsWith("﻿---\nsteps: 8000")).toBe(true);
		expect(vault.text(note).endsWith("---\nBody\n")).toBe(true);
	});
});

describe("C7: a closing marker with trailing whitespace (matches Obsidian, #23)", () => {
	// Not yet verified how Obsidian itself treats "--- " as a closing line. Current behaviour: no closing
	// marker, so the note is left alone, backed up, and the user is told. Pinned so a change is deliberate.
	it("is treated as a missing closing marker: note untouched, backup, notice", async () => {
		const content = "---\nmood: ok\n--- \nBody\n";
		vault.seed(note, content);
		expect(await writeToDailyNote(asApp(), DATE, health(), opts())).toBe(false);
		expect(vault.text(note)).toBe(content);
		expect(Notice.recorded).toHaveLength(1);
	});
});

describe("a note that changes while it is being synced", () => {
	/** Make the file change right after the plugin has read it (an open note being typed in). */
	function changeAfterRead(path: string, change: (current: string) => string): void {
		const read = vault.read.bind(vault);
		let done = false;
		vault.read = async (file) => {
			const content = await read(file);
			if (!done && file.path === path) {
				done = true;
				vault.overwrite(path, change(content));
			}
			return content;
		};
	}

	it("keeps what the user typed in between, and still adds the properties", async () => {
		vault.seed(note, "---\nmood: ok\n---\nBody\n");
		changeAfterRead(note, (c) => `${c}typed while syncing\n`);
		expect(await writeToDailyNote(asApp(), DATE, health(), opts())).toBe(true);
		expect(vault.text(note)).toBe("---\nmood: ok\nsteps: 8000\nsleep_duration: 7h 30min\n---\nBody\ntyped while syncing\n");
	});

	it("keeps a property the user added in between", async () => {
		vault.seed(note, "---\nmood: ok\n---\nBody\n");
		changeAfterRead(note, () => "---\nmood: great\nenergy: 7\n---\nBody\n");
		await writeToDailyNote(asApp(), DATE, health(), opts());
		expect(frontmatter(note)).toEqual({ mood: "great", energy: 7, steps: 8000, sleep_duration: "7h 30min" });
	});

	it("writes nothing when someone else already wrote the same values in between", async () => {
		vault.seed(note, "Body\n");
		changeAfterRead(note, () => "---\nsteps: 8000\nsleep_duration: 7h 30min\n---\nBody\n");
		expect(await writeToDailyNote(asApp(), DATE, health(), opts())).toBe(false);
		expect(vault.modifyCount()).toBe(1); // only the atomic call itself, and it left the content as it found it
		expect(vault.text(note)).toBe("---\nsteps: 8000\nsleep_duration: 7h 30min\n---\nBody\n");
	});

	it("leaves the note alone when it became invalid in between", async () => {
		vault.seed(note, "Body\n");
		changeAfterRead(note, () => "---\nkey: [unclosed\n---\nBody\n");
		expect(await writeToDailyNote(asApp(), DATE, health(), opts())).toBe(false);
		expect(vault.text(note)).toBe("---\nkey: [unclosed\n---\nBody\n");
	});

	it("reports a failure of the atomic write like any other write failure", async () => {
		vault.seed(note, "Body\n");
		vault.failOn = (op) => (op === "process" ? new Error("vault busy") : null);
		await expect(writeToDailyNote(asApp(), DATE, health(), opts())).rejects.toThrow("vault busy");
	});
});

describe("the dirty check", () => {
	it("does not touch the file when every value already matches", async () => {
		vault.seed(note, "---\nsteps: 8000\nsleep_duration: 7h 30min\nmood: ok\n---\nBody\n");
		expect(await writeToDailyNote(asApp(), DATE, health(), opts())).toBe(false);
		expect(vault.modifyCount()).toBe(0);
		expect(vault.text(note)).toBe("---\nsteps: 8000\nsleep_duration: 7h 30min\nmood: ok\n---\nBody\n");
	});

	it("is idempotent: writing the same data twice modifies the file once", async () => {
		vault.seed(note, "Body\n");
		expect(await writeToDailyNote(asApp(), DATE, health(), opts())).toBe(true);
		expect(await writeToDailyNote(asApp(), DATE, health(), opts())).toBe(false);
		expect(vault.modifyCount()).toBe(1);
	});

	it("writes when a single value changed", async () => {
		vault.seed(note, "---\nsteps: 7999\nsleep_duration: 7h 30min\n---\nBody\n");
		expect(await writeToDailyNote(asApp(), DATE, health(), opts())).toBe(true);
		expect(frontmatter(note)).toMatchObject({ steps: 8000 });
	});

	it("writes when a value has a different type (the number 3 versus the text '3')", async () => {
		vault.seed(note, "---\nsteps: '8000'\nsleep_duration: 7h 30min\n---\nBody\n");
		expect(await writeToDailyNote(asApp(), DATE, health(), opts())).toBe(true);
		expect(frontmatter(note)["steps"]).toBe(8000);
	});

	it("compares trainings arrays deeply", async () => {
		const trainings = [{ type: "running", category: "running", distance_km: 8.2, duration_min: 50 }];
		const data = health({ trainings });
		vault.seed(note, "Body\n");
		await writeToDailyNote(asApp(), DATE, data, opts({ writeTrainings: true }));
		expect(await writeToDailyNote(asApp(), DATE, data, opts({ writeTrainings: true }))).toBe(false);
		const changed = health({ trainings: [{ ...trainings[0]!, duration_min: 51 }] });
		expect(await writeToDailyNote(asApp(), DATE, changed, opts({ writeTrainings: true }))).toBe(true);
		const fewer = health({ trainings: [] });
		expect(await writeToDailyNote(asApp(), DATE, fewer, opts({ writeTrainings: true }))).toBe(false);
	});

	it("writes when the trainings length or an entry key differs", async () => {
		vault.seed(note, "Body\n");
		const one = [{ type: "a", category: "x", duration_min: 1 }];
		await writeToDailyNote(asApp(), DATE, health({ trainings: one }), opts({ writeTrainings: true }));
		const two = [...one, { type: "b", category: "y", duration_min: 2 }];
		expect(await writeToDailyNote(asApp(), DATE, health({ trainings: two }), opts({ writeTrainings: true }))).toBe(true);
		const keyed = [{ type: "a", category: "x", calories: 1 }, two[1]!];
		expect(await writeToDailyNote(asApp(), DATE, health({ trainings: keyed }), opts({ writeTrainings: true }))).toBe(true);
	});

	it("writes when an existing trainings entry has a different number of keys", async () => {
		vault.seed(note, "Body\n");
		const base = { type: "a", category: "x" };
		await writeToDailyNote(asApp(), DATE, health({ trainings: [base] }), opts({ writeTrainings: true }));
		expect(await writeToDailyNote(asApp(), DATE, health({ trainings: [{ ...base, calories: 5 }] }), opts({ writeTrainings: true }))).toBe(true);
	});

	it("writes when an existing property is null or a different shape", async () => {
		vault.seed(note, "---\nsteps:\nsleep_duration:\n  - a\n---\nBody\n");
		expect(await writeToDailyNote(asApp(), DATE, health(), opts())).toBe(true);
		expect(frontmatter(note)).toEqual({ steps: 8000, sleep_duration: "7h 30min" });
	});
});

describe("what is written", () => {
	it("prefixes every key, metrics and activities alike", async () => {
		await writeToDailyNote(asApp(), DATE, health({ activities: { running: "5 km" } }), opts({ prefix: "ohs_" }));
		expect(frontmatter(note)).toEqual({ ohs_steps: 8000, ohs_sleep_duration: "7h 30min", ohs_running: "5 km" });
	});

	it("writes trainings only when enabled and present", async () => {
		const trainings = [{ type: "running", category: "running", duration_min: 30 }];
		await writeToDailyNote(asApp(), "2026-01-01", health({ trainings }), opts({ writeTrainings: false, dailyNoteFormat: "[off]" }));
		expect(frontmatter("Daily/off.md")).not.toHaveProperty("trainings");
		await writeToDailyNote(asApp(), "2026-01-01", health({ trainings: [] }), opts({ writeTrainings: true, dailyNoteFormat: "[empty]" }));
		expect(frontmatter("Daily/empty.md")).not.toHaveProperty("trainings");
		await writeToDailyNote(asApp(), "2026-01-01", health(), opts({ writeTrainings: true, dailyNoteFormat: "[none]" }));
		expect(frontmatter("Daily/none.md")).not.toHaveProperty("trainings");
		await writeToDailyNote(asApp(), "2026-01-01", health({ trainings }), opts({ writeTrainings: true, dailyNoteFormat: "[on]" }));
		expect(frontmatter("Daily/on.md")["trainings"]).toEqual(trainings);
	});

	it("prefixes the trainings key", async () => {
		const trainings = [{ type: "running", category: "running" }];
		await writeToDailyNote(asApp(), DATE, health({ trainings }), opts({ writeTrainings: true, prefix: "ohs_" }));
		expect(frontmatter(note)).toHaveProperty("ohs_trainings");
	});

	it("looks up and writes the workout location only when enabled and a start location exists", async () => {
		network();
		const withGps = health({ startLocation: { lat: 50.64, lon: 7.23 } });
		await writeToDailyNote(asApp(), DATE, withGps, opts({ writeWorkoutLocation: true }));
		expect(frontmatter(note)["workout_location"]).toBe("Bad Honnef, Germany");

		await writeToDailyNote(asApp(), "2026-01-02", withGps, opts({ writeWorkoutLocation: false, dailyNoteFormat: "[off]" }));
		expect(frontmatter("Daily/off.md")).not.toHaveProperty("workout_location");

		await writeToDailyNote(asApp(), "2026-01-03", health(), opts({ writeWorkoutLocation: true, dailyNoteFormat: "[nogps]" }));
		expect(frontmatter("Daily/nogps.md")).not.toHaveProperty("workout_location");
	});

	it("writes no location when the lookup finds nothing", async () => {
		geo({ status: 200, body: { address: {} } });
		await writeToDailyNote(asApp(), DATE, health({ startLocation: { lat: 0, lon: 0 } }), opts({ writeWorkoutLocation: true }));
		expect(frontmatter(note)).not.toHaveProperty("workout_location");
	});

	it("prefixes the location key", async () => {
		network();
		await writeToDailyNote(asApp(), DATE, health({ startLocation: { lat: 1, lon: 2 } }), opts({ writeWorkoutLocation: true, prefix: "ohs_" }));
		expect(frontmatter(note)).toHaveProperty("ohs_workout_location");
	});
});

// --- helpers that need the network mock ------------------------------------------------------

function geo(reply: { status: number; body: unknown }): void {
	net.on(/nominatim/, reply);
}
function network(): void {
	geo({ status: 200, body: { address: { town: "Bad Honnef", country: "Germany" } } });
}

describe("another writer is faster than the sync", () => {
	it("writes into the note that appeared between the check and the create (Templater, a periodic notes plugin, another device)", async () => {
		vault.failOn = (op, path) => {
			if (op !== "create" || path !== note) return null;
			vault.failOn = null;
			vault.seed(note, "---\nmood: ok\n---\nBody\n");
			return new Error("File already exists.");
		};
		await vault.createFolder("Daily");
		expect(await writeToDailyNote(asApp(), DATE, health(), opts())).toBe(true);
		expect(frontmatter(note)).toMatchObject({ mood: "ok", steps: 8000 });
		expect(vault.text(note)).toContain("Body");
	});

	it("reports the error when the create fails and no note is there", async () => {
		vault.failOn = (op, path) => (op === "create" && path === note ? new Error("disk full") : null);
		await vault.createFolder("Daily");
		await expect(writeToDailyNote(asApp(), DATE, health(), opts())).rejects.toThrow("disk full");
	});

	it("goes on when the folder was made in the meantime, and fails when it was not", async () => {
		vault.failOn = (op, path) => {
			if (op !== "createFolder" || path !== "Daily") return null;
			vault.failOn = null;
			void vault.createFolder("Daily");
			return new Error("Folder already exists.");
		};
		expect(await writeToDailyNote(asApp(), DATE, health(), opts())).toBe(true);
		vault.failOn = (op, path) => (op === "createFolder" && path === "Other" ? new Error("no permission") : null);
		await expect(writeToDailyNote(asApp(), DATE, health(), opts({ dailyNotePath: "Other" }))).rejects.toThrow("no permission");
	});
});

describe("backups of a note that stays broken", () => {
	const broken = (n: number): string => `---\nkey: [unclosed ${n}\n---\nBody\n`;
	const backups = (): string[] => vault.paths().filter((p) => p.startsWith(BACKUP_DIR));

	it("keeps one backup for the same content, however often the sync meets it", async () => {
		vault.seed(note, broken(1));
		for (let i = 0; i < 4; i++) {
			await writeToDailyNote(asApp(), DATE, health(), opts());
			vi.advanceTimersByTime(5000);
		}
		expect(backups()).toHaveLength(1);
	});

	it("keeps the last five backups of a note whose content keeps changing", async () => {
		vault.seed(note, broken(0));
		for (let i = 1; i <= 7; i++) {
			await vault.modify(vault.getAbstractFileByPath(note) as never, broken(i));
			await writeToDailyNote(asApp(), DATE, health(), opts());
			vi.advanceTimersByTime(5000);
		}
		const kept = backups();
		expect(kept).toHaveLength(5);
		expect(vault.text(kept[kept.length - 1] as string).endsWith(broken(7))).toBe(true);
		expect(kept.some((p) => vault.text(p).endsWith(broken(1)))).toBe(false);
	});
});

describe("what the user wrote in the frontmatter stays as it is", () => {
	const write = async (content: string, metrics: Record<string, number | string>): Promise<string> => {
		vault.seed(note, content);
		await writeToDailyNote(asApp(), DATE, health({ metrics }), opts());
		return vault.text(note);
	};

	it("keeps comments, quoting, flow lists, wiki links and blank lines when keys are added, and puts the new ones last", async () => {
		const content = "---\n# my mood log\nmood: 'ok'   # felt fine\ntags: [a, b]\nbook: \"[[Dune]]\"\n\nrating: 4\n---\nBody\n";
		const result = await write(content, { steps: 8000, sleep_duration: "7h 30min" });
		expect(result).toBe("---\n# my mood log\nmood: 'ok'   # felt fine\ntags: [a, b]\nbook: \"[[Dune]]\"\n\nrating: 4\nsteps: 8000\nsleep_duration: 7h 30min\n---\nBody\n");
	});

	it("changes the value of a key on its own line and leaves the rest, a comment before it included", async () => {
		const content = "---\n# steps of the day\nsteps: 100\ntags: [a, b]\nhrv: 40\n---\nBody\n";
		expect(await write(content, { steps: 8000 })).toBe("---\n# steps of the day\nsteps: 8000\ntags: [a, b]\nhrv: 40\n---\nBody\n");
	});

	it("finds a quoted key and a key at the end", async () => {
		expect(await write("---\n'steps': 100\n---\n", { steps: 8000 })).toBe("---\nsteps: 8000\n---\n");
		expect(await write("---\ntags: [a]\nsteps: 100\n---\n", { steps: 8000 })).toBe("---\ntags: [a]\nsteps: 8000\n---\n");
	});

	it("keeps the line endings of the body as they are, also when they are mixed", async () => {
		const content = "---\r\nmood: ok\r\n---\r\nline one\nline two\r\nline three\n";
		expect(await write(content, { steps: 8000 })).toBe("---\r\nmood: ok\r\nsteps: 8000\r\n---\r\nline one\nline two\r\nline three\n");
	});

	it("keeps a byte order mark in front", async () => {
		expect(await write("﻿---\nmood: ok\n---\nBody\n", { steps: 8000 })).toBe("﻿---\nmood: ok\nsteps: 8000\n---\nBody\n");
	});

	it("appends after a list that ends the block, where processFrontMatter put the key before it", async () => {
		const content = "---\nbook_titles:\n- '[[A]]'\n- '[[B]]'\n---\nBody\n";
		const result = await write(content, { steps: 8000 });
		expect(result).toBe("---\nbook_titles:\n- '[[A]]'\n- '[[B]]'\nsteps: 8000\n---\nBody\n");
		expect(frontmatter(note)).toEqual({ book_titles: ["[[A]]", "[[B]]"], steps: 8000 });
	});

	it("writes the block anew when a value that is a list or goes over several lines has to change", async () => {
		vault.seed(note, "---\n# kept?\ntrainings:\n  - type: run\nsteps: 1\n---\nBody\n");
		await writeToDailyNote(asApp(), DATE, health({ metrics: { steps: 5 }, trainings: [{ type: "walk", category: "walking" }] }), opts({ writeTrainings: true }));
		expect(frontmatter(note)).toMatchObject({ steps: 5, trainings: [{ type: "walk", category: "walking" }] });
		vault.seed(`Daily/2026-10-23.md`, "---\ntext: |\n  one\n  two\nsteps: 1\n---\n");
		await writeToDailyNote(asApp(), "2026-10-23", health({ metrics: { steps: 2 } }), opts());
		expect(frontmatter("Daily/2026-10-23.md")).toMatchObject({ text: "one\ntwo\n", steps: 2 });
		vault.seed(`Daily/2026-10-24.md`, "---\nlist:\n- a\nsteps: 1\nsteps_extra: 2\n---\n");
		await writeToDailyNote(asApp(), "2026-10-24", health({ metrics: { steps: 3 } }), opts());
		expect(frontmatter("Daily/2026-10-24.md")).toMatchObject({ list: ["a"], steps: 3 });
	});

	it("writes the block anew when the value to change is a scalar that a list or a nested value follows, or its key is not on a line of its own", async () => {
		// the key is written with a space before the colon, so it is not found on a line of its own
		vault.seed(note, "---\nsteps : 1\nmood: ok\n---\n");
		await writeToDailyNote(asApp(), DATE, health({ metrics: { steps: 9 } }), opts());
		expect(frontmatter(note)).toEqual({ steps: 9, mood: "ok" });
		// a scalar whose value goes on in the next line
		vault.seed(`Daily/2026-10-25.md`, "---\nsteps: 1\n  continued\nmood: ok\n---\n");
		await writeToDailyNote(asApp(), "2026-10-25", health({ metrics: { steps: 9 } }), opts());
		expect(frontmatter("Daily/2026-10-25.md")).toMatchObject({ steps: 9, mood: "ok" });
	});

	it("reads a block whose closing line is the last line of the file", async () => {
		expect(await write("---\nmood: ok\n---", { steps: 8000 })).toBe("---\nmood: ok\nsteps: 8000\n---\n");
	});

	it("handles an empty block and a note without one as before", async () => {
		expect(await write("---\n---\nBody\n", { steps: 8000 })).toBe("---\nsteps: 8000\n---\nBody\n");
		expect(await write("Body\n", { steps: 8000 })).toBe("---\nsteps: 8000\n---\nBody\n");
	});
});

describe("patching the frontmatter in place: the block must read back as the merged properties", () => {
	const write = async (content: string, metrics: Record<string, number | string>, prefix = ""): Promise<string> => {
		vault.seed(note, content);
		await writeToDailyNote(asApp(), DATE, health({ metrics }), opts({ prefix }));
		return vault.text(note);
	};

	it("leaves a note with the same key twice alone, backed up and reported, as it does for any block it cannot read", async () => {
		const content = "---\nsteps: 1\nmood: ok\nsteps: 2\n---\nBody\n";
		expect(await write(content, { steps: 9 })).toBe(content);
		expect(vault.paths().some((p) => p.startsWith(BACKUP_DIR))).toBe(true);
		expect(Notice.recorded).toHaveLength(1);
	});

	it("keeps a comment after a key that does not change and replaces one that does, comment included", async () => {
		expect(await write("---\nmood: ok # felt fine\nsteps: 1 # old\n---\n", { steps: 9 })).toBe("---\nmood: ok # felt fine\nsteps: 9\n---\n");
	});

	it("changes the type of a value, from text to a number and back", async () => {
		await write("---\nsteps: lots\n---\n", { steps: 9000 });
		expect(frontmatter(note)).toEqual({ steps: 9000 });
		await write("---\nsleep_duration: 7\n---\n", { sleep_duration: "7h 30min" });
		expect(frontmatter(note)).toEqual({ sleep_duration: "7h 30min" });
	});

	it("replaces a key that is there with no value, and one that is null", async () => {
		await write("---\nsteps:\nmood: ok\n---\n", { steps: 9 });
		expect(frontmatter(note)).toEqual({ steps: 9, mood: "ok" });
		await write("---\nsteps: null\n---\n", { steps: 9 });
		expect(frontmatter(note)).toEqual({ steps: 9 });
	});

	it("handles keys with characters that mean something in a pattern, and with the prefix next to the plain key", async () => {
		await write("---\nsteps (daily): 1\nmood: ok\n---\n", { steps: 9 });
		expect(frontmatter(note)).toEqual({ "steps (daily)": 1, mood: "ok", steps: 9 });
		await write("---\nsteps: 1\nohs_steps: 2\n---\n", { ohs_steps: 9 });
		expect(frontmatter(note)).toEqual({ steps: 1, ohs_steps: 9 });
		const prefixed = await write("---\nsteps: 1\n---\n", { steps: 9 }, "ohs_");
		expect(prefixed).toBe("---\nsteps: 1\nohs_steps: 9\n---\n");
	});

	it("handles tabs and Unicode in what the user wrote", async () => {
		const content = "---\nstimmung: gut\t# ok\nsteps: 1\n---\nBody\n";
		expect(await write(content, { steps: 9 })).toBe("---\nstimmung: gut\t# ok\nsteps: 9\n---\nBody\n");
		expect(await write("---\n名前: 山田\nsteps: 1\n---\n", { steps: 9 })).toBe("---\n名前: 山田\nsteps: 9\n---\n");
	});

	it("writes the block anew when the patch would break an alias (the anchor was on the value that changes)", async () => {
		await write("---\nsteps: &a 1\nother: *a\n---\n", { steps: 9 });
		expect(frontmatter(note)).toEqual({ steps: 9, other: 1 });
	});

	it("writes the block anew when the patch would make an alias point somewhere else", async () => {
		// before: other is 1 (the latest anchor a); a patch of steps alone would leave it pointing at the first anchor, 5
		await write("---\nfirst: &a 5\nsteps: &a 1\nother: *a\n---\n", { steps: 9 });
		expect(frontmatter(note)).toEqual({ first: 5, steps: 9, other: 1 });
	});
});
