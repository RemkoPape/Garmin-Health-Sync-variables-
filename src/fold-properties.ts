import type { App, TFile } from "obsidian";

/**
 * Folds the properties of a daily note when it opens, so the many synced metrics do not push the text of the
 * note off the screen. Same method as the plugin "Fold properties by default" (MIT, Tommy Bergeron): Obsidian
 * builds the properties block a moment after the note opens, so look for it a few times, then run Obsidian's own
 * "Toggle fold properties" command if the block is still open.
 */
const FOLD_COMMAND = "editor:toggle-fold-properties";
const FIRST_DELAY_MS = 300;
const RETRY_DELAY_MS = 100;
const MAX_ATTEMPTS = 17;

/** The command registry is not part of the published typings. */
interface CommandHost {
	commands: { executeCommandById(id: string): boolean };
}

export class PropertiesFolder {
	private timer: number | null = null;
	/** The note that was folded last, so a layout change does not fold again what the user opened on purpose. */
	private folded: string | null = null;

	constructor(
		private readonly app: App,
		private readonly wanted: (file: TFile) => boolean,
	) {}

	/** A note was opened (also when it is the one already folded: its properties block is new). */
	fileOpened(file: TFile | null): void {
		this.cancel();
		if (file && this.wanted(file)) this.schedule(file, 0);
	}

	/** Panes were moved or switched: fold the active note unless it was folded already. */
	layoutChanged(): void {
		const file = this.app.workspace.getActiveFile();
		if (file && file.path !== this.folded) this.fileOpened(file);
	}

	cancel(): void {
		if (this.timer === null) return;
		window.clearTimeout(this.timer);
		this.timer = null;
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
			this.folded = file.path;
			if (!block.classList.contains("is-collapsed")) (this.app as unknown as CommandHost).commands.executeCommandById(FOLD_COMMAND);
		}, attempt === 0 ? FIRST_DELAY_MS : RETRY_DELAY_MS);
	}
}
