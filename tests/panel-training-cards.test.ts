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

describe("load balance and weekly load with a birth year", () => {
	const born = 2026 - 40; // maximum 180 bpm

	it("weights load balance by zone from the first session", async () => {
		// recent days in zone 4 (150 bpm, x1.2), earlier days in zone 2 (115 bpm, x0.8)
		const index = await indexOf((ago) => ({ running: `30min · Ø${ago < 7 ? 150 : 115} bpm` }));
		const plain = computeLoad(index, END).ratio;
		const zoned = computeLoad(index, END, born);
		expect(plain).toBe(1); // no intensity history before 10 sessions ranks equally... all weights 1.0
		expect(zoned.ratio).toBeGreaterThan(1.3);
		expect(zoned.zones).toBe(true);
		expect(computeLoad(index, END).zones).toBe(false);
		renderLoad(root, zoned, "en", true, noop);
		expect(text(".ghs-explain")).toBe(`${en.panelLoadExplain} ${en.panelHardnessZones}`);
	});

	it("colours the weekly segments by zone and extends the explanation", async () => {
		const index = await indexOf(() => ({ running: "30min · Ø150 bpm" }));
		const model = computeWeekly(index, END, born);
		expect(model.zones).toBe(true);
		expect(model.segments.every((s) => s.step === 3)).toBe(true);
		renderWeekly(root, model, "en", false, true, noop);
		expect(root.querySelector(".ghs-weekly-seg.ghs-step-3")).not.toBeNull();
		expect(text(".ghs-explain")).toBe(`${en.panelWeeklyExplain} ${en.panelHardnessZones}`);
		expect(computeWeekly(index, END).zones).toBe(false);
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
		renderWeekly(root, model, "en", false, false, noop);
		expect(text(".ghs-card-value")).toBe("120 min");
		expect(text(".ghs-foot-value")).toBe("111 min left this week");
		expect(text(".ghs-foot-label")).toBe(en.panelWeeklyFoot);
		expect(Array.from(root.querySelectorAll(".ghs-tick-label")).map((e) => e.textContent)).toEqual(["Average", "Cap"]);
		expect(root.querySelector(".ghs-card-warning")).toBeNull();
	});

	it("draws one segment per session of the week, in order", async () => {
		const model = computeWeekly(await week(30), END);
		expect(model.segments).toHaveLength(4);
		renderWeekly(root, model, "en", false, false, noop);
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
		renderWeekly(root, model, "en", false, false, noop);
		expect(root.querySelector(".ghs-weekly-seg.ghs-step-none")).toBeNull();
	});

	it("warns when the week is over the cap", async () => {
		const model = computeWeekly(await week((ago) => (ago < 4 ? 90 : 30)), END);
		renderWeekly(root, model, "en", false, false, noop);
		expect(text(".ghs-foot-value")).toBe(en.panelWeeklyOver);
		expect(root.querySelector(".ghs-foot-over")).not.toBeNull();
	});

	it("does not count recovery sessions", async () => {
		const index = await indexOf(() => ({ running: "30min", meditation: "20min" }));
		expect(computeWeekly(index, END).minutes).toBe(120);
	});

	it("warns that the average rests on fewer than four weeks", async () => {
		renderWeekly(root, computeWeekly(await week(30, 18), END), "en", false, false, noop);
		expect(text(".ghs-card-warning")).toBe("Based on 2 of 4 weeks.");
	});

	it("is locked without a previous week of notes but still shows this week", async () => {
		const model = computeWeekly(await week(30, 4), END);
		expect(model.average).toBeNull();
		renderWeekly(root, model, "en", false, false, noop);
		expect(text(".ghs-card-note")).toBe(en.panelLoadLocked);
		expect(text(".ghs-card-value")).toBe("120 min");
	});

	it("speaks the plugin language and shows the explanation", async () => {
		renderWeekly(root, computeWeekly(await week(30), END), "de", false, true, noop);
		expect(text(".ghs-foot-value")).toBe("Noch 111 Min. diese Woche");
		expect(text(".ghs-explain")).toBe(de.panelWeeklyExplain);
	});
});

