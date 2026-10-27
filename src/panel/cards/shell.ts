import { setIcon } from "obsidian";
import { t } from "../../i18n/t";
import { INSIGHTS, insightText, type Insight } from "../insights/registry";
import { renderTrend, type TrendView } from "../trend";

export interface CardShell {
	title: string;
	/** Headline value of the day; null means "No reading" and makes the card dashed; undefined shows no headline. */
	value: string | null | undefined;
	/** Small muted text after the value ("ms", "· 78"). */
	unit?: string;
	explain: string;
	/** The card's own numbers that are too much for the card, listed in the same box after the interpretation. */
	facts?: string[];
	explainOpen: boolean;
	onToggleExplain: () => void;
	lang: string;
	/** Small trend line at the bottom of the card. */
	trend?: TrendView;
	/** What the data suggests (why a value is off and what helps, or why it is good), shown under the light bulb before the general explanation. */
	insights?: Insight[];
}

/** The frame every card shares: title, headline value, light bulb button, the details and, when open, the explanation. */
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
	setIcon(info, "lightbulb");
	info.addEventListener("click", shell.onToggleExplain);
	details(card);
	if (shell.trend) renderTrend(card, shell.trend, shell.lang);
	if (shell.explainOpen) {
		const insights = shell.insights ?? [];
		const facts = shell.facts ?? [];
		if (insights.length > 0 || facts.length > 0) {
			const box = card.createDiv({ cls: "ghs-insight" });
			box.createDiv({ cls: "ghs-insight-title", text: t("panelInsightTitle", shell.lang) });
			for (const insight of insights) box.createDiv({ cls: `ghs-insight-item ghs-insight-${INSIGHTS[insight.id].kind}`, text: insightText(insight, shell.lang) });
			for (const fact of facts) box.createDiv({ cls: "ghs-insight-item ghs-fact", text: fact });
		}
		// what the card shows and how it is worked out, with the disclaimer, folded until asked for
		const about = card.createEl("details", { cls: "ghs-about" });
		about.createEl("summary", { cls: "ghs-insight-title", text: t("panelAboutTitle", shell.lang) });
		about.createDiv({ cls: "ghs-explain", text: shell.explain });
		about.createDiv({ cls: "ghs-insight-note", text: t("panelInsightNote", shell.lang) });
	}
}
