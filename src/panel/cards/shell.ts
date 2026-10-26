import { setIcon } from "obsidian";
import { t } from "../../i18n/t";

export interface CardShell {
	title: string;
	/** Headline value of the day; null means "No reading" and makes the card dashed. */
	value: string | null;
	explain: string;
	explainOpen: boolean;
	onToggleExplain: () => void;
	lang: string;
}

/** The frame every card shares: title, headline value, (i) button, the details and, when open, the explanation. */
export function renderCard(parent: HTMLElement, shell: CardShell, details: (card: HTMLElement) => void): void {
	const card = parent.createDiv({ cls: "ghs-card" });
	const head = card.createDiv({ cls: "ghs-card-head" });
	head.createSpan({ cls: "ghs-card-title", text: shell.title });
	if (shell.value === null) card.addClass("ghs-card-empty");
	head.createSpan({ cls: "ghs-card-value", text: shell.value ?? t("panelNoReading", shell.lang) });
	const info = head.createEl("button", { cls: "clickable-icon ghs-info", attr: { "aria-label": t("panelInfo", shell.lang), "aria-expanded": String(shell.explainOpen) } });
	setIcon(info, "info");
	info.addEventListener("click", shell.onToggleExplain);
	details(card);
	if (shell.explainOpen) card.createDiv({ cls: "ghs-explain", text: shell.explain });
}