describe("weekly distance of running and cycling", () => {
	/** Running `perDay` km every day: the previous weeks have 7 x perDay each. */
	const km = (perDay: number | ((ago: number) => number), extra: Record<string, unknown> = {}) =>
		indexOf((ago) => ({ running: `${typeof perDay === "number" ? perDay : perDay(ago)} km · 30min`, ...extra }));
	const row = (i = 0): { label: string; value: string; foot: string; left: string } => {
		const r = root.querySelectorAll(".ghs-battery-row")[i]!;
		return {
			label: r.querySelector(".ghs-battery-row-label")?.textContent ?? "",
			value: r.querySelector(".ghs-battery-row-head span:last-child")?.textContent ?? "",
			foot: r.querySelector(".ghs-foot-label")?.textContent ?? "",
			left: r.querySelector(".ghs-foot-value")?.textContent ?? "",
		};
	};

	it("shows this week's kilometres against the average of the previous weeks and a cap 10 percent above", async () => {
		// 5 km a day: 35 km in each previous week, cap 38.5; Mon..Thu this week = 20 km
		const model = computeWeekly(await km(5), END);
		expect(model.distances).toEqual([{ category: "running", km: 20, average: 35, cap: expect.closeTo(38.5, 6) }]);
		renderWeekly(root, model, "en", false, false, noop);
		expect(row()).toEqual({ label: en.panelCategoryRunning, value: "20 km", foot: "Average 35 km · cap 38.5 km", left: "18.5 km left" });
		expect(root.querySelectorAll(".ghs-battery-row")).toHaveLength(1);
		const over = root.querySelector(".ghs-battery-bar .ghs-weekly-over") as HTMLElement;
		expect(over).not.toBeNull();
	});

	it("warns when over the cap", async () => {
		renderWeekly(root, computeWeekly(await km((ago) => (ago < 4 ? 12 : 5)), END), "en", false, false, noop);
		// 48 km this week against a cap of 38.5 km
		expect(row().left).toBe(en.panelWeeklyOver);
		expect(root.querySelector(".ghs-battery-row .ghs-foot-over")).not.toBeNull();
	});

	it("shows miles for imperial users", async () => {
		renderWeekly(root, computeWeekly(await km(5), END), "en", true, false, noop);
		expect(row().value).toBe("12.4 mi");
		expect(row().foot).toBe("Average 21.7 mi · cap 23.9 mi");
	});

	it("tracks cycling too and lists the sports in a fixed order", async () => {
		const index = await indexOf(() => ({ cycling: "20 km · 60min", running: "5 km · 30min" }));
		renderWeekly(root, computeWeekly(index, END), "en", false, false, noop);
		expect([row(0).label, row(1).label]).toEqual([en.panelCategoryRunning, en.panelCategoryCycling]);
	});

	it("leaves a sport out when it has no kilometres this week or before, and uses the written category", async () => {
		const none = await indexOf(() => ({ yoga: "30min" }));
		expect(computeWeekly(none, END).distances).toEqual([]);
		renderWeekly(root, computeWeekly(none, END), "en", false, false, noop);
		expect(root.querySelector(".ghs-battery-row")).toBeNull();
		const viaList = await indexOf(() => ({ trainings: [{ type: "trail_running", category: "running", distance_km: 10, duration_min: 60 }] }));
		expect(computeWeekly(viaList, END).distances[0]).toMatchObject({ category: "running", km: 40 });
	});

	it("shows a sport that was only run in earlier weeks, with nothing yet this week", async () => {
		const index = await indexOf((ago) => (ago >= 7 ? { running: "5 km · 30min" } : { hrv: 40 }));
		const model = computeWeekly(index, END);
		expect(model.distances[0]).toMatchObject({ km: 0, average: expect.any(Number) });
		renderWeekly(root, model, "en", false, false, noop);
		expect(row().value).toBe("0 km");
	});

	it("shows a sport that was started this week with no average yet", async () => {
		const index = await indexOf((ago) => (ago < 2 ? { running: "5 km · 30min" } : { hrv: 40 }));
		const model = computeWeekly(index, END);
		expect(model.distances[0]).toMatchObject({ km: 10, average: 0, cap: 0 });
		renderWeekly(root, model, "en", false, false, noop);
		expect(row().left).toBe(en.panelWeeklyOver);
	});

	it("speaks the plugin language", async () => {
		renderWeekly(root, computeWeekly(await km(5), END), "de", false, false, noop);
		expect(row().label).toBe(de.panelCategoryRunning);
		expect(row().left).toBe("Noch 18,5 km");
		expect(row().foot).toBe("Schnitt 35 km · Grenze 38,5 km");
	});
});

