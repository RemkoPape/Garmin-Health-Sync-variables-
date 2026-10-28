// Why it matters: the what's new window shows small illustrations drawn with the real panel code. They are the
// part of the window that tells a user where to switch things on, so every one must draw, in every language, and
// must stay decoration (hidden from screen readers) that cannot be clicked into a changed setting.
import { describe, expect, it } from "vitest";
import { renderFigure, type FigureId } from "../src/ui/whats-new-figures";
import { WhatsNewModal } from "../src/ui/whats-new-modal";
import { notesOfLine } from "../src/release-notes";
import { App } from "../testUtils/mocks/obsidian";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";

/** Every figure; a new one has to be listed here, so it cannot ship undrawn. */
const FIGURE_IDS: FigureId[] = ["panel", "light-bulb", "history", "properties"];
const draw = (id: FigureId, lang = "en"): HTMLElement => renderFigure(document.createElement("div"), id, lang);

describe("what's new figures", () => {
	it.each(FIGURE_IDS)("%s draws something and is hidden from screen readers", (id) => {
		const fig = draw(id);
		expect(fig.getAttribute("aria-hidden")).toBe("true");
		expect(fig.classList.contains(`ghs-fig-${id}`)).toBe(true);
		expect(fig.childElementCount).toBeGreaterThan(0);
	});

	it("shows the switch of the side panel next to a real card", () => {
		const fig = draw("panel");
		expect(fig.querySelector(".setting-item-name")?.textContent).toBe(en.settingsPanelShow);
		expect(fig.querySelector(".checkbox-container.is-enabled")).not.toBeNull();
		expect(fig.querySelector(".ghs-card-title")?.textContent).toBe(en.panelHrvTitle);
		expect(fig.querySelector(".ghs-range")).not.toBeNull();
	});

	it("ignores a click on the light bulb of a figure: it is decoration", () => {
		const fig = draw("panel");
		(fig.querySelector(".ghs-info") as HTMLButtonElement).click();
		expect(fig.querySelector(".ghs-insight")).toBeNull();
	});

	it("shows an open light bulb with what the data suggests", () => {
		const fig = draw("light-bulb");
		expect(fig.querySelector(".ghs-insight-item")?.textContent).toBe(en.insight_rhr_high_hydration);
		expect(fig.querySelector(".ghs-card-title")?.textContent).toBe(en.panelRestingHrTitle);
	});

	it("shows the setting for days without a note with the history choice", () => {
		const fig = draw("history");
		expect(fig.querySelector(".setting-item-name")?.textContent).toBe(en.settingsMissingNote);
		expect(fig.querySelector("select option")?.textContent).toBe(en.missingNoteHistory);
		expect(fig.querySelector(".ghs-fig-file")?.textContent).toContain("Garmin history");
	});

	it("shows the properties setting and a long list against a short one", () => {
		const fig = draw("properties");
		expect(fig.querySelector(".setting-item-name")?.textContent).toBe(en.settingsProperties);
		expect(fig.querySelector("select option")?.textContent).toBe(en.propertiesFoldHide);
		const lists = Array.from(fig.querySelectorAll(".ghs-fig-bars")).map((l) => l.childElementCount);
		expect(lists).toEqual([16, 3]);
		expect(Array.from(fig.querySelectorAll(".ghs-fig-label")).map((l) => l.textContent)).toEqual([en.whatsNewBefore, en.whatsNewNow]);
	});

	it("speaks the user's language", () => {
		expect(draw("panel", "de").querySelector(".setting-item-name")?.textContent).toBe(de.settingsPanelShow);
		expect(draw("properties", "de").querySelector(".ghs-fig-label")?.textContent).toBe(de.whatsNewBefore);
	});

	it("is drawn under every item of the 0.12.0 notes that names one, and nowhere else", () => {
		const modal = new WhatsNewModal(new App() as never, "en", notesOfLine("0.12.0"));
		modal.open();
		const notes = notesOfLine("0.12.0");
		const wanted = notes.flatMap((n) => n.items.map((i) => i.figure).filter(Boolean));
		expect(wanted.length).toBeGreaterThan(0);
		expect(Array.from(modal.contentEl.querySelectorAll(".ghs-whats-new-figure")).map((f) => FIGURE_IDS.find((id) => f.classList.contains(`ghs-fig-${id}`)))).toEqual(wanted);
	});
});
