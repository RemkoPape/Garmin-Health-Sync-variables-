import { setIcon } from "obsidian";
import { t } from "../../i18n/t";
import { formatNumber } from "../format";
import type { DayIndex } from "../index";
import { rangeBar } from "../svg";
import { baseline, windowValues, zScore, type Baseline } from "../stats";

/** Window and minimum of valid days before the personal range unlocks (spec: about 21 of the last 30). */
export const HRV_WINDOW_DAYS = 30;
export const HRV_MIN_DAYS = 21;
const HRV_SD_FLOOR_MS = 2;

export interface HrvModel {
	value: number | null;
	/** Days with a reading in the window. */
	have: number;
	baseline: Baseline | null;
	/** Distance from the personal mean in standard deviations. */
	z: number | null;
}

export function computeHrv(index: DayIndex, date: string): HrvModel {
	const values = windowValues(index, "hrv", date, HRV_WINDOW_DAYS);
	const b = baseline(values, HRV_MIN_DAYS, HRV_SD_FLOOR_MS);
	const value = index.value("hrv", date);
	return { value, have: values.length, baseline: b, z: value !== null && b ? zScore(value, b) : null };
}

function toneOf(z: number): "ok" | "warn" | "bad" {
	const a = Math.abs(z);
	return a <= 1 ? "ok" : a < 2 ? "warn" : "bad";
}

/** The HRV card: tonight's value against the personal range, with the explanation behind an (i) button. */
export function renderHrv(parent: HTMLElement, model: HrvModel, lang: string, explainOpen: boolean, onToggleExplain: () => void): void {
	const card = parent.createDiv({ cls: "ghs-card" });
	const head = card.createDiv({ cls: "ghs-card-head" });
	head.createSpan({ cls: "ghs-card-title", text: t("panelHrvTitle", lang) });
	const info = head.createEl("button", { cls: "clickable-icon ghs-info", attr: { "aria-label": t("panelInfo", lang), "aria-expanded": String(explainOpen) } });
	setIcon(info, "info");
	info.addEventListener("click", onToggleExplain);

	if (model.value === null) {
		card.addClass("ghs-card-empty");
		card.createDiv({ cls: "ghs-card-value", text: t("panelNoReading", lang) });
	} else {
		card.createDiv({ cls: "ghs-card-value", text: `${formatNumber(model.value, lang)} ms` });
	}

	const b = model.baseline;
	if (!b) {
		card.createDiv({
			cls: "ghs-card-note",
			text: t("panelLocked", lang).replace("{need}", String(HRV_MIN_DAYS)).replace("{have}", String(model.have)),
		});
	} else {
		if (model.value !== null && model.z !== null) rangeBar(card, model.value, b.mean, b.sd, toneOf(model.z));
		card.createDiv({
			cls: "ghs-card-note",
			text: t("panelUsualRange", lang)
				.replace("{low}", formatNumber(b.mean - b.sd, lang))
				.replace("{high}", formatNumber(b.mean + b.sd, lang)),
		});
	}

	if (explainOpen) card.createDiv({ cls: "ghs-explain", text: t("panelHrvExplain", lang) });
}
