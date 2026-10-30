// Why it matters: the Habits card is where the lifestyle log becomes something to act on. It has to show what was
// logged, say plainly when there is too little to compare and name only clear patterns under the light bulb.
import { describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { PANEL_CARDS } from "../src/panel/cards";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";
import { insightText } from "../src/panel/insights/registry";
import { computeHabitsCard, squareLabels } from "../src/panel/cards/habits-card";
import { habitInsights } from "../src/panel/insights/lifestyle";

const END = "2026-10-22";
const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };
const NAMES = { lifestyle_alcohol: { name: "Alcohol", kind: "check" as const, last: END }, lifestyle_coffee: { name: "Late caffeine", kind: "count" as const, last: END } };
const noise = (i: number): number => (((i * 37) % 11) - 5) * 0.3;
const on = (ago: number): boolean => {
	let x = Math.imul(ago + 1, 0x9e3779b1);
	x ^= x >>> 15;
	x = Math.imul(x, 0x85ebca6b);
	x ^= x >>> 13;
	return (x & 1) === 0;
};

async function render(days: number, frontmatter: (ago: number) => Record<string, unknown> | null, options: { lang?: string; open?: boolean; habits?: typeof NAMES; hidden?: string[]; onHide?: (key: string, hide: boolean) => void } = {}): Promise<HTMLElement> {
	const app = new App();
	await seedHistory(app, { end: END, days, frontmatter });
	const parent = document.createElement("div");
	const card = PANEL_CARDS.find((c) => c.id === "habits")!;
	card.render({ parent, index: new DayIndex(app as never, () => settings), date: END, lang: options.lang ?? "en", imperial: false, birthYear: null, habits: options.habits ?? NAMES, hiddenHabits: options.hidden ?? [], onHideHabit: options.onHide ?? (() => undefined), explainOpen: options.open ?? false, onToggleExplain: () => undefined });
	return parent;
}
const text = (el: Element | null | undefined): string => el?.textContent ?? "";

