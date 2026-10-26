import { setIcon } from "obsidian";
import { t } from "../../i18n/t";
import { renderTrend, type TrendView } from "../trend";

export interface CardShell {
	title: string;
	/** Headline value of the day; null means "No reading" and makes the card dashed; undefined shows no headline. */
	value: string | null | undefined;
	/** Small muted text after the value ("ms", "· 78"). */
	unit?: string;
	explain: string;
	explainOpen: boolean;
	onToggleExplain: () => void;
	lang: string;
	/** Small trend line at the bottom of the card. */
	trend?: TrendView;
}

/** The frame every card shares: title, headline value, (i) button, the details and, when open, the explanation. */
export function renderCard(parent: HTMLElement, shell: CardShell, details: (card: HTMLElement) => void): void {
	const card = parent.createDiv({ cls: "ghs-card" });
	const head = card.createDiv({ cls: "ghs-card-head" });
	head.createSpan({ cls: "ghs-card-title", text: shell.title });
	if (shell.value === null) card.addClass("ghs-card-empty");
	if (shell.value !== undefined) {
		const value = head.createSpan({ cls: "ghs-card-value", text: shell.value ?? t("panelNoReading", shell.lang) });
		if (shell.value !== null && shell.unit) value.createSpan({ cls: "ghs-unit", text: ` ${shell.unit}` });
	} else {
		head.createSpan({ cls: "ghs-card-value" });
	}
	const info = head.createEl("button", { cls: "clickable-icon ghs-info", attr: { "aria-label": t("panelInfo", shell.lang), "aria-expanded": String(shell.explainOpen) } });
	setIcon(info, "info");
	info.addEventListener("click", shell.onToggleExplain);
	details(card);
	if (shell.trend) renderTrend(card, shell.trend, shell.lang);
	if (shell.explainOpen) card.createDiv({ cls: "ghs-explain", text: shell.explain });
}
