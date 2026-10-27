// Why it matters: the dialog is where the user learns that building the history takes hours, so it must show
// the estimate for the chosen start date and hand that date on.
import { describe, expect, it, vi } from "vitest";
import { App, Modal } from "../testUtils/mocks/obsidian";
import { BuildHistoryModal } from "../src/ui/build-history-modal";
import { en } from "../src/i18n/en";

describe("the build history dialog", () => {
	function open(onSubmit = vi.fn(), lang = "en") {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 9, 25, 12));
		new BuildHistoryModal(new App() as never, lang, "2026-10-24", 3000, 6, onSubmit).open();
		const modal = Modal.opened.at(-1)!;
		return {
			modal,
			date: modal.contentEl.querySelector("input") as HTMLInputElement,
			estimate: modal.contentEl.querySelector(".ghs-history-estimate")!,
			start: modal.contentEl.querySelector("button.mod-cta") as HTMLButtonElement,
		};
	}

	it("explains what happens and starts five years back", () => {
		const { modal, date } = open();
		expect(modal.contentEl.querySelector("h2")?.textContent).toBe(en.modalHistoryTitle);
		expect(modal.contentEl.querySelector("p")?.textContent).toBe(en.modalHistoryDesc);
		expect(date.type).toBe("date");
		expect(date.value).toBe("2021-10-26");
	});

	it("estimates the time from the delay between days plus the time of the requests, and updates it", () => {
		const { date, estimate } = open();
		// 2021-10-26 to 2026-10-24 is 1825 days at 3 s + 1.5 s = 4.5 s: 8212.5 s, about 2 h 17 min
		expect(estimate.textContent).toBe("About 2 h 17 min for up to 1825 days with 6 metrics.");
		date.value = "2026-10-14";
		date.dispatchEvent(new window.Event("input"));
		expect(estimate.textContent).toBe("About 1 min for up to 11 days with 6 metrics.");
		date.value = "";
		date.dispatchEvent(new window.Event("input"));
		expect(estimate.textContent).toBe("About 1 min for up to 11 days with 6 metrics.");
	});

	it("hands the date on and closes", () => {
		const onSubmit = vi.fn();
		const { modal, date, start } = open(onSubmit);
		date.value = "2024-01-01";
		date.dispatchEvent(new window.Event("input"));
		start.click();
		expect(onSubmit).toHaveBeenCalledWith("2024-01-01");
		expect(modal.isOpen).toBe(false);
	});

	it("says no days for a start date after yesterday", () => {
		const { date, estimate } = open();
		date.value = "2026-12-01";
		date.dispatchEvent(new window.Event("input"));
		expect(estimate.textContent).toContain("for up to 0 days");
	});
});
