// Why it matters: a daily note with dozens of synced metrics buries the text under its properties. The
// properties must fold once when a daily note opens, never fold other notes, never fight a user who opened them
// again, and must wait for Obsidian to build the properties block.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, TFile } from "../testUtils/mocks/obsidian";
import { PropertiesFolder } from "../src/fold-properties";

const note = (path: string): TFile => Object.assign(new TFile(), { path, name: path, basename: path.replace(/\.md$/, "") });
const DAILY = note("2026-10-22.md");
const OTHER = note("ideas.md");

let app: App;
let folder: PropertiesFolder;
let host: HTMLElement;

/** The properties block of the active pane, open unless `collapsed`. */
function showProperties(collapsed = false): HTMLElement {
	host.innerHTML = `<div class="workspace-leaf mod-active"><div class="metadata-container${collapsed ? " is-collapsed" : ""}"></div></div>`;
	return host.querySelector(".metadata-container")!;
}

beforeEach(() => {
	vi.useFakeTimers();
	app = new App();
	host = document.body.appendChild(document.createElement("div"));
	folder = new PropertiesFolder(app as never, (file) => file.path !== OTHER.path);
	app.workspace.activeFile = DAILY;
});
afterEach(() => {
	host.remove();
	vi.useRealTimers();
});

describe("PropertiesFolder", () => {
	it("folds the open properties of a note once Obsidian has built them", async () => {
		showProperties();
		folder.fileOpened(DAILY as never);
		await vi.advanceTimersByTimeAsync(299);
		expect(app.commands.executed).toEqual([]);
		await vi.advanceTimersByTimeAsync(1);
		expect(app.commands.executed).toEqual(["editor:toggle-fold-properties"]);
	});

	it("leaves properties that are already folded alone, because the command would open them", async () => {
		showProperties(true);
		folder.fileOpened(DAILY as never);
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.commands.executed).toEqual([]);
	});

	it("waits for a properties block that appears late and gives up after about two seconds", async () => {
		folder.fileOpened(DAILY as never);
		await vi.advanceTimersByTimeAsync(1000);
		showProperties();
		await vi.advanceTimersByTimeAsync(100);
		expect(app.commands.executed).toHaveLength(1);

		app.commands.executed.length = 0;
		host.innerHTML = "";
		folder.fileOpened(DAILY as never);
		await vi.advanceTimersByTimeAsync(300 + 17 * 100);
		showProperties();
		await vi.advanceTimersByTimeAsync(5000);
		expect(app.commands.executed).toEqual([]);
	});

	it("does nothing for a note it is not meant to fold, or for no note", async () => {
		app.workspace.activeFile = OTHER;
		showProperties();
		folder.fileOpened(OTHER as never);
		folder.fileOpened(null);
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.commands.executed).toEqual([]);
	});

	it("drops a pending fold when another note takes over, and when the active note changed meanwhile", async () => {
		showProperties();
		folder.fileOpened(DAILY as never);
		folder.fileOpened(OTHER as never);
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.commands.executed).toEqual([]);

		folder.fileOpened(DAILY as never);
		app.workspace.activeFile = OTHER;
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.commands.executed).toEqual([]);
	});

	it("cancels a pending fold, and cancelling with nothing pending is harmless", async () => {
		showProperties();
		folder.cancel();
		folder.fileOpened(DAILY as never);
		folder.cancel();
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.commands.executed).toEqual([]);
	});

	it("folds the active note on a layout change once, so properties the user opened stay open", async () => {
		showProperties();
		folder.layoutChanged();
		await vi.advanceTimersByTimeAsync(300);
		expect(app.commands.executed).toHaveLength(1);

		showProperties(); // the user opened them again
		folder.layoutChanged();
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.commands.executed).toHaveLength(1);

		folder.fileOpened(DAILY as never); // the same note opened again has a new properties block
		await vi.advanceTimersByTimeAsync(300);
		expect(app.commands.executed).toHaveLength(2);
	});

	it("ignores a layout change without an active note", async () => {
		app.workspace.activeFile = null;
		showProperties();
		folder.layoutChanged();
		await vi.advanceTimersByTimeAsync(1000);
		expect(app.commands.executed).toEqual([]);
	});
});