describe("sessions card", () => {
	const day = (fm: Record<string, unknown>, history: (ago: number) => Record<string, unknown> | null = () => null) =>
		indexOf((ago) => (ago === 0 ? fm : history(ago)), 30);

	it("lists the day's sessions with minutes, distance, heart rate and calories, and the location", async () => {
		const index = await day({ running: "2x · 5 km · 46min · Ø142 bpm · 409 kcal", workout_location: "Wien" });
		renderSessions(root, computeSessions(index, END, null), "en", false, false, noop);
		expect(text(".ghs-card-value")).toBe("46 min");
		expect(text(".ghs-session-type")).toBe("Running ×2");
		expect(text(".ghs-session-facts")).toBe("46 min · 5 km · Avg 142 bpm · 409 kcal");
		expect(Array.from(root.querySelectorAll(".ghs-card-note")).map((e) => e.textContent)).toEqual([en.panelZonesHint, "📍 Wien"]);
	});

	it("shows miles for imperial users and drops facts that are not there", async () => {
		const index = await day({ cycling: "20 km · 50min", mountain_biking: "30min" });
		renderSessions(root, computeSessions(index, END, null), "en", true, false, noop);
		const facts = Array.from(root.querySelectorAll(".ghs-session-facts")).map((e) => e.textContent);
		expect(facts).toEqual(["50 min · 12.4 mi", "30 min"]);
		expect(Array.from(root.querySelectorAll(".ghs-session-type")).map((e) => e.textContent)).toEqual(["Cycling", "Mountain biking"]);
		expect(text(".ghs-card-value")).toBe("80 min");
		expect(root.querySelector(".ghs-card-note")).toBeNull();
	});

	it("marks a recovery session with a dashed purple border and a tag", async () => {
		const index = await day({ breathwork: "12min" });
		renderSessions(root, computeSessions(index, END, null), "en", false, false, noop);
		expect(root.querySelector(".ghs-session-recovery")).not.toBeNull();
		expect(text(".ghs-session-tag")).toBe(en.panelRecovery);
	});

	it("colours the border by intensity once the history has 10 sessions with a heart rate", async () => {
		const index = await day({ running: "30min · Ø190 bpm" }, (ago) => (ago <= 12 ? { running: `30min · Ø${100 + ago * 5} bpm` } : null));
		renderSessions(root, computeSessions(index, END, null), "en", false, false, noop);
		expect(root.querySelector(".ghs-step-border-4")).not.toBeNull();
	});

	it("suggests the birth year in the settings when sessions have a heart rate but no year is set", async () => {
		renderSessions(root, computeSessions(await day({ running: "30min · Ø150 bpm" }), END, null), "en", false, false, noop);
		expect(text(".ghs-card-note")).toBe(en.panelZonesHint);
		root.empty();
		renderSessions(root, computeSessions(await day({ yoga: "30min" }), END, null), "en", false, false, noop);
		expect(root.querySelector(".ghs-card-note")).toBeNull();
	});

	it("keeps a neutral border while the history is too short", async () => {
		renderSessions(root, computeSessions(await day({ running: "30min · Ø190 bpm" }), END, null), "en", false, false, noop);
		expect(root.querySelector(".ghs-step-border-none")).not.toBeNull();
	});

	it("says there was no session on a day with a note, and has no reading without a note", async () => {
		renderSessions(root, computeSessions(await day({ hrv: 40 }), END, null), "en", false, false, noop);
		expect(text(".ghs-card-value")).toBe("0 min");
		expect(text(".ghs-card-note")).toBe(en.panelNoSession);
		root.empty();
		renderSessions(root, computeSessions(await indexOf(() => null, 3), END, null), "en", false, false, noop);
		expect(text(".ghs-card-value")).toBe(en.panelNoReading);
		expect(root.querySelector(".ghs-session")).toBeNull();
	});

	it("speaks the plugin language and shows the explanation", async () => {
		renderSessions(root, computeSessions(await day({ running: "30min · Ø140 bpm" }), END, null), "de", false, true, noop);
		expect(text(".ghs-session-facts")).toBe("30 Min. · Ø 140 bpm".replace("30 Min.", "30 min"));
		expect(text(".ghs-explain")).toBe(de.panelSessionsExplain);
	});
});

