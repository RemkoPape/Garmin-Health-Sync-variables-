// Why it matters: these cards advise on training volume ("61 min left", "ease off"). The zone borders, the
// cap, the unlock rules and the states with no data decide whether that advice is right or absent.
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { computeLoad, garminLabel, renderLoad } from "../src/panel/cards/load-card";
import { computeWeekly, renderWeekly } from "../src/panel/cards/weekly-card";
import { computeSessions, renderSessions } from "../src/panel/cards/sessions-card";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";

const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };
const END = "2026-10-22"; // a Thursday; the week started on Monday the 19th
const noop = (): void => undefined;

async function indexOf(frontmatter: (ago: number) => Record<string, unknown> | null, days = 35): Promise<DayIndex> {
	const app = new App();
	await seedHistory(app, { end: END, days, frontmatter });
	return new DayIndex(app as never, () => settings);
}
let root: HTMLElement;
beforeEach(() => {
	root = document.createElement("div");
});
const text = (sel: string): string => root.querySelector(sel)?.textContent ?? "";

describe("garminLabel", () => {
	it("title-cases the status and drops the trailing number", () => {
		expect(garminLabel("PRODUCTIVE_3")).toBe("Productive");
		expect(garminLabel("MAINTAINING")).toBe("Maintaining");
		expect(garminLabel("NO_STATUS")).toBe("No status");
	});
});

describe("load balance card", () => {
	/** `recent` minutes a day for the last 7 days and `earlier` before that. */
	const load = (recent: number, earlier: number, extra: Record<string, unknown> = {}) => indexOf((ago) => ({ running: `${ago < 7 ? recent : earlier}min`, ...extra }));
	const zone = async (recent: number, earlier: number): Promise<string> => {
		root.empty();
		renderLoad(root, computeLoad(await load(recent, earlier), END), "en", false, noop);
		return text(".ghs-zone-name-current");
	};

	it.each([
		[10, 30, "Detrain", "Add a session this week"], // 70 / 175 = 0.4
		[26, 30, "Maintain", "Add 10 percent to build"], // 0.897
		[30, 30, "Build", "Hold steady"], // 1.0
		[50, 30, "Strain", "Ease off, next session easy"], // 1.43
		[60, 30, "Overreach", "Day off or recovery only"], // 1.6
	])("recent %s against %s a day is %s", async (recent, earlier, name, action) => {
		expect(await zone(recent, earlier)).toBe(name);
		expect(text(".ghs-foot-value")).toBe(action);
	});

	it("shows the ratio and puts the dot on a bar from 0.5 to 1.8", async () => {
		root.empty();
		renderLoad(root, computeLoad(await load(30, 30), END), "en", false, noop);
		expect(text(".ghs-card-value")).toBe("1");
		expect((root.querySelector(".ghs-dot") as HTMLElement).style.getPropertyValue("--ghs-x")).toBe(`${(0.5 / 1.3) * 100}%`);
		expect(text(".ghs-foot-label")).toBe(en.panelLoadFoot);
		expect(Array.from(root.querySelectorAll(".ghs-zone-name")).map((e) => e.textContent)).toEqual(["Detrain", "Maintain", "Build", "Strain", "Overreach"]);
	});

	it("clamps a ratio beyond the bar", async () => {
		renderLoad(root, computeLoad(await load(200, 1), END), "en", false, noop);
		expect((root.querySelector(".ghs-dot") as HTMLElement).style.getPropertyValue("--ghs-x")).toBe("100%");
	});

	it("does not count recovery sessions", async () => {
		const index = await indexOf((ago) => ({ running: "30min", breathwork: ago < 7 ? "300min" : "1min" }));
		expect(computeLoad(index, END).ratio).toBe(1);
	});

	it("weights sessions by intensity once there is a heart rate history", async () => {
		// the last 7 days are harder (150 bpm) than the 28 before (100 to 140 bpm)
		const index = await indexOf((ago) => ({ running: `30min · Ø${ago < 7 ? 150 : 100 + (ago % 5) * 10} bpm` }));
		const plain = await indexOf(() => ({ running: "30min" }));
		expect(computeLoad(plain, END).ratio).toBe(1);
		expect(computeLoad(index, END).ratio).toBeGreaterThan(1);
	});

	it("suggests a first easy session when there is no load at all", async () => {
		renderLoad(root, computeLoad(await indexOf(() => ({ hrv: 40 })), END), "en", false, noop);
		expect(text(".ghs-card-action")).toBe(en.panelLoadStart);
		expect(root.querySelector(".ghs-card-value")).not.toBeNull();
		expect(text(".ghs-card-value")).toBe("");
	});

	it("is locked until there is a complete week of notes", async () => {
		const model = computeLoad(await indexOf(() => ({ running: "30min" }), 3), END);
		expect(model.weeks).toBe(0);
		renderLoad(root, model, "en", false, noop);
		expect(text(".ghs-card-note")).toBe(en.panelLoadLocked);
		expect(root.querySelector(".ghs-range")).toBeNull();
	});

	it("warns that the average rests on fewer than four weeks", async () => {
		renderLoad(root, computeLoad(await indexOf(() => ({ running: "30min" }), 18), END), "en", false, noop);
		expect(text(".ghs-card-warning")).toBe("Based on 2 of 4 weeks.");
		root.empty();
		renderLoad(root, computeLoad(await load(30, 30), END), "en", false, noop);
		expect(root.querySelector(".ghs-card-warning")).toBeNull();
	});

	it("shows Garmin's own status as a label only", async () => {
		const index = await indexOf((ago) => ({ running: "30min", ...(ago === 0 ? { training_status: "PRODUCTIVE_3" } : {}) }));
		renderLoad(root, computeLoad(index, END), "en", false, noop);
		expect(text(".ghs-card-note")).toBe("Garmin: Productive");
		expect(computeLoad(index, END).zone).toBe(2);
	});

	it("speaks the plugin language and shows the explanation", async () => {
		renderLoad(root, computeLoad(await load(30, 30), END), "de", true, noop);
		expect(text(".ghs-foot-value")).toBe(de.panelLoadActHold);
		expect(text(".ghs-explain")).toBe(de.panelLoadExplain);
	});
});

