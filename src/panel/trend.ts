import { t } from "../i18n/t";
import { shiftDate } from "../dates";

const DAYS = 14;
const WEEK = 7;
/** Days with a value needed in each of the two weeks before a trend is shown. */
const MIN_PER_WEEK = 4;
/** A change below this share of the earlier week counts as steady. */
const STEADY_SHARE = 0.02;

export interface Trend {
	/** The last 14 days, oldest first; null = no value. */
	series: (number | null)[];
	direction: "up" | "down" | "steady";
	/** This week's mean minus the week before's. */
	delta: number;
}

function mean(values: (number | null)[]): number | null {
	const valid = values.filter((v): v is number => v !== null);
	return valid.length < MIN_PER_WEEK ? null : valid.reduce((a, b) => a + b, 0) / valid.length;
}

/** How the last 7 days (the shown day included) compare with the 7 days before them, or null with too little data. */
export function computeTrend(read: (date: string) => number | null, date: string): Trend | null {
	const series: (number | null)[] = [];
	for (let i = DAYS - 1; i >= 0; i--) series.push(read(shiftDate(date, -i)));
	const current = mean(series.slice(WEEK));
	const previous = mean(series.slice(0, WEEK));
	if (current === null || previous === null) return null;
	const delta = current - previous;
	const steady = Math.abs(delta) < Math.abs(previous) * STEADY_SHARE;
	return { series, direction: steady ? "steady" : delta > 0 ? "up" : "down", delta };
}

/** Rendering input of a card's trend: the trend and how to write a number of that card. */
export interface TrendView {
	trend: Trend | null;
	format: (n: number) => string;
}

const ARROWS = { up: "↑", down: "↓", steady: "→" } as const;

/** Fourteen tiny bars and one line: "↑ +3 ms vs last week", neutral in colour because up is not always good. */
export function renderTrend(parent: HTMLElement, view: TrendView, lang: string): void {
	const { trend, format } = view;
	if (!trend) return;
	const row = parent.createDiv({ cls: "ghs-trend" });
	const bars = row.createDiv({ cls: "ghs-trend-bars", attr: { "aria-hidden": "true" } });
	const valid = trend.series.filter((v): v is number => v !== null);
	const lo = Math.min(...valid);
	const hi = Math.max(...valid);
	trend.series.forEach((v, i) => {
		const bar = bars.createDiv({ cls: `ghs-trend-bar${v === null ? " ghs-trend-bar-missing" : ""}${i === trend.series.length - 1 ? " ghs-trend-bar-last" : ""}` });
		// 25 to 100 percent, so the lowest day is still visible; a flat series is drawn at the middle
		bar.setCssProps({ "--ghs-h": v === null ? "0%" : `${hi === lo ? 60 : 25 + ((v - lo) / (hi - lo)) * 75}%` });
	});
	const sign = trend.delta < 0 ? "−" : "+";
	const text = trend.direction === "steady" ? t("panelTrendSteady", lang) : t("panelTrend", lang).replace("{delta}", `${sign}${format(Math.abs(trend.delta))}`);
	row.createSpan({ cls: "ghs-trend-text", text: `${ARROWS[trend.direction]} ${text}` });
}
