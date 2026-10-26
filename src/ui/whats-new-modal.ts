import { App, Modal, Setting } from "obsidian";
import { t } from "../i18n/t";
import type { ReleaseNote } from "../release-notes";

/** The "what's new" window. It closes only on an explicit confirmation: the **Got it** button or the close
 *  icon, which counts as the same thing. Escape, a click next to the window and the Android back gesture end
 *  in `close()` too, which does nothing until the user confirmed, so they cannot dismiss it by accident. */
export class WhatsNewModal extends Modal {
	private acknowledged = false;

	constructor(app: App, private readonly lang: string, private readonly notes: ReleaseNote[]) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass("ghs-whats-new-modal");
		// Capture phase: runs before Obsidian's own click handler on the icon, which calls close().
		this.modalEl.querySelector(".modal-close-button")?.addEventListener("click", () => { this.acknowledged = true; }, true);
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
