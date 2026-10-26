import { App, Modal, Setting } from "obsidian";
import { t } from "../i18n/t";
import type { ReleaseNote } from "../release-notes";

/** The "what's new" window. It closes only through its button: Escape, a click next to the window, the
 *  close icon and the Android back gesture all end in `close()`, which does nothing until the user confirmed. */
export class WhatsNewModal extends Modal {
	private acknowledged = false;

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
			}
		}

		new Setting(contentEl)
			.setClass("ghs-whats-new-actions")
			.addButton(btn => {
				btn.setButtonText(t("whatsNewGotIt", this.lang))
					.setCta()
					.onClick(() => {
						this.acknowledged = true;
						this.close();
					});
				btn.buttonEl.focus();
			});
	}

	close(): void {
		if (this.acknowledged) super.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
