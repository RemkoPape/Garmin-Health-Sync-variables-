// Why it matters: these cards flag things like a low blood oxygen or a short deep sleep. A tone or a tip in the
// wrong place is either a false alarm or a missed one, so the thresholds and the fallbacks are pinned here.
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { seedHistory } from "../testUtils/fakeHistory";
import { DayIndex } from "../src/panel/index";
import { computeRange, renderRange, BREATHING_CARD, SPO2_CARD, type RangeCardSpec } from "../src/panel/cards/range-card";
import { computeStages, renderStages } from "../src/panel/cards/stages-card";
import { computeBattery, renderBattery } from "../src/panel/cards/battery-card";
import { computeStress, renderStress } from "../src/panel/cards/stress-card";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";

const settings = { dailyNotePath: "", dailyNoteFormat: "YYYY-MM-DD" };
const END = "2026-10-22";
const noop = (): void => undefined;

async function indexOf(frontmatter: (ago: number) => Record<string, unknown> | null, days = 31): Promise<DayIndex> {
	const app = new App();
	await seedHistory(app, { end: END, days, frontmatter });
	return new DayIndex(app as never, () => settings);
}

let root: HTMLElement;
beforeEach(() => {
	root = document.createElement("div");
});
const text = (sel: string): string => root.querySelector(sel)?.textContent ?? "";

describe("SpO2 and breathing (half-width range cards)", () => {
	/** 30 prior days alternating `a` and `b`, then the shown day. */
	const series = (key: string, today: number, a: number, b: number) => indexOf((ago) => ({ [key]: ago === 0 ? today : ago % 2 === 0 ? a : b }));
	const tone = (): string | undefined => Array.from(root.querySelector(".ghs-dot")?.classList ?? []).find((c) => c.startsWith("ghs-dot-"));
	const render = async (spec: RangeCardSpec, idx: DayIndex, lang = "en", open = false): Promise<void> => {
		root.empty();
		renderRange(root, spec, computeRange(spec, idx, END), lang, open, noop);
	};

	it("shows a compact bar without tick numbers, a status word and the value with its unit", async () => {
		await render(SPO2_CARD, await series("spo2", 96, 96, 97));
		expect(text(".ghs-card-title")).toBe("SpO₂");
		expect(text(".ghs-card-value")).toBe("96 %");
		expect(root.querySelector(".ghs-range-compact")).not.toBeNull();
		expect(root.querySelector(".ghs-tick-label")).toBeNull();
		expect(root.querySelector(".ghs-range-track-low")).not.toBeNull();
		expect(text(".ghs-status")).toBe(en.panelInRange);
		expect(root.querySelector(".ghs-status-ok")).not.toBeNull();
	});

	it.each([
		[96, "ghs-dot-ok"],
		[93, "ghs-dot-warn"], // under 94 percent regardless of the personal range
		[89, "ghs-dot-bad"], // under 90 percent
	])("SpO2 %s percent is %s", async (value, cls) => {
		await render(SPO2_CARD, await series("spo2", value, 96, 97));
		expect(tone()).toBe(cls);
	});

	it("SpO2 below the personal range is flagged even when above the absolute floor", async () => {
		// usual 98 +/- 0.7 (floor), today 96.4 is more than 2 sd under but above 94
		await render(SPO2_CARD, await series("spo2", 96.4, 98, 98));
		expect(tone()).toBe("ghs-dot-bad");
		expect(text(".ghs-status")).toBe(en.panelLow);
		await render(SPO2_CARD, await series("spo2", 97.0, 98, 98));
		expect(tone()).toBe("ghs-dot-warn");
	});

	it("breathing is two-sided and shows one decimal", async () => {
		// 13.0 / 15.4 -> mean 14.2, sd 1.2
		const at = (v: number) => series("respiration_rate", v, 13, 15.4);
		await render(BREATHING_CARD, await at(14.5));
		expect(text(".ghs-card-value")).toBe("14.5 /min");
		expect(tone()).toBe("ghs-dot-ok");
		await render(BREATHING_CARD, await at(15.9));
		expect(tone()).toBe("ghs-dot-warn"); // z 1.4
		expect(text(".ghs-status")).toBe(en.panelHigh);
		await render(BREATHING_CARD, await at(17.5));
		expect(tone()).toBe("ghs-dot-bad");
		await render(BREATHING_CARD, await at(11.5));
		expect(tone()).toBe("ghs-dot-bad"); // low breathing too
		await render(BREATHING_CARD, await at(12.5));
		expect(tone()).toBe("ghs-dot-warn");
		expect(text(".ghs-status")).toBe(en.panelLow);
	});

	it("breathing 1.5 above the usual is flagged even within one standard deviation", async () => {
		// 12.6 / 15.8 -> mean 14.2, sd 1.6; 15.8 is z 1.0 (not above) but +1.6
		await render(BREATHING_CARD, await series("respiration_rate", 15.8, 12.6, 15.8));
		expect(tone()).toBe("ghs-dot-warn");
		await render(BREATHING_CARD, await series("respiration_rate", 15.4, 12.6, 15.8));
		expect(tone()).toBe("ghs-dot-ok");
	});

	it("formats numbers in the plugin language", async () => {
		await render(BREATHING_CARD, await series("respiration_rate", 14.5, 13, 15.4), "de");
		expect(text(".ghs-card-value")).toBe("14,5 /min");
		expect(text(".ghs-status")).toBe(de.panelInRange);
	});

	it("is locked with a hint while there is too little history, in the plugin language", async () => {
		await render(SPO2_CARD, await series("spo2", 96, 96, 97).then(() => indexOf((ago) => (ago < 3 ? { spo2: 96 } : null), 3)), "de");
		expect(text(".ghs-card-note")).toBe("Wird nach 5 Tagen Daten freigeschaltet · bisher 2");
	});

	it("shows its own explanation", async () => {
		await render(SPO2_CARD, await series("spo2", 96, 96, 97), "en", true);
		expect(text(".ghs-explain")).toBe(en.panelSpo2Explain);
	});
});

