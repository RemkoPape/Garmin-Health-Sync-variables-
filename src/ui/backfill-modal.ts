import { App, Modal, Setting } from "obsidian";
import { daysBetween, localDateString, shiftDate } from "../dates";
import { estimateMs, formatDuration } from "../history/progress";
import { t } from "../i18n/t";
import type { MissingNoteBehaviour } from "../settings";

/** How far back "until my data starts" looks at most. */
export const START_LOOKBACK_YEARS = 5;

/** What the dialog asks for: the range and what to do with it. */
export interface BackfillRequest {
	from: string;
	to: string;
	force: boolean;
	behaviour: MissingNoteBehaviour;
	untilStart: boolean;
}

/** Asks which days to fetch, what to do with days without a note, and what that costs in time. */
export class BackfillModal extends Modal {
	constructor(
		app: App,
		private readonly lang: string,
		/** The setting for days without a daily note; the dialog starts from it. */
		private readonly behaviour: MissingNoteBehaviour,
		private readonly delayMs: number,
		private readonly metricCount: number,
		private readonly onSubmit: (request: BackfillRequest) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, lang } = this;
		contentEl.createEl("h2", { text: t("modalBackfillTitle", lang) });
		contentEl.createEl("p", { text: t("modalBackfillDesc", lang) });

		const today = localDateString(new Date());
		const request: BackfillRequest = { from: shiftDate(today, -7), to: today, force: false, behaviour: this.behaviour, untilStart: false };
		const estimate = contentEl.createEl("p", { cls: "ghs-history-estimate" });
		const firstDay = (): string => (request.untilStart ? shiftDate(today, -START_LOOKBACK_YEARS * 365) : request.from);
		const showEstimate = (): void => {
			const days = Math.max(0, daysBetween(firstDay(), request.to) + 1);
			estimate.setText(t("modalBackfillEstimate", lang).replace("{time}", formatDuration(estimateMs(days, this.delayMs))).replace("{days}", String(days)).replace("{metrics}", String(this.metricCount)));
		};
		showEstimate();

		let fromInput: HTMLInputElement | null = null;
		new Setting(contentEl).setName(t("modalBackfillFrom", lang)).addText((text) => {
			fromInput = text.inputEl;
			text.inputEl.type = "date";
			text.setValue(request.from).onChange((value) => {
				request.from = value || request.from;
				showEstimate();
			});
		});
		new Setting(contentEl).setName(t("modalBackfillTo", lang)).addText((text) => {
			text.inputEl.type = "date";
			text.setValue(request.to).onChange((value) => {
				request.to = value || request.to;
				showEstimate();
			});
		});
		new Setting(contentEl).setName(t("modalBackfillUntilStart", lang)).setDesc(t("modalBackfillUntilStartDesc", lang)).addToggle((toggle) =>
			toggle.setValue(false).onChange((value) => {
				request.untilStart = value;
				// the first day is the one that the run looks back to, so the field gives way to the switch
				fromInput!.disabled = value;
				showEstimate();
			}),
		);
		new Setting(contentEl).setName(t("settingsMissingNote", lang)).addDropdown((dropdown) =>
			dropdown
				.addOption("create", t("missingNoteCreate", lang))
				.addOption("history", t("missingNoteHistory", lang))
				.addOption("skip", t("missingNoteSkip", lang))
				.setValue(request.behaviour)
				.onChange((value) => {
					request.behaviour = value as MissingNoteBehaviour;
				}),
		);
		new Setting(contentEl).setName(t("modalBackfillAgain", lang)).setDesc(t("modalBackfillForceDesc", lang)).addToggle((toggle) =>
			toggle.setValue(false).onChange((value) => {
				request.force = value;
			}),
		);
		new Setting(contentEl).addButton((button) =>
			button.setButtonText(t("modalBackfillStart", lang)).setCta().onClick(() => {
				this.onSubmit({ ...request, from: firstDay() });
				this.close();
			}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
