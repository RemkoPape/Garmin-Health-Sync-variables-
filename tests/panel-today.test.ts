// Why it matters: the Today card gives a verdict ("train hard", "day off"). The score arithmetic, the band
// edges, the flags and the verdict rules are a rule of thumb, so each one is pinned, and the card must be
// honest when it has too little data.
import { describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { Signals } from "../src/panel/insights/signals";
import { todayInsights } from "../src/panel/insights/today";
import { computeToday, renderToday, TODAY_MIN_DAYS } from "../src/panel/cards/today-card";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";

const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };
const END = "2026-10-22";
const noop = (): void => undefined;
type Fm = Record<string, unknown>;
const alt = (ago: number, a: number, b: number): number => (ago % 2 === 0 ? a : b);

/**
 * 45 days: HRV 58/62 (mean 60, sd 2), resting heart rate 50/54 (mean 52, sd 2), 7 h 30 sleep every night (no debt).
 * `today` overrides the shown day, `rest` the other days.
 */
async function index(today: Fm = {}, rest: (ago: number) => Fm = () => ({}), days = 45): Promise<DayIndex> {
	const app = new App();
	await seedHistory(app, {
		end: END,
		days,
		frontmatter: (ago) => ({ hrv: alt(ago, 62, 58), resting_hr: alt(ago, 54, 50), sleep_duration: "7h 30min", ...rest(ago), ...(ago === 0 ? today : {}) }),
	});
	return new DayIndex(app as never, () => settings);
}
const run = (ago: number, recent: number, earlier: number): Fm => ({ running: `${ago < 7 ? recent : earlier}min` });
/** A high readiness band without flags: HRV far above the usual. */
const high = { hrv: 80, resting_hr: 52 };

describe("the readiness score", () => {
	it("is 50 when HRV, resting heart rate and sleep are exactly as usual", async () => {
		const m = computeToday(await index({ hrv: 60, resting_hr: 52 }), END, null);
		expect(m.score).toBe(50);
		expect(m.band).toBe(2);
		expect(m.flags).toEqual([]);
	});

	it("adds 12 per standard deviation of HRV and subtracts 10 per standard deviation of resting heart rate", async () => {
		expect(computeToday(await index({ hrv: 62, resting_hr: 52 }), END, null).score).toBe(62); // +1 sd
		expect(computeToday(await index({ hrv: 60, resting_hr: 54 }), END, null).score).toBe(40); // +1 sd of resting heart rate
		expect(computeToday(await index({ hrv: 62, resting_hr: 50 }), END, null).score).toBe(72);
	});

	it("clamps each z value at 2.5 standard deviations and the score at 0 and 100", async () => {
		expect(computeToday(await index({ hrv: 90, resting_hr: 52 }), END, null).score).toBe(80); // 50 + 12 * 2.5
		expect(computeToday(await index({ hrv: 90, resting_hr: 30 }), END, null).score).toBe(100); // 50 + 30 + 25, capped
		expect(computeToday(await index({ hrv: 30, resting_hr: 90 }, () => ({ sleep_duration: "4h 0min" })), END, null).score).toBe(0);
	});

	it("subtracts 6 per hour of sleep debt, at most 4 hours of it", async () => {
		// the last week 6 h 20 min after weeks of 7 h 30: 40 min short each of 7 nights = 280 min = 4.67 h -> capped at 4 -> -24
		const shorter = (night: string) => (ago: number): Fm => ({ sleep_duration: ago < 7 ? night : "7h 30min" });
		const m = computeToday(await index({ hrv: 60, resting_hr: 52 }, shorter("6h 20min")), END, null);
		expect(m.score).toBe(26);
		expect(m.facts.debt).toBe(280);
		// 6 h 50 min nights: 70 min of debt -> -7
		expect(computeToday(await index({ hrv: 60, resting_hr: 52 }, shorter("6h 50min")), END, null).score).toBe(43);
	});

	it("counts the debt against the usual sleep, so a person who never reaches 7 hours does not owe it every day", async () => {
		const m = computeToday(await index({ hrv: 60, resting_hr: 52 }, () => ({ sleep_duration: "6h 20min" })), END, null);
		expect(m.facts.debt).toBe(0);
		expect(m.score).toBe(50);
		expect(m.flags).toEqual([]);
	});

	it("scales the HRV and resting heart rate terms by the days of range while it is young, and not at 21 days or more", async () => {
		const far = { hrv: 54, resting_hr: 58 }; // far out of range: both z values clamp at 2.5, 12 x 2.5 + 10 x 2.5 = 55
		const young = computeToday(await index(far, () => ({}), 12), END, null);
		expect(young.baselineDays).toBe(11);
		expect(young.score).toBe(21); // 50 - 55 x 11 / 21
		expect(computeToday(await index(far, () => ({}), 45), END, null).score).toBe(0); // 50 - 55, no less than 0
		expect(computeToday(await index(far, () => ({}), 22), END, null).baselineDays).toBe(21);
	});

	it("does not call for a day off from a low band alone while the range is young", async () => {
		const far = { hrv: 54, resting_hr: 58 };
		const young = computeToday(await index(far, () => ({}), 12), END, null);
		expect(young.band).toBe(0);
		expect(young.verdict).toBe("easy");
		expect(computeToday(await index(far, () => ({}), 45), END, null).verdict).toBe("rest");
		// raised breathing with a high resting heart rate, or three flags, still mean rest
		const sick = computeToday(await index({ ...far, respiration_rate: 19 }, (ago) => ({ respiration_rate: alt(ago, 13, 15.4) }), 12), END, null);
		expect(sick.verdict).toBe("rest");
	});

	it("adds a quarter of how far the body battery peak is above or below the usual, and leaves it out without one", async () => {
		const battery = (ago: number): Fm => ({ body_battery_max: alt(ago, 62, 58) });
		expect(computeToday(await index({ hrv: 60, resting_hr: 52, body_battery_max: 80 }, battery), END, null).score).toBe(55); // +20 * 0.25
		expect(computeToday(await index({ hrv: 60, resting_hr: 52, body_battery_max: 40 }, battery), END, null).score).toBe(45);
		expect(computeToday(await index({ hrv: 60, resting_hr: 52, body_battery_max: undefined }, battery), END, null).score).toBe(50); // no peak today
		expect(computeToday(await index({ hrv: 60, resting_hr: 52 }), END, null).score).toBe(50);
	});

	it.each([
		[24, 0],
		[25, 1],
		[49, 1],
		[50, 2],
		[74, 2],
		[75, 3],
		[94, 3],
		[95, 4],
	])("puts a score of %s in band %s", async (score, band) => {
		// up to 80 with HRV alone (2.5 standard deviations is the most it counts), beyond that with a lower resting heart rate
		const today = score <= 80 ? { hrv: 60 + 2 * ((score - 50) / 12), resting_hr: 52 } : { hrv: 90, resting_hr: 52 - 2 * ((score - 80) / 10) };
		const m = computeToday(await index(today), END, null);
		expect(m.score).toBe(score);
		expect(m.band).toBe(band);
	});

	it("is not there without HRV, resting heart rate or sleep", async () => {
		expect(computeToday(await index({}, () => ({ hrv: undefined })), END, null).score).toBeNull();
		expect(computeToday(await index({}, () => ({ resting_hr: undefined })), END, null).score).toBeNull();
		expect(computeToday(await index({}, () => ({ sleep_duration: undefined })), END, null).score).toBeNull();
		expect(computeToday(await index({}, () => ({}), 3), END, null).score).toBeNull();
	});
});