describe("sleep stages card", () => {
	/** `today` minutes per stage for the shown day, `usual` for the 30 before it (14 of them have data when `nights` is 14). */
	const stages = (today: [number, number, number, number], usual: [number, number, number, number], nights = 30) =>
		indexOf((ago) => {
			const m = ago === 0 ? today : ago <= nights ? usual : null;
			return m === null ? null : { sleep_deep: `0h ${m[0]}min`, sleep_rem: `0h ${m[1]}min`, sleep_light: `0h ${m[2]}min`, sleep_awake: `0h ${m[3]}min` };
		});

	it("draws the composition and one row per stage with the usual amount as a tick", async () => {
		const model = computeStages(await stages([60, 90, 200, 20], [60, 90, 200, 20]), END);
		renderStages(root, model, "en", false, noop);
		expect(root.querySelectorAll(".ghs-stack-part")).toHaveLength(4);
		expect((root.querySelector(".ghs-stack-part") as HTMLElement).style.getPropertyValue("--ghs-w")).toBe(`${(60 / 370) * 100}%`);
		expect(Array.from(root.querySelectorAll(".ghs-stage-label")).map((e) => e.textContent)).toEqual(["Deep", "REM", "Light", "Awake"]);
		expect(Array.from(root.querySelectorAll(".ghs-stage-value")).map((e) => e.textContent)).toEqual(["1 h", "1 h 30 min", "3 h 20 min", "20 min"]);
		expect(root.querySelectorAll(".ghs-stage-mean")).toHaveLength(4);
		expect(root.querySelector(".ghs-foot")).toBeNull();
		expect(root.querySelector(".ghs-chip-delta")).toBeNull();
	});

	it("shows the deviation in minutes when a stage is more than one standard deviation from the usual, and no tip", async () => {
		// usual deep 60 min with a floor sd of 8; tonight 40 min -> z -2.5
		const model = computeStages(await stages([40, 90, 200, 20], [60, 90, 200, 20]), END);
		renderStages(root, model, "en", false, noop);
		expect(root.querySelector(".ghs-chip-delta")?.textContent).toBe(" · −20");
		expect(root.querySelector(".ghs-foot")).toBeNull();
		expect(root.querySelector(".ghs-card-action")).toBeNull();
	});

	it("shows a plus sign for more than usual", async () => {
		renderStages(root, computeStages(await stages([60, 90, 200, 40], [60, 90, 200, 20]), END), "en", false, noop);
		expect(root.querySelector(".ghs-chip-delta")?.textContent).toBe(" · +20");
	});

	it("shows the amounts without ticks while the history is too short", async () => {
		const model = computeStages(await stages([60, 90, 200, 20], [60, 90, 200, 20], 5), END);
		renderStages(root, model, "en", false, noop);
		expect(root.querySelector(".ghs-stage-mean")).toBeNull();
		expect(root.querySelectorAll(".ghs-stage-row")).toHaveLength(4);
	});

	it("says there is no reading when a stage is missing", async () => {
		const index = await indexOf((ago) => (ago === 0 ? { sleep_deep: "1h 0min", sleep_rem: "1h 0min", sleep_light: "3h 0min" } : null));
		renderStages(root, computeStages(index, END), "en", false, noop);
		expect(text(".ghs-card-value")).toBe(en.panelNoReading);
		expect(root.querySelector(".ghs-stack")).toBeNull();
	});

	it("speaks the plugin language and shows the explanation", async () => {
		renderStages(root, computeStages(await stages([60, 90, 200, 20], [60, 90, 200, 20]), END), "de", true, noop);
		expect(text(".ghs-stage-label")).toBe(de.panelStageDeep);
		expect(text(".ghs-explain")).toBe(de.panelStagesExplain);
	});
});

