// Why it matters: the HRV card is the first thing the panel tells the user. Each state has to say the right
// thing: a missing reading must never look like a value, a young history must say why there is no range
// yet, and the colour has to follow the distance from the user's own average.
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { computeHrv, renderHrv, HRV_EARLY_MIN_DAYS, HRV_MIN_DAYS } from "../src/panel/cards/hrv";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";

const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };
const END = "2026-10-22";

/** 30 prior days alternating 58 / 62 (mean 60, sd 2), then the shown day. */
async function indexWith(today: number | null, prior = 30): Promise<DayIndex> {
	const app = new App();
	await seedHistory(app, {
		end: END,
		days: prior + 1,
		frontmatter: (ago) => (ago === 0 ? (today === null ? null : { hrv: today }) : { hrv: ago % 2 === 0 ? 62 : 58 }),
	});
	return new DayIndex(app as never, () => settings);
}

let root: HTMLElement;
beforeEach(() => {
	root = document.createElement("div");
});
const render = (model: ReturnType<typeof computeHrv>, lang = "en", open = false, toggle = () => undefined): void => renderHrv(root, model, lang, open, toggle);
const text = (sel: string): string => root.querySelector(sel)?.textContent ?? "";

describe("computeHrv", () => {
	it("compares the day with the average of the 30 days before it", async () => {
		const m = computeHrv(await indexWith(66), END);
		expect(m.value).toBe(66);
		expect(m.have).toBe(30);
		expect(m.baseline).toEqual({ mean: 60, sd: 2, n: 30 });
		expect(m.z).toBe(3);
	});

	it("has no range with fewer than the early minimum, but still reports the value", async () => {
		const m = computeHrv(await indexWith(60, HRV_EARLY_MIN_DAYS - 1), END);
		expect(m.baseline).toBeNull();
		expect(m.have).toBe(HRV_EARLY_MIN_DAYS - 1);
		expect(m.z).toBeNull();
		expect(m.value).toBe(60);
	});

	it("gives an early range from the early minimum and a reliable one from 21 days", async () => {
		const early = computeHrv(await indexWith(60, HRV_EARLY_MIN_DAYS), END);
		expect(early.baseline).not.toBeNull();
		expect(early.early).toBe(true);
		expect(computeHrv(await indexWith(60, HRV_MIN_DAYS - 1), END).early).toBe(true);
		expect(computeHrv(await indexWith(60, HRV_MIN_DAYS), END).early).toBe(false);
	});

	it("keeps the range when the day has no reading", async () => {
		const m = computeHrv(await indexWith(null), END);
		expect(m.value).toBeNull();
		expect(m.z).toBeNull();
		expect(m.baseline).not.toBeNull();
	});
});

describe("renderHrv", () => {
	it("shows the value, the usual range and a green dot inside it", async () => {
		render(computeHrv(await indexWith(61), END));
		expect(text(".ghs-card-title")).toBe("HRV");
		expect(text(".ghs-card-value")).toBe("61 ms");
		expect(text(".ghs-card-note")).toBe("Usual range 58–62 ms");
		expect(root.querySelector(".ghs-dot-ok")).not.toBeNull();
		expect(root.querySelectorAll("svg rect")).toHaveLength(2);
	});

	it.each([
		[63, "ghs-dot-warn"],
		[54, "ghs-dot-bad"],
	])("colours %s by its distance from the personal average", async (value, cls) => {
		render(computeHrv(await indexWith(value), END));
		expect(root.querySelector(`.${cls}`)).not.toBeNull();
	});

	it("places the dot as a percentage and clamps outliers to the edge", async () => {
		render(computeHrv(await indexWith(60), END));
		expect((root.querySelector(".ghs-dot") as HTMLElement).style.getPropertyValue("--ghs-x")).toBe("50%");
		root.empty();
		render(computeHrv(await indexWith(200), END));
		expect((root.querySelector(".ghs-dot") as HTMLElement).style.getPropertyValue("--ghs-x")).toBe("100%");
		root.empty();
		render(computeHrv(await indexWith(1), END));
		expect((root.querySelector(".ghs-dot") as HTMLElement).style.getPropertyValue("--ghs-x")).toBe("0%");
	});

	it("says there is no reading, never a stale value, with a dashed card and no dot", async () => {
		render(computeHrv(await indexWith(null), END));
		expect(text(".ghs-card-value")).toBe(en.panelNoReading);
		expect(root.querySelector(".ghs-card-empty")).not.toBeNull();
		expect(root.querySelector(".ghs-dot")).toBeNull();
		expect(text(".ghs-card-note")).toBe("Usual range 58–62 ms");
	});

	it("shows the range of a young history with a warning that it is likely inaccurate", async () => {
		render(computeHrv(await indexWith(60, 10), END));
		const notes = Array.from(root.querySelectorAll(".ghs-card-note")).map((n) => n.textContent);
		expect(notes).toEqual(["Usual range 58–62 ms", "Early estimate from 10 days, likely inaccurate until 21 days."]);
		expect(root.querySelector(".ghs-card-warning")).not.toBeNull();
		expect(root.querySelector(".ghs-dot")).not.toBeNull();
	});

	it("shows no warning once the history is long enough", async () => {
		render(computeHrv(await indexWith(60), END));
		expect(root.querySelector(".ghs-card-warning")).toBeNull();
	});

	it("explains why there is no range yet", async () => {
		render(computeHrv(await indexWith(60, 3), END));
		expect(text(".ghs-card-note")).toBe("Unlocks after 5 days of data · 3 so far");
		expect(root.querySelector(".ghs-range")).toBeNull();
	});

	it("formats numbers and texts in the plugin language", async () => {
		render(computeHrv(await indexWith(61.5), END), "de");
		expect(text(".ghs-card-value")).toBe("61,5 ms");
		expect(text(".ghs-card-note")).toBe("Üblicher Bereich 58–62 ms");
		expect(root.querySelector("button")?.getAttribute("aria-label")).toBe(de.panelInfo);
	});

	it("toggles the explanation behind the (i) button", async () => {
		let toggled = 0;
		const model = computeHrv(await indexWith(61), END);
		render(model, "en", false, () => void toggled++);
		const info = root.querySelector("button") as HTMLButtonElement;
		expect(info.getAttribute("aria-expanded")).toBe("false");
		expect(root.querySelector(".ghs-explain")).toBeNull();
		info.click();
		expect(toggled).toBe(1);
		root.empty();
		render(model, "en", true);
		expect(root.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
		expect(text(".ghs-explain")).toBe(en.panelHrvExplain);
	});
});
