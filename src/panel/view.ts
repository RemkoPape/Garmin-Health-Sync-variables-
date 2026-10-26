import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type HealthSyncPlugin from "../main";
import { dateFromDailyNote } from "../daily-note";
import { localDateString, shiftDate } from "../dates";
import { t } from "../i18n/t";
import { PANEL_CARDS, SECTION_TITLES, type SectionId } from "./cards";
import { formatPanelDate } from "./format";
import { DayIndex } from "./index";

export const VIEW_TYPE_HEALTH_PANEL = "garmin-health-panel";
const RENDER_DEBOUNCE_MS = 300;

/** Read-only side panel. Cards are computed from the daily notes' frontmatter; nothing is written or fetched. */
export class HealthPanelView extends ItemView {
	private date = localDateString(new Date());
	/** A render was skipped while the leaf was hidden; do it when it is shown again. */
	private dirty = false;
	private readonly index: DayIndex;
	private renderTimer = 0;
	/** Card whose explanation is open; only one at a time. */
	private explain: string | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: HealthSyncPlugin) {
		super(leaf);
		this.index = new DayIndex(this.app, () => this.plugin.settings);
	}

	getViewType(): string {
		return VIEW_TYPE_HEALTH_PANEL;
	}

	getDisplayText(): string {
		return t("panelTitle", this.plugin.settings.language);
	}

	getIcon(): string {
		return "activity";
	}

	onOpen(): Promise<void> {
		this.followActiveNote();
		this.registerEvent(this.app.workspace.on("file-open", () => {
			this.followActiveNote();
			this.render();
		}));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
			if (this.dirty) this.render();
		}));
		// The sync writes notes in bursts: rebuild the index lazily and render once after the burst.
		const changed = (): void => {
			this.index.invalidate();
			window.clearTimeout(this.renderTimer);
			this.renderTimer = window.setTimeout(() => this.render(), RENDER_DEBOUNCE_MS);
		};
		this.registerEvent(this.app.metadataCache.on("changed", changed));
		this.registerEvent(this.app.vault.on("delete", changed));
		this.registerEvent(this.app.vault.on("rename", changed));
		this.render();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		window.clearTimeout(this.renderTimer);
		return Promise.resolve();
	}

	/** Re-render after a language change. */
	refresh(): void {
		this.render();
	}

	/** The open daily note's date, otherwise today. */
	private followActiveNote(): void {
		const file = this.app.workspace.getActiveFile();
		const noted = file instanceof TFile ? dateFromDailyNote(file, this.plugin.settings) : null;
		this.date = noted ?? localDateString(new Date());
	}

	private render(): void {
		// No work for a hidden panel; render on the next reveal.
		if (!this.containerEl.isShown()) {
			this.dirty = true;
			return;
		}
		this.dirty = false;
		const lang = this.plugin.settings.language;
		const root = this.contentEl;
		root.empty();
		root.addClass("ghs-panel");

		const nav = root.createDiv({ cls: "ghs-daynav" });
		this.navButton(nav, "chevron-left", t("panelPrevDay", lang), () => this.move(-1), false);
		nav.createSpan({ cls: "ghs-daynav-date", text: formatPanelDate(this.date, lang) });
		const isToday = this.date >= localDateString(new Date());
		this.navButton(nav, "chevron-right", t("panelNextDay", lang), () => this.move(1), isToday);

		this.renderCards(root, lang);
	}

	/** The cards the user has not switched off, in order, under their section headers; half-width cards pair up. */
	private renderCards(root: HTMLElement, lang: string): void {
		let section: SectionId | null = null;
		let pair: HTMLElement | null = null;
		for (const card of PANEL_CARDS) {
			if (this.plugin.settings.panelCards[card.id] === false) continue;
			if (card.section !== section) {
				section = card.section;
				pair = null;
				root.createDiv({ cls: "ghs-section", text: t(SECTION_TITLES[section], lang) });
			}
			if (card.half) pair ??= root.createDiv({ cls: "ghs-pair" });
			else pair = null;
			card.render({
				parent: card.half ? (pair as HTMLElement) : root,
				index: this.index,
				date: this.date,
				lang,
				imperial: this.plugin.settings.unitSystem === "imperial",
				explainOpen: this.explain === card.id,
				onToggleExplain: () => {
					this.explain = this.explain === card.id ? null : card.id;
					this.render();
				},
			});
		}
	}

	private navButton(parent: HTMLElement, icon: string, label: string, onClick: () => void, disabled: boolean): void {
		const button = parent.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
		setIcon(button, icon);
		if (disabled) button.disabled = true;
		else button.addEventListener("click", onClick);
	}

	private move(days: number): void {
		this.date = shiftDate(this.date, days);
		this.render();
	}
}