describe("body battery card", () => {
	const battery = (today: Record<string, number>, usual: Record<string, number> | ((ago: number) => Record<string, number>), nights = 30) =>
		indexOf((ago) => (ago === 0 ? today : ago <= nights ? (typeof usual === "function" ? usual(ago) : usual) : null));
	const rows = (): { label: string; value: string }[] =>
		Array.from(root.querySelectorAll(".ghs-battery-row")).map((r) => ({ label: r.querySelector(".ghs-battery-row-label")?.textContent ?? "", value: r.querySelector(".ghs-battery-row-head span:last-child")?.textContent ?? "" }));

	it("shows your usual peaks and today as two bars on the same scale", async () => {
		// the peaks of the 30 days before are 70 and 90 in turn: usual range 70 to 90, mean 80
		const model = computeBattery(await battery({ body_battery_max: 86, body_battery_min: 38, body_battery: 48 }, (ago) => ({ body_battery_max: ago % 2 ? 70 : 90, body_battery: 55 })), END);
		expect(model.usualRange).toEqual({ low: 70, high: 90 });
		expect(model.usualPeak).toBe(80);
		renderBattery(root, model, "en", false, noop);
		expect(text(".ghs-card-value")).toBe("86 Peak");
		expect(rows()).toEqual([
			{ label: en.panelBatteryUsualRow, value: "70–90" },
			{ label: en.panelBatteryToday, value: "38 → 86" },
		]);
		const usual = root.querySelector(".ghs-battery-usual") as HTMLElement;
		expect(usual.style.getPropertyValue("--ghs-x")).toBe("70%");
		expect(usual.style.getPropertyValue("--ghs-w")).toBe("20%");
		expect((root.querySelector(".ghs-tick") as HTMLElement).style.getPropertyValue("--ghs-x")).toBe("80%");
		const today = root.querySelector(".ghs-battery-fill") as HTMLElement;
		expect(today.style.getPropertyValue("--ghs-x")).toBe("38%");
		expect(today.style.getPropertyValue("--ghs-w")).toBe("48%");
		expect(text(".ghs-foot-value")).toBe("+48 · usual +55");
		expect(root.querySelector(".ghs-card-warning")).toBeNull();
	});

	it("works with only the peak: one value for today and no usual bar", async () => {
		renderBattery(root, computeBattery(await battery({ body_battery_max: 90 }, {}, 0), END), "en", false, noop);
		expect(rows()).toEqual([{ label: en.panelBatteryToday, value: "90" }]);
		expect(root.querySelector(".ghs-battery-usual")).toBeNull();
		expect(root.querySelector(".ghs-foot")).toBeNull();
	});

	it("shows the charge without a usual when there is no history for it, and keeps values inside the track", async () => {
		const model = computeBattery(await battery({ body_battery_max: 140, body_battery_min: -5, body_battery: 65 }, {}, 0), END);
		renderBattery(root, model, "en", false, noop);
		expect(text(".ghs-foot-value")).toBe("+65");
		const fill = root.querySelector(".ghs-battery-fill") as HTMLElement;
		expect(fill.style.getPropertyValue("--ghs-x")).toBe("0%");
		expect(fill.style.getPropertyValue("--ghs-w")).toBe("100%");
	});

	it("warns that the usual peaks are an early estimate until 14 days", async () => {
		renderBattery(root, computeBattery(await battery({ body_battery_max: 80 }, { body_battery_max: 78 }, 8), END), "en", false, noop);
		expect(text(".ghs-card-warning")).toBe("Early estimate from 8 days, likely inaccurate until 14 days.");
		expect(rows()[0]!.value).toBe("78–78");
	});

	it("says there is no reading without a peak", async () => {
		renderBattery(root, computeBattery(await battery({}, {}, 0), END), "en", false, noop);
		expect(text(".ghs-card-value")).toBe(en.panelNoReading);
		expect(root.querySelector(".ghs-battery-fill")).toBeNull();
	});

	it("speaks the plugin language and shows the explanation", async () => {
		renderBattery(root, computeBattery(await battery({ body_battery_max: 83, body_battery: 65 }, { body_battery_max: 78, body_battery: 56 }), END), "de", true, noop);
		expect(text(".ghs-foot-label")).toBe(de.panelRecharged);
		expect(text(".ghs-explain")).toBe(de.panelBatteryExplain);
		expect(rows()[1]!.label).toBe(de.panelBatteryToday);
	});
});

