// Why it matters: a daily note with dozens of synced metrics buries the text under its properties. The properties
// must fold once when a daily note opens, or the rows the panel already shows must disappear and stay hidden
// while Obsidian rebuilds them; other notes must never be touched, and a user who opened the properties again
// must not have them closed under them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, TFile } from "../testUtils/mocks/obsidian";
import { NoteProperties, type PropertiesMode } from "../src/note-properties";

const note = (path: string): TFile => Object.assign(new TFile(), { path, name: path, basename: path.replace(/\.md$/, "") });
const DAILY = note("2026-10-22.md");
const OTHER = note("ideas.md");

let app: App;
let properties: NoteProperties;
let host: HTMLElement;
let mode: PropertiesMode;
let hidden: Set<string>;

/** The properties block of the active pane with the given rows, open unless `collapsed`. */
function showProperties(rows: string[] = [], collapsed = false): HTMLElement {
	const items = rows.map((key) => `<div class="metadata-property" data-property-key="${key}"></div>`).join("");
	host.innerHTML = `<div class="workspace-leaf mod-active"><div class="metadata-container${collapsed ? " is-collapsed" : ""}">${items}</div></div>`;
	return host.querySelector(".metadata-container")!;
}
const rowsHidden = (): string[] => Array.from(host.querySelectorAll(".metadata-property")).filter((r) => r.classList.contains("ghs-property-hidden")).map((r) => r.getAttribute("data-property-key")!);

beforeEach(() => {
	vi.useFakeTimers();
	app = new App();
	host = document.body.appendChild(document.createElement("div"));
	mode = "fold";
	hidden = new Set(["hrv", "steps", "running"]);
	properties = new NoteProperties(app as never, { mode: () => mode, isDaily: (file) => file.path !== OTHER.path, hidden: () => hidden });
	app.workspace.activeFile = DAILY;
});
afterEach(() => {
	properties.cancel();
	host.remove();
	vi.useRealTimers();
});

describe("folding", () => {
	it("folds the open properties of a note once Obsidian has built them", async () => {
		showProperties();
		properties.fileOpened(DAILY as never);
		await vi.advanceTimersByTimeAsync(299);
		expect(app.commands.executed).toEqual([]);
		await vi.advanceTimersByTimeAsync(1);
		expect(app.commands.executed).toEqual(["editor:toggle-fold-properties"]);
	});

	it("leaves properties that are already folded alone, because the command would open them", async () => {
		showProperties([], true);
		properties.fileOpened(DAILY as never);
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.commands.executed).toEqual([]);
	});

	it("waits for a properties block that appears late and gives up after about two seconds", async () => {
		properties.fileOpened(DAILY as never);
		await vi.advanceTimersByTimeAsync(1000);
		showProperties();
		await vi.advanceTimersByTimeAsync(100);
		expect(app.commands.executed).toHaveLength(1);

		app.commands.executed.length = 0;
		host.innerHTML = "";
		properties.fileOpened(DAILY as never);
		await vi.advanceTimersByTimeAsync(300 + 17 * 100);
		showProperties();
		await vi.advanceTimersByTimeAsync(5000);
		expect(app.commands.executed).toEqual([]);
	});

	it("does nothing for a note it is not meant to touch, for no note, or when the setting is off", async () => {
		app.workspace.activeFile = OTHER;
		showProperties();
		properties.fileOpened(OTHER as never);
		properties.fileOpened(null);
		mode = "off";
		properties.fileOpened(DAILY as never);
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.commands.executed).toEqual([]);
	});

	it("drops a pending fold when another note takes over, and when the active note changed meanwhile", async () => {
		showProperties();
		properties.fileOpened(DAILY as never);
		properties.fileOpened(OTHER as never);
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.commands.executed).toEqual([]);

		properties.fileOpened(DAILY as never);
		app.workspace.activeFile = OTHER;
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.commands.executed).toEqual([]);
	});

	it("cancels a pending fold, and cancelling with nothing pending is harmless", async () => {
		showProperties();
		properties.cancel();
		properties.fileOpened(DAILY as never);
		properties.cancel();
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.commands.executed).toEqual([]);
	});

	it("folds the active note on a layout change once, so properties the user opened stay open", async () => {
		showProperties();
		properties.layoutChanged();
		await vi.advanceTimersByTimeAsync(300);
		expect(app.commands.executed).toHaveLength(1);

		showProperties(); // the user opened them again
		properties.layoutChanged();
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.commands.executed).toHaveLength(1);

		properties.fileOpened(DAILY as never); // the same note opened again has a new properties block
		await vi.advanceTimersByTimeAsync(300);
		expect(app.commands.executed).toHaveLength(2);
	});

	it("ignores a layout change without an active note", async () => {
		app.workspace.activeFile = null;
		showProperties();
		properties.layoutChanged();
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.commands.executed).toEqual([]);
	});
});

