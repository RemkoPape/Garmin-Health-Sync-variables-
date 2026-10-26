import { daysBetween, shiftDate, weekStart } from "../../dates";
import { t } from "../../i18n/t";
import { formatNumber, formatSigned } from "../format";
import type { DayIndex } from "../index";
import { slope } from "../stats";
import { renderCard } from "./shell";

const WEEKS = 12;
/** Weeks with a value needed before a trend is drawn. */
export const VO2_MIN_WEEKS = 3;
/** The newest value must be this recent, or the card has nothing current to say. */
const MAX_AGE_DAYS = 28;
/** A change over the 12 weeks beyond this counts as rising or falling. */
const STEADY_CHANGE = 0.3;

export interface Vo2Model {
	/** The latest value of each of the last 12 weeks, oldest first; null = none that week. */
	weeks: (number | null)[];
	points: number;
	/** The newest value, null when there is none or it is older than 28 days. */
	latest: number | null;
	/** Change over 12 weeks from the slope, null without enough weeks. */
	change: number | null;
	direction: "up" | "down" | "steady" | null;
}

export function computeVo2(index: DayIndex, date: string): Vo2Model {
	const thisWeek = weekStart(date);
	const weeks: (number | null)[] = [];
	let newest: { value: number; day: string } | null = null;
	for (let i = WEEKS - 1; i >= 0; i--) {
		const start = shiftDate(thisWeek, -7 * i);
		let value: number | null = null;
		for (let d = 0; d < 7; d++) {
			const day = shiftDate(start, d);
			if (day > date) break;
			const v = index.value("vo2_max", day);
			if (v !== null) {
				value = v;
				newest = { value: v, day };
			}
		}
		weeks.push(value);
	}
	const points: { x: number; y: number }[] = [];
	weeks.forEach((v, x) => {
		if (v !== null) points.push({ x, y: v });
	});
	const fresh = newest !== null && daysBetween(newest.day, date) <= MAX_AGE_DAYS;
	const change = points.length >= VO2_MIN_WEEKS ? slope(points) * WEEKS : null;
	return {
		weeks,
		points: points.length,
		latest: fresh && newest ? newest.value : null,
		change,
		direction: change === null ? null : change > STEADY_CHANGE ? "up" : change < -STEADY_CHANGE ? "down" : "steady",
	};
}

const ARROWS = { up: "↑", down: "↓", steady: "→" } as const;

export function renderVo2(parent: HTMLElement, model: Vo2Model, lang: string, explainOpen: boolean, onToggleExplain: () => void): void {
	const value = model.latest === null ? null : formatNumber(model.latest, lang, 0);
	renderCard(parent, { title: t("panelVo2Title", lang), value, unit: "ml/kg/min", explain: t("panelVo2Explain", lang), explainOpen, onToggleExplain, lang }, (card) => {
		if (model.latest === null) return;
		if (model.direction === null || model.change === null) {
			card.createDiv({ cls: "ghs-card-note", text: t("panelLockedWeeks", lang).replace("{need}", String(VO2_MIN_WEEKS)).replace("{have}", String(model.points)) });
			return;
		}
		const valid = model.weeks.filter((v): v is number => v !== null);
		const lo = Math.min(...valid);
		const hi = Math.max(...valid);
		const bars = card.createDiv({ cls: "ghs-trend-bars ghs-vo2-bars", attr: { role: "img", "aria-label": `${formatNumber(lo, lang, 0)}–${formatNumber(hi, lang, 0)}` } });
		model.weeks.forEach((v, i) => {
			const bar = bars.createDiv({ cls: `ghs-trend-bar${v === null ? " ghs-trend-bar-missing" : ""}${i === model.weeks.length - 1 ? " ghs-trend-bar-last" : ""}` });
			bar.setCssProps({ "--ghs-h": v === null ? "0%" : `${hi === lo ? 60 : 25 + ((v - lo) / (hi - lo)) * 75}%` });
		});
		const foot = card.createDiv({ cls: "ghs-foot" });
		foot.createSpan({ cls: "ghs-foot-label", text: `${ARROWS[model.direction]} ${t("panelVo2Change", lang).replace("{delta}", formatSigned(model.change, lang))}` });
		foot.createSpan({ cls: "ghs-foot-value", text: t(model.direction === "up" ? "panelVo2Up" : model.direction === "down" ? "panelVo2Down" : "panelVo2Steady", lang) });
	});
}