describe("the flags", () => {
	const flags = async (today: Fm, rest: (ago: number) => Fm = () => ({})) => computeToday(await index({ hrv: 60, resting_hr: 52, ...today }, rest), END, null).flags;

	it("flags a low HRV and a high resting heart rate beyond one standard deviation", async () => {
		expect(await flags({ hrv: 57 })).toEqual(["hrv"]);
		expect(await flags({ hrv: 58.5 })).toEqual([]);
		expect(await flags({ resting_hr: 55 })).toEqual(["rhr"]);
		expect(await flags({ resting_hr: 53.5 })).toEqual([]);
	});

	it("flags a sleep debt above 2 hours", async () => {
		const shorter = (night: string) => (ago: number): Fm => ({ sleep_duration: ago < 7 ? night : "7h 30min" });
		expect(await flags({}, shorter("6h 40min"))).toEqual(["sleep"]); // 20 min x 7 = 140 min
		expect(await flags({}, shorter("6h 50min"))).toEqual([]); // 70 min
	});

	it("flags a body battery peak more than 15 below the usual", async () => {
		const peaks = (ago: number): Fm => ({ body_battery_max: alt(ago, 62, 58) });
		expect(await flags({ body_battery_max: 44 }, peaks)).toEqual(["battery"]);
		expect(await flags({ body_battery_max: 46 }, peaks)).toEqual([]);
	});

	it("flags stress more than 10 above the 7-day average", async () => {
		const stress = () => ({ stress: 30 });
		expect(await flags({ stress: 45 }, stress)).toEqual(["stress"]);
		expect(await flags({ stress: 40 }, stress)).toEqual([]);
	});

	it("flags breathing more than 1.5 standard deviations up and a blood oxygen below 94 percent", async () => {
		const breathing = (ago: number): Fm => ({ respiration_rate: alt(ago, 13, 15.4) });
		expect(await flags({ respiration_rate: 17 }, breathing)).toEqual(["breathing"]); // z 2.3
		expect(await flags({ respiration_rate: 15.8 }, breathing)).toEqual([]); // z 1.33
		expect(await flags({ spo2: 93 })).toEqual(["spo2"]);
		expect(await flags({ spo2: 94 })).toEqual([]);
	});

	it("flags a load spike above 1.5 times the usual", async () => {
		expect(await flags({}, (ago) => run(ago, 60, 30))).toEqual(["load"]); // ratio 1.6
		expect(await flags({}, (ago) => run(ago, 50, 30))).toEqual([]); // ratio 1.43
	});
});