describe("the Habits card", () => {
	it("sits in the Recovery section and needs the lifestyle log", () => {
		const card = PANEL_CARDS.find((c) => c.id === "habits")!;
		expect(card.section).toBe("recovery");
		expect(card.metrics).toEqual(["lifestyle_log"]);
		expect(card.extra).toEqual(["hrv", "resting_hr"]);
	});

	it("says there is nothing to show while no habit was logged in the last 30 days", async () => {
		const parent = await render(40, () => ({ hrv: 50 }));
		expect(text(parent.querySelector(".ghs-card-title"))).toBe(en.panelHabitsTitle);
		expect(text(parent.querySelector(".ghs-card-note"))).toBe(en.panelHabitsEmpty);
		expect(parent.querySelector(".ghs-habit")).toBeNull();
	});

	it("shows one compact row per habit: the day's status, the week, the run and a strip or columns", async () => {
		const parent = await render(80, (ago) => ({ lifestyle_alcohol: ago === 0 ? 0 : on(ago) ? 1 : 0, lifestyle_coffee: ago < 4 ? (ago === 0 ? 5 : 1) : 0, hrv: 50, resting_hr: 55 }));
		const rows = Array.from(parent.querySelectorAll(".ghs-habit"));
		expect(rows.map((r) => text(r.querySelector(".ghs-habit-name")).replace(/\s+/g, " ").trim()).sort()).toEqual(["✓ Late caffeine ×5", "✗ Alcohol"]);
		const coffee = rows.find((r) => text(r).includes("Late caffeine"))!;
		expect(text(coffee.querySelector(".ghs-habit-note"))).toBe("Ø 1.1 a day ↑ · 4 in a row");
		expect(text(rows.find((r) => text(r).includes("Alcohol"))!.querySelector(".ghs-habit-note"))).toMatch(/^\d of 7 days/);
		expect(coffee.querySelectorAll(".ghs-habit-col")).toHaveLength(14);
		expect(coffee.querySelectorAll(".ghs-habit-strip")).toHaveLength(0);
		expect(coffee.querySelector(".ghs-habit-yes")).not.toBeNull();
		expect(rows.find((r) => text(r).includes("Alcohol"))!.querySelector(".ghs-habit-no")).not.toBeNull();
		expect(parent.querySelectorAll(".ghs-habit-strip .ghs-habit-dot")).toHaveLength(14);
		expect(parent.querySelectorAll(".ghs-habit-legend .ghs-habit-dot")).toHaveLength(3);
		expect(parent.querySelector(".ghs-habit-tag")).toBeNull();
	});

	it("draws a clear better night green to the right and a clear worse one orange to the left", async () => {
		const parent = await render(80, (ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, lifestyle_coffee: on(ago) ? 1 : 0, hrv: 50 + (on(ago + 1) ? 8 : 0) + noise(ago), resting_hr: 55 + (on(ago + 1) ? 3 : 0) + noise(ago + 3) * 0.5 }));
		const rows = Array.from(parent.querySelectorAll(".ghs-habit"));
		const hrv = rows[0]!.querySelectorAll(".ghs-habit-effect")[0]!;
		const rhr = rows[0]!.querySelectorAll(".ghs-habit-effect")[1]!;
		expect(text(hrv.querySelector(".ghs-habit-effect-label"))).toBe(en.panelHabitsHrv);
		expect(hrv.querySelector(".ghs-habit-fill-good.ghs-habit-fill-right")).not.toBeNull();
		expect(text(hrv.querySelector(".ghs-habit-value"))).toMatch(/^\+\d+ ms$/);
		expect(text(rhr.querySelector(".ghs-habit-effect-label"))).toBe(en.panelHabitsRhr);
		expect(rhr.querySelector(".ghs-habit-fill-bad.ghs-habit-fill-left")).not.toBeNull();
		expect(text(rhr.querySelector(".ghs-habit-value"))).toMatch(/^\+\d+ bpm$/);
		expect(rhr.querySelector(".ghs-habit-bar")!.getAttribute("aria-label")).toContain("bpm");
	});

	it("draws the bar of the measure that has data and none for the other", async () => {
		const noPulse = await render(80, (ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, hrv: 50 + noise(ago * 7) }));
		expect(Array.from(noPulse.querySelectorAll(".ghs-habit-effect-label")).map(text)).toEqual([en.panelHabitsHrv]);
		const noHrv = await render(80, (ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, resting_hr: 55 + noise(ago * 7) }));
		expect(Array.from(noHrv.querySelectorAll(".ghs-habit-effect-label")).map(text)).toEqual([en.panelHabitsRhr]);
	});

	it("shows no tick or cross for a day on which nothing was logged, and keeps the run of the days before", async () => {
		const parent = await render(80, (ago) => (ago === 0 ? { hrv: 50 } : { lifestyle_alcohol: ago <= 3 ? 1 : ago === 4 ? 0 : on(ago) ? 1 : 0, hrv: 50 }));
		const row = parent.querySelector(".ghs-habit")!;
		expect(row.querySelector(".ghs-habit-yes, .ghs-habit-no")).toBeNull();
		expect(text(row.querySelector(".ghs-habit-note"))).toContain("3 in a row");
	});

	it("shows a difference that is not clear in grey", async () => {
		const parent = await render(80, (ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, hrv: 50 + noise(ago * 7), resting_hr: 55 }));
		expect(parent.querySelector(".ghs-habit-fill-flat")).not.toBeNull();
		expect(parent.querySelector(".ghs-habit-value-flat")).not.toBeNull();
	});

	it("says what it needs when there are too few days to compare, with the days it has", async () => {
		const parent = await render(30, (ago) => ({ lifestyle_alcohol: ago < 5 ? ago % 2 : 0, hrv: 50, resting_hr: 55 }), { habits: { lifestyle_alcohol: NAMES.lifestyle_alcohol } as never });
		const row = parent.querySelector(".ghs-habit")!;
		expect(row.querySelector(".ghs-habit-progress")!.getAttribute("aria-label")).toBe("2/8 · 8/8");
		expect(text(row)).not.toContain("Compare");
		expect(row.querySelector(".ghs-habit-effect")).toBeNull();
	});

	it("is shown in the plugin language", async () => {
		const parent = await render(80, (ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, hrv: 50 + noise(ago * 7) }), { lang: "de" });
		expect(text(parent.querySelector(".ghs-card-title"))).toBe(de.panelHabitsTitle);
		expect(text(parent.querySelector(".ghs-habit-legend"))).toContain(de.panelHabitsBarsHint);
	});

	it("folds the light bulb into one section per habit, closed, each holding only that habit's patterns and counts", async () => {
		const parent = await render(80, (ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, lifestyle_coffee: on(ago) ? 2 : 0, hrv: 50 - (on(ago + 1) ? 8 : 0) + noise(ago), resting_hr: 55 + (on(ago + 1) ? 3 : 0) + noise(ago + 3) * 0.5 }), { open: true });
		const groups = Array.from(parent.querySelectorAll<HTMLDetailsElement>(".ghs-insight-group"));
		expect(groups.map((g) => text(g.querySelector("summary"))).sort()).toEqual(["Alcohol", "Late caffeine"]);
		for (const g of groups) {
			expect(g.open).toBe(false);
			const name = text(g.querySelector("summary"));
			const watch = Array.from(g.querySelectorAll(".ghs-insight-watch")).map(text);
			expect(watch).toHaveLength(2);
			expect(watch.every((t) => new RegExp(`^After ${name} your (HRV is \\d+ ms lower|resting heart rate is \\d+ bpm higher) than after days without it \\(\\d+ days against \\d+\\)\\.$`).test(t))).toBe(true);
			expect(g.querySelectorAll(".ghs-fact").length).toBeGreaterThan(0);
			expect(g.querySelector("summary")!.classList.contains("ghs-insight-group-watch")).toBe(true);
		}
		expect(parent.querySelector(".ghs-insight > .ghs-insight-item")).toBeNull();
		expect(text(parent.querySelector(".ghs-explain"))).toBe(en.panelHabitsExplain);
	});

	it("marks a habit with a better night as good and a habit with nothing to say as neither", async () => {
		const parent = await render(80, (ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, lifestyle_coffee: on(ago + 5) ? 1 : 0, hrv: 50 + (on(ago + 1) ? 8 : 0) + noise(ago) }), { open: true });
		const byName = (n: string): Element => Array.from(parent.querySelectorAll(".ghs-insight-group > summary")).find((s) => text(s) === n)!;
		expect(byName("Alcohol").classList.contains("ghs-insight-group-good")).toBe(true);
		expect(byName("Late caffeine").className).toBe("ghs-insight-group-title");
	});
});

