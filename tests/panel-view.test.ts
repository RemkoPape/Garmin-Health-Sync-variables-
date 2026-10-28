// Why it matters: the side panel is what users will look at daily. It must show the right day (the open
// daily note, else today), never touch notes, stay idle while hidden, and be reachable only when switched on.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, TFile, WorkspaceLeaf } from "../testUtils/mocks/obsidian";
import { HealthPanelView, VIEW_TYPE_HEALTH_PANEL } from "../src/panel/view";
import { formatNumber, formatPanelDate, formatSigned, weekdayInitial } from "../src/panel/format";
import { seedHistory } from "../testUtils/fakeHistory";
import { DEFAULT_SETTINGS } from "../src/settings";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";
import { serializeMonth } from "../src/history/format";

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
	// the Today card is switched off here so these tests keep looking at the first data card; panel-today.test.ts covers it
	const plugin = { settings: { ...DEFAULT_SETTINGS, panelCards: { today: false }, ...settings } };
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

	it("shows today and a card that says why there is no data yet", async () => {
		const { view } = await open();
		expect(dateText(view)).toBe(formatPanelDate("2026-10-22", "en"));
		expect(view.contentEl.querySelector(".ghs-card-value")?.textContent).toBe(en.panelNoReading);
		expect(view.contentEl.querySelector(".ghs-card-note")?.textContent).toContain("0 so far");
	});

	it("shows the HRV of the shown day from the daily notes", async () => {
		const app = new App();
		await seedHistory(app, { end: "2026-10-22", days: 31, frontmatter: (ago) => ({ hrv: ago % 2 === 0 ? 62 : 58 }) });
		const view = new HealthPanelView(new WorkspaceLeaf(app) as never, { settings: { ...DEFAULT_SETTINGS, panelCards: { today: false } } } as never);
		await view.onOpen();
		expect(view.contentEl.querySelector(".ghs-card-value")?.textContent).toBe("62 ms");
		buttons(view)[0]!.click();
		expect(view.contentEl.querySelector(".ghs-card-value")?.textContent).toBe("58 ms");
	});

	it("shows the cards in order: today, recovery, sleep, movement", async () => {
		const { view } = await open({ panelCards: {} });
		expect(Array.from(view.contentEl.querySelectorAll(".ghs-card-title")).map((e) => e.textContent)).toEqual([en.panelTodayTitle, en.panelHrvTitle, en.panelRestingHrTitle, en.panelSpo2Title, en.panelBreathingTitle, en.panelSleepTitle, en.panelStagesTitle, en.panelBatteryTitle, en.panelStressTitle, en.panelHydrationTitle, en.panelStepsTitle, en.panelIntensityTitle, en.panelFloorsTitle, en.panelVo2Title, en.panelBodyTitle, en.panelLoadTitle, en.panelWeeklyTitle, en.panelSessionsTitle]);
	});

	it("groups the cards under Today, Recovery, Sleep, Energy, Movement, Fitness and Training headers", async () => {
		const { view } = await open({ panelCards: {} });
		expect(Array.from(view.contentEl.querySelectorAll(".ghs-section")).map((e) => e.textContent)).toEqual([en.panelSectionToday, en.panelSectionRecovery, en.panelSectionSleep, en.panelSectionEnergy, en.panelSectionMovement, en.panelSectionFitness, en.panelSectionTraining]);
	});

	it("puts SpO2 and breathing side by side", async () => {
		const { view } = await open();
		expect(Array.from(view.contentEl.querySelectorAll(".ghs-pair .ghs-card-title")).map((e) => e.textContent)).toEqual([en.panelSpo2Title, en.panelBreathingTitle]);
	});

	it("opens one explanation at a time", async () => {
		const { view } = await open();
		const infos = (): HTMLButtonElement[] => Array.from(view.contentEl.querySelectorAll(".ghs-info"));
		infos()[0]!.click();
		infos()[1]!.click();
		const open2 = Array.from(view.contentEl.querySelectorAll(".ghs-explain")).map((e) => e.textContent);
		expect(open2).toEqual([en.panelRestingHrExplain]);
	});

	it("opens and closes the explanation, one card at a time", async () => {
		const { view } = await open();
		const info = (): HTMLButtonElement => view.contentEl.querySelector(".ghs-info") as HTMLButtonElement;
		info().click();
		expect(view.contentEl.querySelector(".ghs-explain")?.textContent).toBe(en.panelHrvExplain);
		info().click();
		expect(view.contentEl.querySelector(".ghs-explain")).toBeNull();
	});

	it("re-renders once, 300 ms after a burst of note changes, with fresh data", async () => {
		const app = new App();
		const view = new HealthPanelView(new WorkspaceLeaf(app) as never, { settings: { ...DEFAULT_SETTINGS, panelCards: { today: false } } } as never);
		await view.onOpen();
		expect(view.contentEl.querySelector(".ghs-card-value")?.textContent).toBe(en.panelNoReading);
		await seedHistory(app, { end: "2026-10-22", days: 1, frontmatter: () => ({ hrv: 64 }) });
		const file = app.vault.getMarkdownFiles()[0]!;
		app.metadataCache.fireChanged(file);
		app.metadataCache.fireChanged(file);
		await vi.advanceTimersByTimeAsync(299);
		expect(view.contentEl.querySelector(".ghs-card-value")?.textContent).toBe(en.panelNoReading);
		await vi.advanceTimersByTimeAsync(1);
		expect(view.contentEl.querySelector(".ghs-card-value")?.textContent).toBe("64 ms");
	});

	it.each(["delete", "rename"] as const)("refreshes when a note is %sd", async (event) => {
		const app = new App();
		await seedHistory(app, { end: "2026-10-22", days: 1, frontmatter: () => ({ hrv: 64 }) });
		const view = new HealthPanelView(new WorkspaceLeaf(app) as never, { settings: { ...DEFAULT_SETTINGS, panelCards: { today: false } } } as never);
		await view.onOpen();
		expect(view.contentEl.querySelector(".ghs-card-value")?.textContent).toBe("64 ms");
		app.metadataCache.frontmatter.clear();
		app.vault.fire(event, app.vault.getMarkdownFiles()[0]!);
		await vi.advanceTimersByTimeAsync(300);
		expect(view.contentEl.querySelector(".ghs-card-value")?.textContent).toBe(en.panelNoReading);
	});

	it("draws the day from the history notes once they are read, and again when a history note changes", async () => {
		const app = new App();
		const path = "Garmin history/Garmin history 2026-10.md";
		app.vault.seed(path, serializeMonth("2026-10", new Map([["2026-10-22", { hrv: 64 }]])));
		const view = new HealthPanelView(new WorkspaceLeaf(app) as never, { settings: { ...DEFAULT_SETTINGS, panelCards: { today: false } } } as never);
		await view.onOpen();
		expect(view.contentEl.querySelector(".ghs-card-value")?.textContent).toBe(en.panelNoReading);
		await vi.advanceTimersByTimeAsync(0);
		expect(view.contentEl.querySelector(".ghs-card-value")?.textContent).toBe("64 ms");
		app.vault.overwrite(path, serializeMonth("2026-10", new Map([["2026-10-22", { hrv: 65 }]])));
		app.metadataCache.fireChanged(app.vault.getAbstractFileByPath(path) as never);
		await vi.advanceTimersByTimeAsync(300);
		await vi.advanceTimersByTimeAsync(0);
		expect(view.contentEl.querySelector(".ghs-card-value")?.textContent).toBe("65 ms");
	});

	it("does not read the history notes again when an ordinary note changes", async () => {
		const app = new App();
		app.vault.seed("Garmin history/Garmin history 2026-10.md", serializeMonth("2026-10", new Map([["2026-10-22", { hrv: 64 }]])));
		const reads = vi.spyOn(app.vault, "cachedRead");
		const view = new HealthPanelView(new WorkspaceLeaf(app) as never, { settings: { ...DEFAULT_SETTINGS, panelCards: { today: false } } } as never);
		await view.onOpen();
		await vi.advanceTimersByTimeAsync(0);
		const first = reads.mock.calls.length;
		app.metadataCache.fireChanged(note("2026-10-22.md"));
		await vi.advanceTimersByTimeAsync(300);
		await vi.advanceTimersByTimeAsync(0);
		expect(reads.mock.calls.length).toBe(first);
	});

	it("drops a pending render when closed", async () => {
		const { app, view } = await open();
		app.metadataCache.fireChanged(new TFile());
		await view.onClose();
		const before = view.contentEl.innerHTML;
		view.contentEl.empty();
		await vi.advanceTimersByTimeAsync(500);
		expect(view.contentEl.innerHTML).toBe("");
		expect(before).not.toBe("");
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
		const { view } = await open({ language: "de", panelCards: {} });
		expect(buttons(view).map((b) => b.getAttribute("aria-label"))).toEqual([de.panelPrevDay, de.panelNextDay, de.panelEdit, de.panelInfo, de.panelInfo, de.panelInfo, de.panelInfo, de.panelInfo, de.panelInfo, de.panelInfo, de.panelInfo, de.panelInfo, de.panelInfo, de.panelInfo, de.panelInfo, de.panelInfo, de.panelInfo, de.panelInfo, de.panelInfo, de.panelInfo, de.panelInfo]);
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

	it("renders what a sync wrote while the panel was hidden as soon as it is shown again, however it becomes visible", async () => {
		for (const reveal of ["active-leaf-change", "layout-change", "resize"]) {
			const app = new App();
			const view = new HealthPanelView(new WorkspaceLeaf(app) as never, { settings: { ...DEFAULT_SETTINGS, panelCards: { today: false } } } as never);
			await view.onOpen();
			expect(view.contentEl.querySelector(".ghs-card-value")?.textContent).toBe(en.panelNoReading);
			// the drawer is closed, then a sync writes today's note
			view.containerEl.isShown = () => false;
			await seedHistory(app, { end: "2026-10-22", days: 1, frontmatter: () => ({ hrv: 64 }) });
			app.metadataCache.fireChanged(app.vault.getMarkdownFiles()[0]!);
			await vi.advanceTimersByTimeAsync(300);
			expect(view.contentEl.querySelector(".ghs-card-value")?.textContent).toBe(en.panelNoReading);
			// opening the drawer is what shows it again; no tab switch is needed
			view.containerEl.isShown = () => true;
			if (reveal === "resize") view.onResize();
			else app.workspace.fire(reveal);
			expect(view.contentEl.querySelector(".ghs-card-value")?.textContent, reveal).toBe("64 ms");
		}
	});

	it("does nothing on a resize while it is up to date", async () => {
		const { view } = await open();
		const before = view.contentEl.firstElementChild;
		view.onResize();
		expect(view.contentEl.firstElementChild).toBe(before);
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
		expect(view.contentEl.querySelector(".ghs-card-value")?.textContent).toBe(de.panelNoReading);
	});
});

describe("formatPanelDate", () => {
	it("formats per language", () => {
		expect(formatPanelDate("2026-10-22", "en")).toContain("22");
		expect(formatPanelDate("2026-10-22", "ja")).not.toBe(formatPanelDate("2026-10-22", "en"));
	});
});

describe("number and weekday formats", () => {
	it("signs a change and never shows a minus in front of zero", () => {
		expect(formatSigned(0.74, "en")).toBe("+0.7");
		expect(formatSigned(-3, "en", 0)).toBe("−3");
		expect(formatSigned(-0.04, "en")).toBe("+0");
		expect(formatSigned(0, "en")).toBe("+0");
		expect(formatSigned(-1.5, "de")).toBe("−1,5");
	});

	it("limits decimals as asked", () => {
		expect(formatNumber(45.24, "en")).toBe("45.2");
		expect(formatNumber(45.6, "en", 0)).toBe("46");
		expect(formatNumber(61.5, "de")).toBe("61,5");
	});

	it("gives a one-letter weekday in the plugin language", () => {
		expect(weekdayInitial("2026-10-26", "en")).toBe("M");
		expect(weekdayInitial("2026-10-26", "ja")).toBe("月");
	});
});