describe("weekly load card", () => {
	/** `perDay` minutes every day: the four previous weeks have 210 minutes each. */
	const week = (perDay: number | ((ago: number) => number), days = 35) => indexOf((ago) => ({ running: `${typeof perDay === "number" ? perDay : perDay(ago)}min` }), days);

	it("adds this week up to the shown day and says what is left to the cap, 10 percent above the average", async () => {
		const model = computeWeekly(await week(30), END);
		expect(model.minutes).toBe(120); // Mon..Thu
		expect(model.average).toBe(210);
		expect(model.cap).toBeCloseTo(231);
		renderWeekly(root, model, "en", false, noop);
		expect(text(".ghs-card-value")).toBe("120 min");
		expect(text(".ghs-foot-value")).toBe("111 min left this week");
		expect(text(".ghs-foot-label")).toBe(en.panelWeeklyFoot);
		expect(Array.from(root.querySelectorAll(".ghs-tick-label")).map((e) => e.textContent)).toEqual(["Average", "Cap"]);
		expect(root.querySelector(".ghs-card-warning")).toBeNull();
	});

	it("draws one segment per session of the week, in order", async () => {
		const model = computeWeekly(await week(30), END);
		expect(model.segments).toHaveLength(4);
		renderWeekly(root, model, "en", false, noop);
		const segs = Array.from(root.querySelectorAll<HTMLElement>(".ghs-weekly-seg"));
		expect(segs).toHaveLength(4);
		const domain = Math.max(231 * 1.25, 120 * 1.05);
		expect(parseFloat(segs[0]!.style.getPropertyValue("--ghs-w"))).toBeCloseTo((30 / domain) * 100, 6);
		expect(segs[0]!.classList.contains("ghs-step-none")).toBe(true);
	});

	it("colours segments by intensity once the history has 10 sessions with a heart rate", async () => {
		const index = await indexOf((ago) => ({ running: `30min · Ø${120 + (ago % 5) * 15} bpm` }));
		const model = computeWeekly(index, END);
		expect(model.segments.every((s) => s.step !== null)).toBe(true);
		renderWeekly(root, model, "en", false, noop);
		expect(root.querySelector(".ghs-weekly-seg.ghs-step-none")).toBeNull();
	});

	it("warns when the week is over the cap", async () => {
		const model = computeWeekly(await week((ago) => (ago < 4 ? 90 : 30)), END);
		renderWeekly(root, model, "en", false, noop);
		expect(text(".ghs-foot-value")).toBe(en.panelWeeklyOver);
		expect(root.querySelector(".ghs-foot-over")).not.toBeNull();
	});

	it("does not count recovery sessions", async () => {
		const index = await indexOf(() => ({ running: "30min", meditation: "20min" }));
		expect(computeWeekly(index, END).minutes).toBe(120);
	});

	it("warns that the average rests on fewer than four weeks", async () => {
		renderWeekly(root, computeWeekly(await week(30, 18), END), "en", false, noop);
		expect(text(".ghs-card-warning")).toBe("Based on 2 of 4 weeks.");
	});

	it("is locked without a previous week of notes but still shows this week", async () => {
		const model = computeWeekly(await week(30, 4), END);
		expect(model.average).toBeNull();
		renderWeekly(root, model, "en", false, noop);
		expect(text(".ghs-card-note")).toBe(en.panelLoadLocked);
		expect(text(".ghs-card-value")).toBe("120 min");
	});

	it("speaks the plugin language and shows the explanation", async () => {
		renderWeekly(root, computeWeekly(await week(30), END), "de", true, noop);
		expect(text(".ghs-foot-value")).toBe("Noch 111 Min. diese Woche");
		expect(text(".ghs-explain")).toBe(de.panelWeeklyExplain);
	});
});