describe("what the habits say with little data", () => {
	it("lists the counts behind every habit and the weekly average of a counted one under the light bulb", async () => {
		const parent = await render(40, (ago) => ({ lifestyle_alcohol: ago % 2, lifestyle_coffee: ago < 3 ? 3 : ago < 7 ? 2 : 0 }), { open: true });
		const items = Array.from(parent.querySelectorAll(".ghs-fact")).map(text);
		expect(items).toContain("Alcohol: logged on 40 of the last 90 days, 20 with the habit and 20 as no.");
		expect(items).toContain("Late caffeine: 2.4 a day on average over the last 7 days, 17 in total.");
		expect(items).toContain("Late caffeine: 0 a day in the 4 weeks before.");
		expect(items.some((t) => t.startsWith("Alcohol:") && t.includes("a day"))).toBe(false);
		expect(items).toContain("Alcohol: the comparison with the night after starts at 8 days with and 8 without the habit, 20 and 19 so far.");
	});

	it("tells a habit that is only ever logged as yes what to log", async () => {
		const parent = await render(40, () => ({ lifestyle_alcohol: 1, hrv: 50 }), { open: true });
		expect(Array.from(parent.querySelectorAll(".ghs-insight-watch")).map(text)).toContain("Alcohol: only 0 days logged as no so far. Log a no on the days you skip it, so the nights after it can be compared.");
	});
});

describe("without a sign-in", () => {
	it("lists the habits of the notes by their names although the plugin has none saved, and still hides a habit that was dropped", async () => {
		const frontmatter = (ago: number): Record<string, unknown> => ({ lifestyle_alcohol: on(ago) ? 1 : 0, lifestyle_late_caffeine: 2 + (ago % 3), hrv: 50 });
		const parent = await render(40, frontmatter, { habits: {} as never });
		expect(Array.from(parent.querySelectorAll(".ghs-habit-name")).map((e) => text(e).replace(/\s+/g, " ").trim().replace(/^[✓✗] /, "").replace(/ ×\d+$/, "")).sort()).toEqual(["Alcohol", "Late caffeine"]);
		expect(parent.querySelectorAll(".ghs-habit-col")).toHaveLength(14);
		// a habit Garmin no longer lists is hidden, one only the notes know stays (it has no listing to be dropped by)
		const dropped = await render(40, frontmatter, { habits: { lifestyle_alcohol: { name: "Alcohol", kind: "check", last: "2026-10-01" }, lifestyle_other: { name: "Other", kind: "check", last: END } } as never });
		expect(Array.from(dropped.querySelectorAll(".ghs-habit-name")).map((e) => text(e).replace(/\s+/g, " ").trim().replace(/^[✓✗] /, "").replace(/ ×\d+$/, ""))).toEqual(["Late caffeine"]);
	});
});

