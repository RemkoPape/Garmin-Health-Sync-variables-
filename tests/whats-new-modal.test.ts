// Why it matters: the window may only be left through its button. If Escape, a click next to it or the
// phone's back gesture could dismiss it, the user would never have confirmed they read it.
import { describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { WhatsNewModal } from "../src/ui/whats-new-modal";
import type { ReleaseNote } from "../src/release-notes";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";

const NOTE: ReleaseNote = {
	version: "0.11.2",
	title: "whatsNew0112Title",
	intro: "whatsNew0112Intro",
	items: [
		{ title: "whatsNew0112Item1Title", text: "whatsNew0112Item1Text" },
		{ title: "whatsNew0112Item2Title", text: "whatsNew0112Item2Text" },
	],
};
const OLDER: ReleaseNote = { ...NOTE, version: "0.11.0" };

function open(notes: ReleaseNote[] = [NOTE], lang = "en") {
	const modal = new WhatsNewModal(new App() as never, lang, notes);
	modal.open();
	const button = modal.contentEl.querySelector("button")!;
	const isOpen = (): boolean => (modal as unknown as { isOpen: boolean }).isOpen;
	return { modal, root: modal.contentEl, button, isOpen };
}

describe("content", () => {
	it("shows the title, the release heading, the intro and one line per item", () => {
		const { root } = open();
		expect(root.querySelector("h2")?.textContent).toBe(en.whatsNewTitle);
		expect(root.querySelector("h3")?.textContent).toBe(`0.11.2 — ${en.whatsNew0112Title}`);
		expect(root.querySelector(".ghs-whats-new-intro")?.textContent).toBe(en.whatsNew0112Intro);
		expect([...root.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
			`${en.whatsNew0112Item1Title} — ${en.whatsNew0112Item1Text}`,
			`${en.whatsNew0112Item2Title} — ${en.whatsNew0112Item2Text}`,
		]);
		expect(root.querySelector("li strong")?.textContent).toBe(en.whatsNew0112Item1Title);
	});

	it("says how many updates are caught up only when there are several", () => {
		expect(open([NOTE]).root.textContent).not.toContain("catching up");
		const several = open([OLDER, NOTE]);
		expect(several.root.querySelector("p")?.textContent).toBe(en.whatsNewCatchUp.replace("{count}", "2"));
		expect([...several.root.querySelectorAll("h3")].map((h) => h.textContent?.slice(0, 6))).toEqual(["0.11.0", "0.11.2"]);
	});

	it("speaks the user's language", () => {
		const { root, button } = open([NOTE], "de");
		expect(root.querySelector("h2")?.textContent).toBe(de.whatsNewTitle);
		expect(button.textContent).toBe(de.whatsNewGotIt);
	});

	it("marks its window and has the button focused", () => {
		const { modal, button } = open();
		expect(modal.modalEl.classList.contains("ghs-whats-new-modal")).toBe(true);
		expect(document.activeElement === button || !button.isConnected).toBe(true);
		expect(button.classList.contains("mod-cta")).toBe(true);
		expect(button.textContent).toBe(en.whatsNewGotIt);
	});
});

describe("closing", () => {
	it("closes and empties the window when Got it is pressed", () => {
		const { root, button, isOpen } = open();
		button.click();
		expect(isOpen()).toBe(false);
		expect(root.childElementCount).toBe(0);
	});

	it("closes every other way too (close icon, Escape, a click outside and the back gesture all call close()), so nobody is stuck", () => {
		const icon = open();
		(icon.modal.modalEl.querySelector(".modal-close-button") as HTMLElement).click();
		expect(icon.isOpen()).toBe(false);
		const other = open();
		other.modal.close();
		expect(other.isOpen()).toBe(false);
		expect(other.root.childElementCount).toBe(0);
	});
});
