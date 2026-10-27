// Why it matters: the order of the cards is the user's own. It must survive new cards being added later, junk in a
// hand-edited settings file and every way of moving a card (mouse, finger, keyboard), and the day picker must
// never take the panel to a day that has not happened.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, WorkspaceLeaf } from "../testUtils/mocks/obsidian";
import { HealthPanelView } from "../src/panel/view";
import { PANEL_CARDS, orderedCards } from "../src/panel/cards";
import { makeSortable } from "../src/panel/sortable";
import { DEFAULT_SETTINGS } from "../src/settings";
import { formatPanelDate } from "../src/panel/format";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";

const NOW = new Date(2026, 9, 22, 10, 0, 0);
const ids = (cards: { id: string }[]): string[] => cards.map((c) => c.id);
const DEFAULT = ids(PANEL_CARDS);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});
afterEach(() => vi.restoreAllMocks());

describe("orderedCards", () => {
	it("is the default order without a saved one", () => {
		expect(ids(orderedCards([]))).toEqual(DEFAULT);
	});

	it("follows a saved order", () => {
		const saved = [...DEFAULT].reverse();
		expect(ids(orderedCards(saved))).toEqual(saved);
	});

	it("drops ids it does not know and repeated ones, and puts a card the saved order lacks after its default predecessor", () => {
		const saved = ["sleep", "nonsense", "hrv", "sleep", "steps"];
		const out = ids(orderedCards(saved));
		expect(new Set(out).size).toBe(DEFAULT.length);
		expect(out.filter((id) => ["sleep", "hrv", "steps"].includes(id))).toEqual(["sleep", "hrv", "steps"]);
		// the card after "hrv" in the default order, "resting_hr", follows hrv
		expect(out[out.indexOf("hrv") + 1]).toBe("resting_hr");
		// "stages" follows "sleep" as in the default order, and "today", which has no predecessor, goes first
		expect(out[out.indexOf("sleep") + 1]).toBe("stages");
		expect(out[0]).toBe("today");
	});
});

describe("makeSortable", () => {
	function list(): { list: HTMLElement; rows: HTMLElement[]; onDrop: ReturnType<typeof vi.fn> } {
		const el = document.createElement("div");
		document.body.appendChild(el);
		const rows = ["a", "b", "c"].map((id) => {
			const row = el.createDiv({ cls: "ghs-sort-row", attr: { "data-id": id } });
			row.createEl("button", { cls: "ghs-sort-handle" });
			// every row is 40 px high and sits where it is in the list
			row.getBoundingClientRect = () => ({ top: Array.from(el.children).indexOf(row) * 40, height: 40 }) as DOMRect;
			return row;
		});
		const onDrop = vi.fn();
		makeSortable(el, onDrop);
		return { list: el, rows, onDrop };
	}
	const order = (el: HTMLElement): string[] => Array.from(el.children).map((c) => (c as HTMLElement).dataset["id"] ?? "");
	const pointer = (type: string, y = 0, button = 0): Event => Object.assign(new window.Event(type, { cancelable: true }), { clientY: y, button });

	afterEach(() => (document.body.innerHTML = ""));

	it("moves a row with the pointer and reports the order when it is let go", () => {
		const { list: el, rows, onDrop } = list();
		const handle = rows[0]!.querySelector(".ghs-sort-handle")!;
		const down = pointer("pointerdown");
		handle.dispatchEvent(down);
		expect(down.defaultPrevented).toBe(true);
		expect(rows[0]!.classList.contains("ghs-sort-dragging")).toBe(true);
		document.dispatchEvent(pointer("pointermove", 100)); // below every row
		expect(order(el)).toEqual(["b", "c", "a"]);
		document.dispatchEvent(pointer("pointermove", 45)); // in the middle of the second slot
		expect(order(el)).toEqual(["b", "a", "c"]);
		document.dispatchEvent(pointer("pointermove", 5)); // above everything
		expect(order(el)).toEqual(["a", "b", "c"]);
		document.dispatchEvent(pointer("pointermove", 100));
		document.dispatchEvent(pointer("pointerup"));
		expect(onDrop).toHaveBeenCalledWith(["b", "c", "a"]);
		expect(rows[0]!.classList.contains("ghs-sort-dragging")).toBe(false);
		document.dispatchEvent(pointer("pointermove", 5));
		expect(order(el)).toEqual(["b", "c", "a"]); // no longer follows the pointer
	});

	it("ends a drag that was cancelled, and ignores a click with another button", () => {
		const { rows, onDrop } = list();
		const handle = rows[1]!.querySelector(".ghs-sort-handle")!;
		handle.dispatchEvent(pointer("pointerdown", 0, 2));
		expect(onDrop).not.toHaveBeenCalled();
		handle.dispatchEvent(pointer("pointerdown"));
		document.dispatchEvent(pointer("pointercancel"));
		expect(onDrop).toHaveBeenCalledOnce();
	});

	it("moves a row with the arrow keys and keeps the focus on its handle", () => {
		const { list: el, rows, onDrop } = list();
		const handle = rows[1]!.querySelector(".ghs-sort-handle") as HTMLElement;
		const key = (k: string): Event => Object.assign(new window.Event("keydown", { cancelable: true }), { key: k });
		handle.dispatchEvent(key("ArrowUp"));
		expect(order(el)).toEqual(["b", "a", "c"]);
		expect(onDrop).toHaveBeenLastCalledWith(["b", "a", "c"]);
		handle.dispatchEvent(key("ArrowUp")); // already first: stays
		expect(order(el)).toEqual(["b", "a", "c"]);
		handle.dispatchEvent(key("ArrowDown"));
		handle.dispatchEvent(key("ArrowDown"));
		expect(order(el)).toEqual(["a", "c", "b"]);
		handle.dispatchEvent(key("ArrowDown")); // already last: stays
		expect(order(el)).toEqual(["a", "c", "b"]);
		const other = key("Tab");
		handle.dispatchEvent(other);
		expect(other.defaultPrevented).toBe(false);
	});
});

