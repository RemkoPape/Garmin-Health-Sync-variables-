import { formatNumber } from "./format";

/** Bar domain: the personal mean ± 3 standard deviations. */
const DOMAIN_SDS = 3;

function pct(value: number, mean: number, sd: number): number {
	const p = ((value - mean) / (sd * DOMAIN_SDS) + 1) * 50;
	return Math.min(100, Math.max(0, p));
}

export interface RangeBarOptions {
	value: number;
	mean: number;
	sd: number;
	/** "both": too low and too high are flagged; "high" / "low": only a value above / below the usual is. */
	sided: "both" | "high" | "low";
	tone: "ok" | "warn" | "bad";
	/** Accessible description of the bar ("Usual range 58–62 ms"). */
	label: string;
	lang: string;
	/** Number labels under the edges of the usual range; off for the half-width cards. */
	labels?: boolean;
}

/**
 * A colour scale from the personal range outwards (green inside mean ± 1 sd, orange at 2, red at 3) with a dot
 * at the value, dashed ticks at the edges of the usual range and their numbers underneath. The track is a CSS
 * gradient, so the dot and the labels stay round and crisp at any width.
 */
export function rangeBar(parent: HTMLElement, o: RangeBarOptions): HTMLElement {
	const wrap = parent.createDiv({ cls: "ghs-range", attr: { role: "img", "aria-label": o.label } });
	wrap.createDiv({ cls: `ghs-range-track ghs-range-track-${o.sided}` });
	const low = o.mean - o.sd;
	const high = o.mean + o.sd;
	const labels = o.labels === false ? null : wrap.createDiv({ cls: "ghs-range-labels" });
	for (const edge of [low, high]) {
		const x = `${pct(edge, o.mean, o.sd)}%`;
		wrap.createDiv({ cls: "ghs-tick" }).setCssProps({ "--ghs-x": x });
		labels?.createSpan({ cls: "ghs-tick-label", text: formatNumber(edge, o.lang, 0) }).setCssProps({ "--ghs-x": x });
	}
	wrap.addClass(o.labels === false ? "ghs-range-compact" : "ghs-range-labelled");
	wrap.createDiv({ cls: `ghs-dot ghs-dot-${o.tone}` }).setCssProps({ "--ghs-x": `${pct(o.value, o.mean, o.sd)}%` });
	return wrap;
}