describe("sessions card", () => {
	const day = (fm: Record<string, unknown>, history: (ago: number) => Record<string, unknown> | null = () => null) =>
		indexOf((ago) => (ago === 0 ? fm : history(ago)), 30);

	it("lists the day's sessions with minutes, distance, heart rate and calories, and the location", async () => {
		const index = await day({ running: "2x · 5 km · 46min · Ø142 bpm · 409 kcal", workout_location: "Wien" });
		renderSessions(root, computeSessions(index, END), "en", false, false, noop);
		expect(text(".ghs-card-value")).toBe("46 min");
		expect(text(".ghs-session-type")).toBe("Running ×2");
		expect(text(".ghs-session-facts")).toBe("46 min · 5 km · Avg 142 bpm · 409 kcal");
		expect(text(".ghs-card-note")).toBe("📍 Wien");
	});

	it("shows miles for imperial users and drops facts that are not there", async () => {
		const index = await day({ cycling: "20 km · 50min", mountain_biking: "30min" });
		renderSessions(root, computeSessions(index, END), "en", true, false, noop);
		const facts = Array.from(root.querySelectorAll(".ghs-session-facts")).map((e) => e.textContent);
		expect(facts).toEqual(["50 min · 12.4 mi", "30 min"]);
		expect(Array.from(root.querySelectorAll(".ghs-session-type")).map((e) => e.textContent)).toEqual(["Cycling", "Mountain biking"]);
		expect(text(".ghs-card-value")).toBe("80 min");
		expect(root.querySelector(".ghs-card-note")).toBeNull();
	});

	it("marks a recovery session with a dashed purple border and a tag", async () => {
		const index = await day({ breathwork: "12min" });
		renderSessions(root, computeSessions(index, END), "en", false, false, noop);
		expect(root.querySelector(".ghs-session-recovery")).not.toBeNull();
		expect(text(".ghs-session-tag")).toBe(en.panelRecovery);
	});

	it("colours the border by intensity once the history has 10 sessions with a heart rate", async () => {
		const index = await day({ running: "30min · Ø190 bpm" }, (ago) => (ago <= 12 ? { running: `30min · Ø${100 + ago * 5} bpm` } : null));
		renderSessions(root, computeSessions(index, END), "en", false, false, noop);
		expect(root.querySelector(".ghs-step-border-4")).not.toBeNull();
	});

	it("keeps a neutral border while the history is too short", async () => {
		renderSessions(root, computeSessions(await day({ running: "30min · Ø190 bpm" }), END), "en", false, false, noop);
		expect(root.querySelector(".ghs-step-border-none")).not.toBeNull();
	});

	it("says there was no session on a day with a note, and has no reading without a note", async () => {
		renderSessions(root, computeSessions(await day({ hrv: 40 }), END), "en", false, false, noop);
		expect(text(".ghs-card-value")).toBe("0 min");
		expect(text(".ghs-card-note")).toBe(en.panelNoSession);
		root.empty();
		renderSessions(root, computeSessions(await indexOf(() => null, 3), END), "en", false, false, noop);
		expect(text(".ghs-card-value")).toBe(en.panelNoReading);
		expect(root.querySelector(".ghs-session")).toBeNull();
	});

	it("speaks the plugin language and shows the explanation", async () => {
		renderSessions(root, computeSessions(await day({ running: "30min · Ø140 bpm" }), END), "de", false, true, noop);
		expect(text(".ghs-session-facts")).toBe("30 Min. · Ø 140 bpm".replace("30 Min.", "30 min"));
		expect(text(".ghs-explain")).toBe(de.panelSessionsExplain);
	});
});