describe("hiding a habit in the card", () => {
	const frontmatter = (ago: number): Record<string, unknown> => ({ lifestyle_alcohol: ago === 0 ? 0 : on(ago) ? 1 : 0, lifestyle_coffee: ago === 0 ? 3 : 1 });

	it("has a hide button on every row that hides that habit", async () => {
		const calls: [string, boolean][] = [];
		const parent = await render(60, frontmatter, { onHide: (key, hide) => calls.push([key, hide]) });
		const buttons = Array.from(parent.querySelectorAll<HTMLButtonElement>(".ghs-habit-hide"));
		expect(buttons.map((b) => b.getAttribute("aria-label")).sort()).toEqual(["Hide Alcohol", "Hide Late caffeine"]);
		buttons.find((b) => b.getAttribute("aria-label") === "Hide Alcohol")!.click();
		expect(calls).toEqual([["lifestyle_alcohol", true]]);
		expect(parent.querySelector(".ghs-habit-hidden")).toBeNull();
	});

	it("shows a hidden habit as a square in the colour of its day at the bottom, and a tap shows it again", async () => {
		const calls: [string, boolean][] = [];
		const parent = await render(60, frontmatter, { hidden: ["lifestyle_alcohol", "lifestyle_coffee"], onHide: (key, hide) => calls.push([key, hide]) });
		expect(parent.querySelector(".ghs-habit")).toBeNull();
		expect(parent.querySelector(".ghs-habit-legend")).toBeNull();
		expect(text(parent.querySelector(".ghs-habit-hidden .ghs-habit-note"))).toBe(en.panelHabitsHiddenHint);
		const squares = Array.from(parent.querySelectorAll<HTMLButtonElement>(".ghs-habit-square"));
		expect(squares.map((s) => [s.getAttribute("aria-label"), s.className])).toEqual([
			["Show Alcohol · No", "ghs-habit-square ghs-habit-square-no"],
			["Show Late caffeine · Yes", "ghs-habit-square ghs-habit-square-yes"],
		]);
		expect(squares.map(text)).toEqual(["A", "L"]);
		squares[0]!.click();
		expect(calls).toEqual([["lifestyle_alcohol", false]]);
	});

	it("keeps the rows of the habits that are not hidden, and marks a habit not logged today", async () => {
		const parent = await render(60, (ago) => (ago === 0 ? { lifestyle_coffee: 3 } : frontmatter(ago)), { hidden: ["lifestyle_alcohol"] });
		expect(Array.from(parent.querySelectorAll(".ghs-habit-name")).map((e) => text(e).replace(/\s+/g, " ").trim())).toEqual(["✓ Late caffeine ×3"]);
		expect(parent.querySelector(".ghs-habit-square-unknown")).not.toBeNull();
		expect(parent.querySelector(".ghs-habit-legend")).not.toBeNull();
	});

	it("leaves a hidden habit out of the light bulb", async () => {
		const parent = await render(80, (ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, hrv: 50 - (on(ago + 1) ? 8 : 0) + noise(ago) }), { open: true, hidden: ["lifestyle_alcohol"], habits: { lifestyle_alcohol: NAMES.lifestyle_alcohol } as never });
		expect(Array.from(parent.querySelectorAll(".ghs-insight-item")).map(text).join(" ")).not.toContain("Alcohol");
	});

	it("still says there is nothing to show when no habit is listed, hidden or not", async () => {
		const parent = await render(40, () => ({ hrv: 50 }), { hidden: ["lifestyle_alcohol"] });
		expect(text(parent.querySelector(".ghs-card-note"))).toBe(en.panelHabitsEmpty);
	});
});