describe("the panel: day picker and arranging the cards", () => {
	function open(settings: Partial<typeof DEFAULT_SETTINGS> = {}) {
		const app = new App();
		const saveSettings = vi.fn(async () => undefined);
		const plugin = { settings: { ...DEFAULT_SETTINGS, panelCards: {}, panelOrder: [], ...settings }, saveSettings };
		const view = new HealthPanelView(new WorkspaceLeaf(app) as never, plugin as never);
		return { app, plugin, view, saveSettings };
	}
	const input = (view: HealthPanelView): HTMLInputElement => view.contentEl.querySelector(".ghs-daynav-input") as HTMLInputElement;
	const date = (view: HealthPanelView): string => view.contentEl.querySelector(".ghs-daynav-date")?.textContent ?? "";
	const titles = (view: HealthPanelView): string[] => Array.from(view.contentEl.querySelectorAll(".ghs-card-title")).map((e) => e.textContent ?? "");
	const pick = (view: HealthPanelView, value: string): void => {
		input(view).value = value;
		input(view).dispatchEvent(new window.Event("change"));
	};

	it("offers a date field over the date, set to the shown day and closed to the future", async () => {
		const { view } = open();
		await view.onOpen();
		expect(input(view).type).toBe("date");
		expect(input(view).value).toBe("2026-10-22");
		expect(input(view).getAttribute("max")).toBe("2026-10-22");
		expect(input(view).getAttribute("aria-label")).toBe(en.panelPickDay);
		expect(view.contentEl.querySelector(".ghs-daynav-pick .ghs-daynav-icon")).not.toBeNull(); // a calendar icon says the date can be tapped
	});

	it("goes to the day that was picked and not to an empty or future one", async () => {
		const { view } = open();
		await view.onOpen();
		pick(view, "2026-09-30");
		expect(date(view)).toBe(formatPanelDate("2026-09-30", "en"));
		expect(input(view).value).toBe("2026-09-30");
		pick(view, "");
		expect(date(view)).toBe(formatPanelDate("2026-09-30", "en"));
		pick(view, "2026-10-23");
		expect(date(view)).toBe(formatPanelDate("2026-09-30", "en"));
	});

	it("opens the calendar of the system on a click, and copes with a browser that does not allow it", async () => {
		const { view } = open();
		await view.onOpen();
		const show = vi.fn();
		(input(view) as unknown as { showPicker: () => void }).showPicker = show;
		input(view).click();
		expect(show).toHaveBeenCalledOnce();
		(input(view) as unknown as { showPicker: () => void }).showPicker = () => {
			throw new Error("NotAllowedError");
		};
		expect(() => input(view).click()).not.toThrow();
		(input(view) as unknown as { showPicker?: () => void }).showPicker = undefined;
		expect(() => input(view).click()).not.toThrow();
	});

	it("shows the cards in the saved order", async () => {
		const { view } = open({ panelOrder: ["steps", "hrv"], panelCards: { today: false } });
		await view.onOpen();
		const order = titles(view);
		expect(order.indexOf(en.panelStepsTitle)).toBeLessThan(order.indexOf(en.panelHrvTitle));
		expect(order.indexOf(en.panelHrvTitle)).toBeLessThan(order.indexOf(en.panelRestingHrTitle));
	});

	it("switches to a list with a handle for every card that is on, and back with the same button", async () => {
		const { view } = open({ panelCards: { today: false, sessions: false } });
		await view.onOpen();
		const edit = (): HTMLButtonElement => view.contentEl.querySelector(".ghs-daynav .clickable-icon:last-child") as HTMLButtonElement;
		expect(edit().getAttribute("aria-label")).toBe(en.panelEdit);
		edit().click();
		expect(view.contentEl.querySelector(".ghs-card")).toBeNull();
		expect(view.contentEl.querySelector(".ghs-edit-hint")?.textContent).toBe(en.panelEditHint);
		const rows = Array.from(view.contentEl.querySelectorAll<HTMLElement>(".ghs-sort-row"));
		expect(rows).toHaveLength(PANEL_CARDS.length - 2);
		expect(rows[0]!.querySelector(".ghs-sort-title")?.textContent).toBe(en.panelHrvTitle);
		expect(rows[0]!.querySelector(".ghs-sort-section")?.textContent).toBe(en.panelSectionRecovery);
		expect(rows[0]!.querySelector("button")?.getAttribute("aria-label")).toBe(`Move ${en.panelHrvTitle}`);
		expect(edit().getAttribute("aria-label")).toBe(en.panelEditDone);
		edit().click();
		expect(view.contentEl.querySelector(".ghs-sort")).toBeNull();
		expect(view.contentEl.querySelector(".ghs-card")).not.toBeNull();
	});

	it("saves the order after a move and draws the cards in it", async () => {
		const { view, plugin, saveSettings } = open({ panelCards: { today: false } });
		await view.onOpen();
		(view.contentEl.querySelector(".ghs-daynav .clickable-icon:last-child") as HTMLButtonElement).click();
		const second = view.contentEl.querySelectorAll(".ghs-sort-row")[1]!.querySelector(".ghs-sort-handle") as HTMLElement;
		second.dispatchEvent(Object.assign(new window.Event("keydown", { cancelable: true }), { key: "ArrowUp" }));
		await vi.advanceTimersByTimeAsync(0);
		expect(saveSettings).toHaveBeenCalledOnce();
		expect(plugin.settings.panelOrder.slice(0, 2)).toEqual(["resting_hr", "hrv"]);
		expect(view.contentEl.querySelectorAll(".ghs-sort-row")[0]!.querySelector(".ghs-sort-title")?.textContent).toBe(en.panelRestingHrTitle);
		(view.contentEl.querySelector(".ghs-daynav .clickable-icon:last-child") as HTMLButtonElement).click();
		expect(titles(view).indexOf(en.panelRestingHrTitle)).toBeLessThan(titles(view).indexOf(en.panelHrvTitle));
	});

	it("goes back to the default order with the reset button, in the user's language", async () => {
		const { view, plugin, saveSettings } = open({ language: "de", panelOrder: ["steps", "hrv"], panelCards: { today: false } });
		await view.onOpen();
		(view.contentEl.querySelector(".ghs-daynav .clickable-icon:last-child") as HTMLButtonElement).click();
		const reset = view.contentEl.querySelector(".ghs-edit-reset") as HTMLButtonElement;
		expect(reset.textContent).toBe(de.panelEditReset);
		reset.click();
		await vi.advanceTimersByTimeAsync(0);
		expect(plugin.settings.panelOrder).toEqual([]);
		expect(saveSettings).toHaveBeenCalledOnce();
		expect(view.contentEl.querySelectorAll(".ghs-sort-row")[0]!.querySelector(".ghs-sort-title")?.textContent).toBe(de.panelHrvTitle);
	});
});
