import { App, Modal, Setting } from "obsidian";
import { t } from "../i18n/t";
import type { ReleaseNote } from "../release-notes";
import { renderFigure } from "./whats-new-figures";

/** The "what's new" window. It closes every normal way (**Got it**, the close icon, Escape, a click next to
 *  the window, the Android back gesture): a user must never be stuck in it. The version is recorded before it
 *  opens, so however it was closed, it is not shown again. */
export class WhatsNewModal extends Modal {
	constructor(app: App, private readonly lang: string, private readonly notes: ReleaseNote[]) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass("ghs-whats-new-modal");
		contentEl.createEl("h2", { text: t("whatsNewTitle", this.lang) });

		// The text scrolls, the button below it stays on screen (small phones).
		const body = contentEl.createDiv({ cls: "ghs-whats-new-body" });
		if (this.notes.length > 1) {
			body.createEl("p", {
				cls: "ghs-whats-new-intro",
				text: t("whatsNewCatchUp", this.lang).replace("{count}", String(this.notes.length)),
			});
		}
		for (const note of this.notes) {
			body.createEl("h3", { text: `${note.version} — ${t(note.title, this.lang)}` });
			body.createEl("p", { cls: "ghs-whats-new-intro", text: t(note.intro, this.lang) });
			const list = body.createEl("ul");
			for (const item of note.items) {
				const li = list.createEl("li");
				li.createEl("strong", { text: t(item.title, this.lang) });
				li.createSpan({ text: ` — ${t(item.text, this.lang)}` });
				if (item.figure) renderFigure(li, item.figure, this.lang);
			}
		}

		new Setting(contentEl)
			.setClass("ghs-whats-new-actions")
			.addButton(btn => {
				btn.setButtonText(t("whatsNewGotIt", this.lang))
					.setCta()
					.onClick(() => this.close());
				btn.buttonEl.focus();
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
