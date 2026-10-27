import type { App, TAbstractFile, TFile } from "obsidian";

/**
 * What a daily note does with its properties block (the "Properties of daily notes" setting): nothing, fold it when
 * the note opens, or hide the rows the sync wrote (the side panel shows them) so only the user's own properties stay in view.
 *
 * Folding works like the plugin "Fold properties by default" (MIT, Tommy Bergeron): Obsidian builds the properties
 * block a moment after the note opens, so look for it a few times, then run Obsidian's own "Toggle fold
 * properties" command if the block is still open. Hiding marks the rows (`data-property-key`) with a class and
 * watches the block, because Obsidian rebuilds rows when a value changes, which a sync does.
 */
export type PropertiesMode = "off" | "fold" | "hide";

const FOLD_COMMAND = "editor:toggle-fold-properties";
const FIRST_DELAY_MS = 300;
const RETRY_DELAY_MS = 100;
const MAX_ATTEMPTS = 17;
const HIDDEN_CLASS = "ghs-property-hidden";
const PREFIX = "ohs_";

/** The command registry is not part of the published typings. */
interface CommandHost {
	commands: { executeCommandById(id: string): boolean };
}

interface NotePropertiesOptions {
	mode: () => PropertiesMode;
	/** Whether the note is a daily note: nothing else is touched. */
	isDaily: (file: TFile) => boolean;
	/** The keys (without prefix) of the note that the sync wrote, which are hidden. */
	hidden: (file: TFile) => Set<string>;
}

export class NoteProperties {
	private timer: number | null = null;
	/** The note that was folded last, so a layout change does not fold again what the user opened on purpose. */
	private folded: string | null = null;
	private observer: MutationObserver | null = null;
	/** The note whose rows are hidden. */
	private hiding: TFile | null = null;

	constructor(
		private readonly app: App,
		private readonly options: NotePropertiesOptions,
	) {}

	/** A note was opened (also when it is the one already handled: its properties block is new). */
	fileOpened(file: TFile | null): void {
		this.cancel();
		this.unhide();
		if (file && this.options.mode() !== "off" && this.options.isDaily(file)) this.schedule(file, 0);
	}

	/** Panes were moved or switched: handle the active note, except one that was folded already. */
	layoutChanged(): void {
		const file = this.app.workspace.getActiveFile();
		if (file && (this.options.mode() === "hide" || file.path !== this.folded)) this.fileOpened(file);
	}

	/** The setting (or what the panel shows) changed: start again with the note that is open. */
	modeChanged(): void {
		this.folded = null;
		this.layoutChanged();
	}

	/** A note was changed (a sync wrote it): its hidden rows are worked out again, as its keys may have changed. */
	noteChanged(file: TAbstractFile): void {
		const block = activeDocument.querySelector(".workspace-leaf.mod-active .metadata-container");
		if (file === this.hiding && block) this.hide(block, this.hiding);
	}

	cancel(): void {
		this.observer?.disconnect();
		this.observer = null;
		this.hiding = null;
		if (this.timer === null) return;
		window.clearTimeout(this.timer);
		this.timer = null;
	}

	/** Shows every row that was hidden. */
	private unhide(): void {
		for (const row of Array.from(activeDocument.querySelectorAll(`.${HIDDEN_CLASS}`))) row.removeClass(HIDDEN_CLASS);
	}

	private hide(block: Element, file: TFile): void {
		const keys = this.options.hidden(file);
		for (const row of Array.from(block.querySelectorAll(".metadata-property"))) {
			const key = (row.getAttribute("data-property-key") ?? "").replace(PREFIX, "");
			row.toggleClass(HIDDEN_CLASS, keys.has(key));
		}
	}

	private schedule(file: TFile, attempt: number): void {
		this.timer = window.setTimeout(() => {
			this.timer = null;
			if (this.app.workspace.getActiveFile() !== file) return;
			const block = activeDocument.querySelector(".workspace-leaf.mod-active .metadata-container");
			if (!block) {
				if (attempt < MAX_ATTEMPTS) this.schedule(file, attempt + 1);
				return;
			}
			if (this.options.mode() === "hide") {
				this.hiding = file;
				this.hide(block, file);
				this.observer = new MutationObserver(() => this.hide(block, file));
				this.observer.observe(block, { childList: true, subtree: true });
				return;
			}
			this.folded = file.path;
			if (!block.classList.contains("is-collapsed")) (this.app as unknown as CommandHost).commands.executeCommandById(FOLD_COMMAND);
		}, attempt === 0 ? FIRST_DELAY_MS : RETRY_DELAY_MS);
	}
}
