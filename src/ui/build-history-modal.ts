import { App, Modal, Setting } from "obsidian";
import { daysBetween, localDateString, shiftDate } from "../dates";
import { estimateMs, formatDuration } from "../history/progress";
import { t } from "../i18n/t";

/** Asks how far back to build the history and what that costs in time. */
export class BuildHistoryModal extends Modal {
	constructor(
		app: App,
		private readonly lang: string,
		/** Newest day that will be fetched (yesterday). */
		private readonly newest: string,
		private readonly delayMs: number,
		private readonly metricCount: number,
		private readonly onSubmit: (from: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: t("modalHistoryTitle", this.lang) });
		contentEl.createEl("p", { text: t("modalHistoryDesc", this.lang) });

		let from = shiftDate(localDateString(new Date()), -5 * 365);
		const estimate = contentEl.createEl("p", { cls: "ghs-history-estimate" });
		const showEstimate = (): void => {
			const days = Math.max(0, daysBetween(from, this.newest) + 1);
			estimate.setText(t("modalHistoryEstimate", this.lang).replace("{time}", formatDuration(estimateMs(days, this.delayMs))).replace("{days}", String(days)).replace("{metrics}", String(this.metricCount)));
		};
		showEstimate();

		new Setting(contentEl).setName(t("modalHistoryFrom", this.lang)).addText((text) => {
			text.inputEl.type = "date";
			text.setValue(from).onChange((value) => {
				from = value || from;
				showEstimate();
			});
		});
		new Setting(contentEl).addButton((button) =>
			button.setButtonText(t("modalHistoryStart", this.lang)).setCta().onClick(() => {
				this.onSubmit(from);
				this.close();
			}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