describe("how sure a bar is", () => {
	it("says under a clear result how many nights it rests on, and under a grey one that it is not clear yet", async () => {
		const clear = await render(80, (ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, hrv: 50 + (on(ago + 1) ? 8 : 0) + noise(ago) }), { habits: { lifestyle_alcohol: NAMES.lifestyle_alcohol } as never });
		const note = text(clear.querySelector(".ghs-habit-result-note"));
		expect(note).toMatch(/^\d+ nights$/);
		expect(clear.querySelector(".ghs-habit-value-good")).not.toBeNull();
		const grey = await render(80, (ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, hrv: 50 + noise(ago * 7) }), { habits: { lifestyle_alcohol: NAMES.lifestyle_alcohol } as never });
		expect(text(grey.querySelector(".ghs-habit-result-note"))).toMatch(/^Not clear yet · \d+ nights$/);
		expect(grey.querySelector(".ghs-habit-value-flat")).not.toBeNull();
	});

	it("counts the nights of a comparison by amount, and says it in the plugin language", async () => {
		const cups = (ago: number): number => 1 + (Math.imul(ago + 3, 0x9e3779b1) >>> 29) % 5;
		const parent = await render(60, (ago) => ({ lifestyle_coffee: cups(ago), hrv: 50 + noise(ago * 7) }), { lang: "de", habits: { lifestyle_coffee: NAMES.lifestyle_coffee } as never });
		expect(text(parent.querySelector(".ghs-habit-result-note"))).toMatch(/^Noch nicht eindeutig · \d+ Nächte$/);
		expect(text(parent.querySelector(".ghs-habit-value"))).toMatch(/ je zusätzlich$/);
	});
});

describe("squareLabels", () => {
	it("is the first letter of the first word, upper case", () => {
		expect(squareLabels(["Light exercise before bed", "moderate exercise", "Vigorous Exercise"])).toEqual(["L", "M", "V"]);
		expect(squareLabels(["  Cold Showers/Baths "])).toEqual(["C"]);
	});

	it("takes more letters of the first word only for the habits that would read alike", () => {
		expect(squareLabels(["Coffees", "Cold Showers/Baths", "Running"])).toEqual(["COF", "COL", "R"]);
		expect(squareLabels(["Stretching", "Sleep", "Walk"])).toEqual(["ST", "SL", "W"]);
	});

	it("keeps a name with no word, a one-letter word and a letter outside Latin as they are", () => {
		expect(squareLabels(["", "瞑想 daily", "A b"])).toEqual(["", "瞑", "A"]);
		expect(squareLabels(["Cc", "Cc"])).toEqual(["CC", "CC"]);
	});
});

describe("a habit without an entry in the last 7 days", () => {
	it("shows its strip and no week", async () => {
		const parent = await render(60, (ago) => (ago === 10 ? { lifestyle_alcohol: 1 } : {}), { habits: { lifestyle_alcohol: NAMES.lifestyle_alcohol } as never });
		expect(text(parent.querySelector(".ghs-habit-note"))).toBe("");
		expect(parent.querySelectorAll(".ghs-habit-strip .ghs-habit-dot-yes")).toHaveLength(1);
	});
});

describe("the columns of a counted habit", () => {
	it("scale to the highest day, show a no as a low column and a missing entry as an outline, and mark a fall against the weeks before", async () => {
		const parent = await render(60, (ago) => (ago === 0 ? { lifestyle_coffee: 4 } : ago === 1 ? { lifestyle_coffee: 2 } : ago === 2 ? { lifestyle_coffee: 0 } : ago >= 7 && ago < 20 ? { lifestyle_coffee: 6 } : {}), { habits: { lifestyle_coffee: NAMES.lifestyle_coffee } as never });
		const cols = Array.from(parent.querySelectorAll<HTMLElement>(".ghs-habit-col"));
		expect(cols).toHaveLength(14);
		expect(cols[0]!.getAttribute("style")).toContain("100%");
		expect(cols[13]!.getAttribute("style")).toContain("66.6");
		expect(cols[12]!.getAttribute("style")).toContain("33.3");
		expect(cols[11]!.classList.contains("ghs-habit-col-zero")).toBe(true);
		expect(cols[10]!.classList.contains("ghs-habit-col-unknown")).toBe(true);
		expect(text(parent.querySelector(".ghs-habit-note"))).toContain("Ø 2 a day ↓");
	});

	it("shows no arrow while the week is about as usual, and none without a usual week", async () => {
		const same = await render(60, (ago) => (ago < 20 ? { lifestyle_coffee: 3 } : {}), { habits: { lifestyle_coffee: NAMES.lifestyle_coffee } as never });
		expect(text(same.querySelector(".ghs-habit-note"))).toBe("Ø 3 a day · 20 in a row");
		const fresh = await render(60, (ago) => (ago < 3 ? { lifestyle_coffee: 3 } : {}), { habits: { lifestyle_coffee: NAMES.lifestyle_coffee } as never });
		expect(text(fresh.querySelector(".ghs-habit-note"))).toBe("Ø 3 a day · 3 in a row");
	});
});