describe("stress card", () => {
	const stress = (today: number | null, week: number | null, nights = 7) => indexOf((ago) => (ago === 0 ? (today === null ? null : { stress: today }) : ago <= nights && week !== null ? { stress: week } : null), 8);

	it.each([
		[0, "Calm"],
		[25, "Calm"],
		[26, "Low"],
		[50, "Low"],
		[51, "Medium"],
		[75, "Medium"],
		[76, "High"],
		[100, "High"],
		[130, "High"],
	])("names level %s: %s", async (level, band) => {
		renderStress(root, computeStress(await stress(level, null), END), "en", false, noop);
		expect(text(".ghs-unit")).toBe(` ${band}`);
	});

	it("places the dot and the 7-day marker on the 0 to 100 bar", async () => {
		renderStress(root, computeStress(await stress(31, 38), END), "en", false, noop);
		expect(text(".ghs-card-value")).toBe("31 Low");
		expect((root.querySelector(".ghs-dot") as HTMLElement).style.getPropertyValue("--ghs-x")).toBe("31%");
		expect((root.querySelector(".ghs-tick") as HTMLElement).style.getPropertyValue("--ghs-x")).toBe("38%");
		expect(text(".ghs-card-note")).toBe("7-day average 38");
	});

	it("draws the stressed minutes against the recovering minutes as a split bar", async () => {
		const index = await indexOf((ago) => ({ stress: 31, ...(ago === 0 ? { stress_high: 65, recovery_high: 190 } : {}) }), 8);
		renderStress(root, computeStress(index, END), "en", false, noop);
		const parts = Array.from(root.querySelectorAll<HTMLElement>(".ghs-split-part"));
		expect(parts.map((p) => p.style.getPropertyValue("--ghs-w"))).toEqual([`${(65 / 255) * 100}%`, `${(190 / 255) * 100}%`]);
		expect(text(".ghs-split-label-stressed")).toBe("1 h 5 min stressed");
		expect(text(".ghs-split-label-recovering")).toBe("3 h 10 min recovering");
	});

	it("shows no split bar without both values or without any minutes", async () => {
		const only = await indexOf((ago) => ({ stress: 31, ...(ago === 0 ? { stress_high: 65 } : {}) }), 8);
		renderStress(root, computeStress(only, END), "en", false, noop);
		expect(root.querySelector(".ghs-split")).toBeNull();
		root.empty();
		const none = await indexOf((ago) => ({ stress: 31, ...(ago === 0 ? { stress_high: 0, recovery_high: 0 } : {}) }), 8);
		renderStress(root, computeStress(none, END), "en", false, noop);
		expect(root.querySelector(".ghs-split")).toBeNull();
	});

	it("speaks the plugin language in the split labels", async () => {
		const index = await indexOf((ago) => ({ stress: 31, ...(ago === 0 ? { stress_high: 65, recovery_high: 190 } : {}) }), 8);
		renderStress(root, computeStress(index, END), "de", false, noop);
		expect(text(".ghs-split-label-recovering")).toBe("3 h 10 min in Erholung");
	});

	it("clamps a level above the scale to the end of the bar", async () => {
		renderStress(root, computeStress(await stress(130, null), END), "en", false, noop);
		expect((root.querySelector(".ghs-dot") as HTMLElement).style.getPropertyValue("--ghs-x")).toBe("100%");
	});

	it("shows the level without a marker while there are fewer than 5 days before", async () => {
		renderStress(root, computeStress(await stress(31, 38, 3), END), "en", false, noop);
		expect(root.querySelector(".ghs-tick")).toBeNull();
		expect(root.querySelector(".ghs-card-note")).toBeNull();
	});

	it("says there is no reading without a level", async () => {
		renderStress(root, computeStress(await stress(null, 38), END), "en", false, noop);
		expect(text(".ghs-card-value")).toBe(en.panelNoReading);
		expect(root.querySelector(".ghs-dot")).toBeNull();
	});

	it("speaks the plugin language and shows the explanation", async () => {
		renderStress(root, computeStress(await stress(31, 38), END), "de", true, noop);
		expect(text(".ghs-card-note")).toBe("7-Tage-Schnitt 38");
		expect(text(".ghs-explain")).toBe(de.panelStressExplain);
	});
});
