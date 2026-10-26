/** Bar domain: the personal mean ± 3 standard deviations. */
const DOMAIN_SDS = 3;

function pct(value: number, mean: number, sd: number): number {
	const p = ((value - mean) / (sd * DOMAIN_SDS) + 1) * 50;
	return Math.min(100, Math.max(0, p));
}

/**
 * A range bar that scales to any width: the usual band (mean ± 1 sd) on a track, with a round dot at the
 * value. The SVG is stretched, so the dot is an HTML element placed with a CSS custom property.
 */
export function rangeBar(parent: HTMLElement, value: number, mean: number, sd: number, tone: "ok" | "warn" | "bad"): HTMLElement {
	const wrap = parent.createDiv({ cls: "ghs-range" });
	const svg = wrap.createSvg("svg", { attr: { viewBox: "0 0 100 10", preserveAspectRatio: "none", width: "100%", height: "10" } });
	svg.createSvg("rect", { cls: "ghs-range-track", attr: { x: "0", y: "3", width: "100", height: "4", rx: "2" } });
	const left = pct(mean - sd, mean, sd);
	const right = pct(mean + sd, mean, sd);
	svg.createSvg("rect", { cls: "ghs-range-band", attr: { x: String(left), y: "3", width: String(right - left), height: "4" } });
	const dot = wrap.createDiv({ cls: `ghs-dot ghs-dot-${tone}` });
	dot.setCssProps({ "--ghs-x": `${pct(value, mean, sd)}%` });
	return wrap;
}