describe("a counted habit compared by amount in the card", () => {
	const cups = (ago: number): number => 1 + (Math.imul(ago + 3, 0x9e3779b1) >>> 29) % 5;
	const frontmatter = (ago: number): Record<string, unknown> => ({ lifestyle_coffee: cups(ago), hrv: 55 - 3 * cups(ago + 1) + noise(ago), resting_hr: 55 + 1.5 * cups(ago + 1) + noise(ago + 3) * 0.3 });

	it("shows the change for one more in the bar and says it under the light bulb", async () => {
		const parent = await render(60, frontmatter, { open: true, habits: { lifestyle_coffee: NAMES.lifestyle_coffee } as never });
		const values = Array.from(parent.querySelectorAll(".ghs-habit-value")).map(text);
		expect(values[0]).toMatch(/^−\d(\.\d)? ms per extra$/);
		expect(values[1]).toMatch(/^\+\d(\.\d)? bpm per extra$/);
		const items = Array.from(parent.querySelectorAll(".ghs-insight-watch")).map(text);
		expect(items.some((t) => /^The more Late caffeine you log, the lower your HRV on the night after: about \d(\.\d)? ms less for each additional one \(\d+ days\)\.$/.test(t))).toBe(true);
		expect(items.some((t) => /the higher your resting heart rate on the night after: about \d(\.\d)? bpm more/.test(t))).toBe(true);
	});

	it("names the good directions too", async () => {
		const parent = await render(60, (ago) => ({ lifestyle_coffee: cups(ago), hrv: 40 + 3 * cups(ago + 1) + noise(ago), resting_hr: 70 - 1.5 * cups(ago + 1) + noise(ago + 3) * 0.3 }), { open: true, habits: { lifestyle_coffee: NAMES.lifestyle_coffee } as never });
		const items = Array.from(parent.querySelectorAll(".ghs-insight-good")).map(text);
		expect(items.some((t) => t.includes("the higher your HRV"))).toBe(true);
		expect(items.some((t) => t.includes("the lower your resting heart rate"))).toBe(true);
	});

	it("fills the progress bar towards 14 days logged while there is too little, and says what is needed", async () => {
		const parent = await render(60, (ago) => (ago < 6 ? { lifestyle_coffee: 2 + (ago % 3), hrv: 50, resting_hr: 55 } : { hrv: 50 }), { open: true, habits: { lifestyle_coffee: NAMES.lifestyle_coffee } as never });
		expect(parent.querySelector(".ghs-habit-progress")!.getAttribute("aria-label")).toBe("6/14");
		expect(Array.from(parent.querySelectorAll(".ghs-fact")).map(text)).toContain("Late caffeine: the comparison with the night after starts at 14 days logged with at least 3 different amounts, 6 so far.");
	});
});

describe("habitInsights", () => {
	async function rows(frontmatter: (ago: number) => Record<string, unknown>): Promise<ReturnType<typeof computeHabitsCard>["habits"]> {
		const app = new App();
		await seedHistory(app, { end: END, days: 80, frontmatter });
		return computeHabitsCard(new DayIndex(app as never, () => settings), END, NAMES).habits;
	}

	it("picks the text for the measure and the direction, with the habit, the size and the day counts", async () => {
		const [row] = await rows((ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, hrv: 50 + (on(ago + 1) ? 8 : 0) + noise(ago), resting_hr: 55 - (on(ago + 1) ? 3 : 0) + noise(ago + 3) * 0.5 }));
		const insights = habitInsights(row!, "en");
		expect(insights.map((i) => i.id).sort()).toEqual(["lifestyle_hrv_up", "lifestyle_rhr_down"]);
		expect(insightText(insights.find((i) => i.id === "lifestyle_hrv_up")!, "en")).toMatch(/^After Alcohol your HRV is \d ms higher than after days without it \(\d+ days against \d+\)\.$/);
	});

	it("names a rise of the resting heart rate and a fall of the HRV as something to watch", async () => {
		const [row] = await rows((ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, hrv: 50 - (on(ago + 1) ? 8 : 0) + noise(ago), resting_hr: 55 + (on(ago + 1) ? 3 : 0) + noise(ago + 3) * 0.5 }));
		expect(habitInsights(row!, "en").map((i) => i.id).sort()).toEqual(["lifestyle_hrv_down", "lifestyle_rhr_up"]);
	});

	it("says nothing for a habit without a clear pattern and without a gap in its no days", async () => {
		const [row] = await rows((ago) => ({ lifestyle_alcohol: on(ago) ? 1 : 0, hrv: 50 + noise(ago * 7) }));
		expect(habitInsights(row!, "en")).toEqual([]);
	});
});