describe("sessions card with heart rate zones", () => {
	const END_YEAR = 2026;
	const born = END_YEAR - 40; // age 40: maximum 208 - 28 = 180 bpm
	const sessions = async (fm: Record<string, unknown>) => indexOf((ago) => (ago === 0 ? fm : null), 3);
	const render = (index: DayIndex, birthYear: number | null = born, lang = "en", open = false): void =>
		renderSessions(root, computeSessions(index, END, birthYear), lang, false, open, noop);

	it.each([
		[80, 0, "Below zone 1", "none"], // 44 %
		[95, 1, "Zone 1", "0"], // 53 %
		[115, 2, "Zone 2", "1"], // 64 %
		[135, 3, "Zone 3", "2"], // 75 %
		[155, 4, "Zone 4", "3"], // 86 %
		[170, 5, "Zone 5", "4"], // 94 %
	])("puts %s bpm in zone %s of a 180 bpm maximum", async (hr, zone, tag, border) => {
		const model = computeSessions(await sessions({ running: `30min · Ø${hr} bpm` }), END, born);
		expect(model.sessions[0]!.zone).toBe(zone);
		render(await sessions({ running: `30min · Ø${hr} bpm` }));
		expect(text(".ghs-zone-tag")).toBe(tag);
		expect(root.querySelector(`.ghs-step-border-${border}`)).not.toBeNull();
	});

	it("draws the zone bar with the current zone highlighted", async () => {
		render(await sessions({ running: "30min · Ø135 bpm" }));
		const parts = Array.from(root.querySelectorAll(".ghs-zonebar-part"));
		expect(parts).toHaveLength(5);
		expect(parts.map((p) => p.classList.contains("ghs-zonebar-current"))).toEqual([false, false, true, false, false]);
	});

	it("draws no highlighted part below zone 1", async () => {
		render(await sessions({ running: "30min · Ø80 bpm" }));
		expect(root.querySelectorAll(".ghs-zonebar-current")).toHaveLength(0);
	});

	it("states the estimated maximum heart rate and extends the explanation", async () => {
		render(await sessions({ running: "30min · Ø135 bpm" }), born, "en", true);
		expect(text(".ghs-card-note")).toBe("Zones use an estimated maximum heart rate of 180 bpm.");
		expect(text(".ghs-explain")).toBe(`${en.panelSessionsExplain} ${en.panelSessionsExplainZones}`);
	});

	it("takes the age at the shown day", async () => {
		const index = await sessions({ running: "30min · Ø135 bpm" });
		expect(computeSessions(index, END, 2006).maxHr).toBe(Math.round(208 - 0.7 * 20));
	});

	it("leaves sessions without a heart rate without zone, and recovery sessions with their own tag", async () => {
		render(await sessions({ yoga: "30min", breathwork: "10min · Ø60 bpm" }));
		expect(root.querySelector(".ghs-zone-tag")).toBeNull();
		expect(text(".ghs-session-tag")).toBe(en.panelRecovery);
		expect(root.querySelectorAll(".ghs-zonebar")).toHaveLength(1); // the breathwork session still shows its zone bar
	});

	it("falls back to the intensity colour without a birth year", async () => {
		render(await sessions({ running: "30min · Ø135 bpm" }), null);
		expect(root.querySelector(".ghs-zonebar")).toBeNull();
		expect(root.querySelector(".ghs-zone-tag")).toBeNull();
	});

	it("speaks the plugin language", async () => {
		render(await sessions({ running: "30min · Ø135 bpm" }), born, "de", true);
		expect(text(".ghs-zone-tag")).toBe("Zone 3");
		expect(text(".ghs-explain")).toBe(`${de.panelSessionsExplain} ${de.panelSessionsExplainZones}`);
	});
});