describe("the verdict", () => {
	const verdict = async (today: Fm, rest: (ago: number) => Fm = () => ({})) => computeToday(await index(today, rest), END, null).verdict;
	const stress = (ago: number): Fm => ({ stress: alt(ago, 30, 30) });

	it("is train hard for a high band without flags", async () => {
		expect(await verdict(high)).toBe("hard");
	});

	it("is train as planned for a high band with one flag, or a moderate band without", async () => {
		expect(await verdict({ ...high, stress: 50 }, stress)).toBe("planned");
		expect(await verdict({ hrv: 60, resting_hr: 52 })).toBe("planned");
	});

	it("is go easy for a high band with two flags, or a moderate band with one", async () => {
		expect(await verdict({ ...high, stress: 50, spo2: 93 }, stress)).toBe("easy");
		expect(await verdict({ hrv: 60, resting_hr: 52, stress: 50 }, stress)).toBe("easy");
	});

	it("is a day off for a poor or low band", async () => {
		expect(await verdict({ hrv: 50, resting_hr: 60 })).toBe("rest");
		expect(await verdict({ hrv: 57, resting_hr: 52 })).toBe("rest"); // score 32, low
	});

	it("is a day off with three flags, whatever the band", async () => {
		expect(await verdict({ ...high, stress: 50, spo2: 93 }, (ago) => ({ ...stress(ago), ...run(ago, 60, 30) }))).toBe("rest");
	});

	it("is a day off when raised breathing comes with a high resting heart rate, even in a moderate band", async () => {
		const m = computeToday(await index({ hrv: 80, resting_hr: 56, respiration_rate: 17 }, (ago) => ({ respiration_rate: alt(ago, 13, 15.4) })), END, null);
		expect(m.band).toBe(2);
		expect(m.flags).toEqual(["rhr", "breathing"]);
		expect(m.verdict).toBe("rest");
	});
});

describe("Garmin's readiness and the amount of data", () => {
	it("is carried next to the own score", async () => {
		expect(computeToday(await index({ ...high, training_readiness: 65 }), END, null).garmin).toBe(65);
		expect(computeToday(await index(high), END, null).garmin).toBeNull();
	});

	it("counts the days of HRV and resting heart rate, the nights of sleep, and calls fewer than 21 days early", async () => {
		const m = computeToday(await index({}, () => ({}), 11), END, null);
		expect(m.baselineDays).toBe(10);
		expect(m.have).toBe(7); // only 7 nights of sleep are counted
		expect(m.early).toBe(true);
		expect(computeToday(await index({}, () => ({}), 31), END, null).early).toBe(false);
	});

	it("counts the sleep nights too", async () => {
		expect(computeToday(await index({}, (ago) => (ago <= 3 ? {} : { sleep_duration: undefined }), 45), END, null).have).toBe(4);
	});
});

