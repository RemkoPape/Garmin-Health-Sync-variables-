// Why it matters: the side panel is what users will look at daily. It must show the right day (the open
// daily note, else today), never touch notes, stay idle while hidden, and be reachable only when switched on.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, TFile, WorkspaceLeaf } from "../testUtils/mocks/obsidian";
import { HealthPanelView, VIEW_TYPE_HEALTH_PANEL } from "../src/panel/view";
import { formatPanelDate } from "../src/panel/format";
import { DEFAULT_SETTINGS } from "../src/settings";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";

const NOW = new Date(2026, 9, 22, 10, 0, 0);

function note(path: string, size = 10): TFile {
	const f = new TFile();
	f.path = path;
	f.name = path.split("/").pop() as string;
	f.basename = f.name.replace(/\.md$/, "");
	f.stat = { size } as never;
	return f;
}

async function open(settings = {}): Promise<{ app: App; view: HealthPanelView; plugin: { settings: typeof DEFAULT_SETTINGS } }> {
	const app = new App();
	const plugin = { settings: { ...DEFAULT_SETTINGS, ...settings } };
	const leaf = new WorkspaceLeaf(app);
	const view = new HealthPanelView(leaf as never, plugin as never);
	await view.onOpen();
	return { app, view, plugin };
}

const dateText = (view: HealthPanelView): string => view.contentEl.querySelector(".ghs-daynav-date")?.textContent ?? "";
const buttons = (view: HealthPanelView): HTMLButtonElement[] => Array.from(view.contentEl.querySelectorAll("button"));

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});
afterEach(() => vi.restoreAllMocks());

describe("health panel view", () => {
	it("identifies itself", async () => {
		const { view } = await open();
		expect(view.getViewType()).toBe(VIEW_TYPE_HEALTH_PANEL);
		expect(view.getDisplayText()).toBe(en.panelTitle);
		expect(view.getIcon()).toBe("activity");
	});

	it("shows today and the empty state when no daily note is open", async () => {
		const { view } = await open();
		expect(dateText(view)).toBe(formatPanelDate("2026-10-22", "en"));
		expect(view.contentEl.querySelector(".ghs-panel-empty")?.textContent).toBe(en.panelEmpty);
	});

	it("follows the open daily note and falls back to today for other files", async () => {
		const { app, view } = await open();
		app.workspace.activeFile = note("2026-10-15.md");
		app.workspace.fire("file-open");
		expect(dateText(view)).toBe(formatPanelDate("2026-10-15", "en"));
		app.workspace.activeFile = note("random.md");
		app.workspace.fire("file-open");
		expect(dateText(view)).toBe(formatPanelDate("2026-10-22", "en"));
	});

	it("steps one day at a time and stops at today", async () => {
		const { view } = await open();
		const [prev, next] = buttons(view) as [HTMLButtonElement, HTMLButtonElement];
		expect(next.disabled).toBe(true);
		prev.click();
		expect(dateText(view)).toBe(formatPanelDate("2026-10-21", "en"));
		const [, next2] = buttons(view) as [HTMLButtonElement, HTMLButtonElement];
		expect(next2.disabled).toBe(false);
		next2.click();
		expect(dateText(view)).toBe(formatPanelDate("2026-10-22", "en"));
	});

	it("labels the buttons in the plugin language", async () => {
		const { view } = await open({ language: "de" });
		expect(buttons(view).map((b) => b.getAttribute("aria-label"))).toEqual([de.panelPrevDay, de.panelNextDay]);
	});

	it("skips rendering while hidden and renders on the next reveal", async () => {
		const { app, view } = await open();
		view.containerEl.isShown = () => false;
		app.workspace.activeFile = note("2026-10-10.md");
		app.workspace.fire("file-open");
		expect(dateText(view)).toBe(formatPanelDate("2026-10-22", "en"));
		view.containerEl.isShown = () => true;
		app.workspace.fire("active-leaf-change");
		expect(dateText(view)).toBe(formatPanelDate("2026-10-10", "en"));
	});

	it("does nothing on a leaf change while it is up to date", async () => {
		const { app, view } = await open();
		const before = view.contentEl.firstElementChild;
		app.workspace.fire("active-leaf-change");
		expect(view.contentEl.firstElementChild).toBe(before);
	});

	it("re-renders on refresh", async () => {
		const { view, plugin } = await open();
		plugin.settings.language = "de";
		view.refresh();
		expect(view.contentEl.querySelector(".ghs-panel-empty")?.textContent).toBe(de.panelEmpty);
	});
});

describe("formatPanelDate", () => {
	it("formats per language", () => {
		expect(formatPanelDate("2026-10-22", "en")).toContain("22");
		expect(formatPanelDate("2026-10-22", "ja")).not.toBe(formatPanelDate("2026-10-22", "en"));
	});
});
