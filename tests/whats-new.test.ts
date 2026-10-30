// Why it matters: this is when users get interrupted. A new install must see nothing, an update shows the
// notes exactly once (also if Obsidian is closed with the window open), and an update that arrives while
// Obsidian runs must not pop a window over somebody's work.
import { beforeEach, describe, expect, it } from "vitest";
import { App, Modal, Notice } from "../testUtils/mocks/obsidian";
import { showWhatsNewIfDue, showWhatsNewNotes } from "../src/whats-new";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";

const SEEN = "garmin-health-sync-whats-new-seen";
const HINTED = "garmin-health-sync-whats-new-hinted";
const SOON = 3_000;
const LATER = 120_000;

let app: App;
const run = (version: string, fresh: boolean, sinceStart = SOON, lang = "en"): void => showWhatsNewIfDue(app as never, lang, version, fresh, sinceStart);
const windows = (): Modal[] => Modal.opened;

beforeEach(() => {
	app = new App();
	Modal.opened = [];
	Notice.recorded = [];
});

describe("a new install", () => {
	it("only records the version and shows nothing", () => {
		run("0.11.2", true);
		expect(windows()).toHaveLength(0);
		expect(app.loadLocalStorage(SEEN)).toBe("0.11.2");
		run("0.11.2", false);
		expect(windows()).toHaveLength(0);
	});

	it("records the version too when it starts late", () => {
		run("0.11.2", true, LATER);
		expect(app.loadLocalStorage(SEEN)).toBe("0.11.2");
		expect(Notice.recorded).toEqual([]);
	});
});

describe("an update seen at start", () => {
	it("shows the notes once and records the version before the window opens", () => {
		run("0.11.2", false);
		expect(windows()).toHaveLength(1);
		expect(app.loadLocalStorage(SEEN)).toBe("0.11.2");
		run("0.11.2", false);
		expect(windows()).toHaveLength(1);
	});

	it("shows a user who already had data but never recorded a version, in their language", () => {
		run("0.11.2", false, SOON, "de");
		expect((windows()[0] as unknown as { contentEl: HTMLElement }).contentEl.querySelector("h2")?.textContent).toBe(de.whatsNewTitle);
	});

	it("does not repeat for the stable release after a beta", () => {
		run("0.11.2-beta.1", false);
		run("0.11.2", false);
		expect(windows()).toHaveLength(1);
	});

	it("shows nothing when the running version has no notes", () => {
		run("0.11.1", false);
		expect(windows()).toHaveLength(0);
		expect(app.loadLocalStorage(SEEN)).toBeNull();
	});

	it("still shows the notes when the device cannot store anything", () => {
		app.loadLocalStorage = () => { throw new Error("blocked"); };
		app.saveLocalStorage = () => { throw new Error("blocked"); };
		run("0.11.2", false);
		expect(windows()).toHaveLength(1);
	});

	it("treats a stored value that is not text as never seen", () => {
		app.saveLocalStorage(SEEN, 42);
		run("0.11.2", false);
		expect(windows()).toHaveLength(1);
	});
});

describe("an update that arrived while Obsidian was running", () => {
	it("shows one restart hint, no window, and keeps the notes for the next start", () => {
		run("0.11.2", false, LATER);
		expect(windows()).toHaveLength(0);
		expect(Notice.messages()).toEqual([en.noticeWhatsNewRestart.replace("{version}", "0.11.2")]);
		expect(app.loadLocalStorage(SEEN)).toBeNull();
		run("0.11.2", false, LATER);
		expect(Notice.recorded).toHaveLength(1);
		run("0.11.2", false, SOON);
		expect(windows()).toHaveLength(1);
	});
});

describe("the Show what's new command", () => {
	it("opens the notes of the running minor line", () => {
		showWhatsNewNotes(app as never, "en", "0.11.5");
		expect(windows()).toHaveLength(1);
	});

	it("does nothing for a version older than every note", () => {
		showWhatsNewNotes(app as never, "en", "0.9.0");
		expect(windows()).toHaveLength(0);
	});
});
