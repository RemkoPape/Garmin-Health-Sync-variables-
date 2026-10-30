// Why it matters: the dialog is where the user chooses how far back to go and what happens to days without a
// note, and learns that a long backfill takes hours. It must show the estimate for the chosen range and hand
// every choice on.
import { describe, expect, it, vi } from "vitest";
import { App, Modal, Setting } from "../testUtils/mocks/obsidian";
import { BackfillModal, type BackfillRequest } from "../src/ui/backfill-modal";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";

describe("the backfill dialog", () => {
	function open(onSubmit: (request: BackfillRequest) => void = vi.fn(), lang = "en", behaviour: "create" | "history" | "skip" = "create") {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 9, 25, 12));
		Setting.all = [];
		new BackfillModal(new App() as never, lang, behaviour, 3000, 6, onSubmit).open();
		const modal = Modal.opened.at(-1)!;
		const [from, to] = Array.from(modal.contentEl.querySelectorAll("input")).filter((i) => i.type === "date") as HTMLInputElement[];
		return {
			modal,
			from: from!,
			to: to!,
			until: Setting.all[2]!.toggles[0]!,
			dropdown: Setting.all[3]!.dropdowns[0]!,
			again: Setting.all[4]!.toggles[0]!,
			estimate: modal.contentEl.querySelector(".ghs-history-estimate")!,
			start: modal.contentEl.querySelector("button.mod-cta") as HTMLButtonElement,
		};
	}
	const type = (input: HTMLInputElement, value: string): void => {
		input.value = value;
		input.dispatchEvent(new window.Event("input"));
	};

	it("explains what happens and starts with the last week", () => {
		const { modal, from, to } = open();
		expect(modal.contentEl.querySelector("h2")?.textContent).toBe(en.modalBackfillTitle);
		expect(modal.contentEl.querySelector("p")?.textContent).toBe(en.modalBackfillDesc);
		expect([from.value, to.value]).toEqual(["2026-10-18", "2026-10-25"]);
		expect([from.type, to.type]).toEqual(["date", "date"]);
	});

	it("estimates the time from the delay between days plus the time of the requests, and updates it", () => {
		const { from, to, estimate } = open();
		// 8 days at 3 s + 1.5 s = 36 s
		expect(estimate.textContent).toBe("About 1 min for up to 8 days with 6 metrics.");
		type(from, "2025-10-25");
		// 366 days: 1647 s
		expect(estimate.textContent).toBe("About 28 min for up to 366 days with 6 metrics.");
		type(to, "2026-10-24");
		expect(estimate.textContent).toBe("About 28 min for up to 365 days with 6 metrics.");
		type(from, "");
		expect(estimate.textContent).toBe("About 28 min for up to 365 days with 6 metrics.");
		type(to, "");
		expect(estimate.textContent).toBe("About 28 min for up to 365 days with 6 metrics.");
	});

	it("goes back until the data starts, up to five years, and the start date gives way to the switch", () => {
		const { from, until, estimate } = open();
		until.set(true);
		expect(from.disabled).toBe(true);
		// 2021-10-26 to 2026-10-25 is 1826 days at 4.5 s: about 2 h 17 min
		expect(estimate.textContent).toBe("About 2 h 17 min for up to 1826 days with 6 metrics.");
		until.set(false);
		expect(from.disabled).toBe(false);
		expect(estimate.textContent).toBe("About 1 min for up to 8 days with 6 metrics.");
	});

	it("offers the three choices for days without a note, starting from the setting", () => {
		const { dropdown } = open(vi.fn(), "en", "history");
		expect(dropdown.selectEl.value).toBe("history");
		expect(Array.from(dropdown.selectEl.options).map((o) => o.textContent)).toEqual([en.missingNoteCreate, en.missingNoteHistory, en.missingNoteSkip]);
		expect(Setting.all[3]!.nameEl.textContent).toBe(en.settingsMissingNote);
	});

	it("hands the range and every choice on, and closes", () => {
		const onSubmit = vi.fn();
		const { modal, from, to, dropdown, again, until, start } = open(onSubmit);
		type(from, "2024-01-01");
		type(to, "2024-03-01");
		dropdown.choose("skip");
		again.set(true);
		start.click();
		expect(onSubmit).toHaveBeenCalledWith({ from: "2024-01-01", to: "2024-03-01", force: true, behaviour: "skip", untilStart: false });
		expect(modal.isOpen).toBe(false);
		until.set(false);
	});

	it("hands the day five years back on when the data is wanted from the start", () => {
		const onSubmit = vi.fn();
		const { until, start } = open(onSubmit);
		until.set(true);
		start.click();
		expect(onSubmit).toHaveBeenCalledWith({ from: "2021-10-26", to: "2026-10-25", force: false, behaviour: "create", untilStart: true });
	});

	it("says no days for an end date before the start", () => {
		const { to, estimate } = open();
		type(to, "2026-10-01");
		expect(estimate.textContent).toContain("for up to 0 days");
	});

	it("speaks the user's language and clears itself when closed", () => {
		const { modal } = open(vi.fn(), "de");
		expect(modal.contentEl.querySelector("h2")?.textContent).toBe(de.modalBackfillTitle);
		modal.close();
		expect(modal.contentEl.children).toHaveLength(0);
	});
});