describe("the Today card", () => {
	let root: HTMLElement;
	const reset = (): void => {
		root = document.createElement("div");
	};
	const text = (sel: string): string => root.querySelector(sel)?.textContent ?? "";
	const render = (m: ReturnType<typeof computeToday>, lang = "en", open = false): void => {
		reset();
		renderToday(root, m, lang, open, noop);
	};

	it("shows the score with its band, the verdict in a tinted card and the bar with a dot", async () => {
		render(computeToday(await index(high), END, null));
		expect(text(".ghs-card-title")).toBe(en.panelTodayTitle);
		expect(text(".ghs-card-value")).toBe("80 High");
		expect(text(".ghs-verdict")).toBe(en.panelVerdictHard);
		expect(root.querySelector(".ghs-card-verdict-hard")).not.toBeNull();
		expect((root.querySelector(".ghs-dot") as HTMLElement).style.getPropertyValue("--ghs-x")).toBe("80%");
		expect(root.querySelector(".ghs-foot")).toBeNull();
	});

	it("tints each verdict differently", async () => {
		const rest = computeToday(await index({ hrv: 50, resting_hr: 60 }), END, null);
		render(rest);
		expect(root.querySelector(".ghs-card-verdict-rest")).not.toBeNull();
		expect(text(".ghs-verdict")).toBe(en.panelVerdictRest);
		expect(text(".ghs-card-value")).toBe("0 Poor");
		render(computeToday(await index({ hrv: 60, resting_hr: 52 }), END, null));
		expect(root.querySelector(".ghs-card-verdict-planned")).not.toBeNull();
		render(computeToday(await index({ hrv: 60, resting_hr: 52, stress: 50 }, () => ({ stress: 30 })), END, null));
		expect(root.querySelector(".ghs-card-verdict-easy")).not.toBeNull();
	});

	it("shows Garmin's readiness as a reference row", async () => {
		render(computeToday(await index({ ...high, training_readiness: 65 }), END, null));
		expect(text(".ghs-foot-label")).toBe(en.panelTodayGarmin);
		expect(text(".ghs-foot-value")).toBe("65");
	});

	it("warns that the score is an early estimate until 21 days", async () => {
		render(computeToday(await index(high, () => ({}), 11), END, null));
		expect(text(".ghs-card-warning")).toBe("Early estimate from 10 days, likely inaccurate until 21 days.");
		render(computeToday(await index(high, () => ({}), 31), END, null));
		expect(root.querySelector(".ghs-card-warning")).toBeNull();
	});

	it("shows Garmin's readiness alone while there is no own score", async () => {
		render(computeToday(await index({ training_readiness: 65 }, () => ({}), 3), END, null));
		expect(text(".ghs-card-value")).toBe("65 Garmin");
		expect(text(".ghs-card-note")).toBe(en.panelTodayBridge);
		expect(root.querySelector(".ghs-verdict")).toBeNull();
	});

	it("says how many days are missing when there is neither", async () => {
		render(computeToday(await index({}, () => ({}), 3), END, null));
		expect(text(".ghs-card-note")).toBe(`Unlocks after ${TODAY_MIN_DAYS} days of data · 2 so far`);
		expect(root.querySelector(".ghs-card-value")?.textContent).toBe("");
	});

	it("speaks the plugin language and shows the explanation", async () => {
		render(computeToday(await index(high), END, null), "de", true);
		expect(text(".ghs-verdict")).toBe(de.panelVerdictHard);
		expect(text(".ghs-explain")).toBe(de.panelTodayExplain);
	});
});

describe("what the interpretation says about the day", () => {
	const insights = async (today: Fm, rest: (ago: number) => Fm = () => ({})) => todayInsights(new Signals(await index(today, rest), END, null));

	it("has nothing without a score", async () => {
		expect(todayInsights(new Signals(await index({}, () => ({}), 3), END, null))).toEqual([]);
	});

	it("says nothing stands out when no flag applies", async () => {
		expect(await insights({ hrv: 60, resting_hr: 52 })).toEqual([{ id: "today_no_flags" }]);
	});

	it("names each flag that shaped the verdict, with the numbers where it helps", async () => {
		expect(await insights({ hrv: 57, resting_hr: 52 })).toEqual([{ id: "today_flag_hrv" }]);
		expect(await insights({ hrv: 60, resting_hr: 55 })).toEqual([{ id: "today_flag_rhr" }]);
		expect(await insights({ hrv: 60, resting_hr: 52 }, (ago) => ({ sleep_duration: ago < 7 ? "6h 40min" : "7h 30min" }))).toEqual([{ id: "today_flag_sleep", params: { debt: "2 h 20 min" } }]);
		expect(await insights({ hrv: 60, resting_hr: 52, body_battery_max: 40 }, (ago) => ({ body_battery_max: alt(ago, 62, 58) }))).toEqual([{ id: "today_flag_battery", params: { gap: "20" } }]);
		expect(await insights({ hrv: 60, resting_hr: 52, stress: 50 }, () => ({ stress: 30 }))).toEqual([{ id: "today_flag_stress" }]);
		expect(await insights({ hrv: 60, resting_hr: 52, respiration_rate: 17 }, (ago) => ({ respiration_rate: alt(ago, 13, 15.4) }))).toEqual([{ id: "today_flag_breathing" }]);
		expect(await insights({ hrv: 60, resting_hr: 52, spo2: 93 })).toEqual([{ id: "today_flag_spo2" }]);
		expect(await insights({ hrv: 60, resting_hr: 52 }, (ago) => run(ago, 60, 30))).toEqual([{ id: "today_flag_load", params: { pct: "60" } }]);
	});

	it("shows at most three flags, in the order of the rules", async () => {
		const out = await insights({ hrv: 57, resting_hr: 55, spo2: 93, stress: 50 }, (ago) => ({ stress: 30, ...run(ago, 60, 30) }));
		expect(out.map((i) => i.id)).toEqual(["today_flag_hrv", "today_flag_rhr", "today_flag_stress"]);
	});
});