describe("hiding what the panel shows", () => {
	beforeEach(() => {
		mode = "hide";
	});

	it("hides the rows of the panel's keys, also with the prefix, and leaves the user's own and does not fold", async () => {
		showProperties(["tags", "hrv", "ohs_steps", "mood", "running"]);
		properties.fileOpened(DAILY as never);
		await vi.advanceTimersByTimeAsync(300);
		expect(rowsHidden()).toEqual(["hrv", "ohs_steps", "running"]);
		expect(app.commands.executed).toEqual([]);
	});

	it("leaves a row without a key alone", async () => {
		const block = showProperties(["hrv"]);
		block.insertAdjacentHTML("beforeend", '<div class="metadata-property"></div>');
		properties.fileOpened(DAILY as never);
		await vi.advanceTimersByTimeAsync(300);
		expect(block.querySelectorAll(".ghs-property-hidden")).toHaveLength(1);
	});

	it("hides a row again that Obsidian rebuilt, and stops watching when the note changes", async () => {
		const block = showProperties(["hrv"]);
		properties.fileOpened(DAILY as never);
		await vi.advanceTimersByTimeAsync(300);
		block.innerHTML = '<div class="metadata-property" data-property-key="steps"></div><div class="metadata-property" data-property-key="tags"></div>';
		await vi.advanceTimersByTimeAsync(0);
		expect(rowsHidden()).toEqual(["steps"]);
		properties.fileOpened(OTHER as never);
		block.innerHTML = '<div class="metadata-property" data-property-key="hrv"></div>';
		await vi.advanceTimersByTimeAsync(0);
		expect(rowsHidden()).toEqual([]);
	});

	it("shows the rows again when another note opens, also one that is not a daily note", async () => {
		showProperties(["hrv"]);
		properties.fileOpened(DAILY as never);
		await vi.advanceTimersByTimeAsync(300);
		expect(rowsHidden()).toEqual(["hrv"]);
		app.workspace.activeFile = OTHER;
		properties.fileOpened(OTHER as never);
		expect(rowsHidden()).toEqual([]);
	});

	it("applies again on every layout change, because the block may be new", async () => {
		showProperties(["hrv"]);
		properties.layoutChanged();
		await vi.advanceTimersByTimeAsync(300);
		showProperties(["hrv"]);
		properties.layoutChanged();
		await vi.advanceTimersByTimeAsync(300);
		expect(rowsHidden()).toEqual(["hrv"]);
	});

	it("reads what to hide each time, so a card switched off shows its rows again", async () => {
		showProperties(["hrv", "steps"]);
		properties.fileOpened(DAILY as never);
		await vi.advanceTimersByTimeAsync(300);
		hidden = new Set(["steps"]);
		properties.modeChanged();
		await vi.advanceTimersByTimeAsync(300);
		expect(rowsHidden()).toEqual(["steps"]);
	});

	it("shows everything again when the setting goes back to off or to folding", async () => {
		showProperties(["hrv"]);
		properties.fileOpened(DAILY as never);
		await vi.advanceTimersByTimeAsync(300);
		mode = "off";
		properties.modeChanged();
		expect(rowsHidden()).toEqual([]);
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.commands.executed).toEqual([]);
		mode = "fold";
		properties.modeChanged();
		await vi.advanceTimersByTimeAsync(300);
		expect(app.commands.executed).toHaveLength(1);
	});
});
