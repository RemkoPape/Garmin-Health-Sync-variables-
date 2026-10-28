import { Notice } from "obsidian";
import { t } from "../i18n/t";
import type { BuildProgress, BuildResult } from "./builder";

/** "1 h 05 min", "12 min": plain units that read the same in every supported language. */
export function formatDuration(ms: number): string {
	const minutes = Math.max(1, Math.ceil(ms / 60_000));
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return h === 0 ? `${m} min` : `${h} h ${String(m).padStart(2, "0")} min`;
}

/** What a day takes besides the delay between days: the requests themselves. */
const REQUEST_TIME_MS = 1500;

/** How long `days` days take when the provider asks for `delayMs` between them. */
export function estimateMs(days: number, delayMs: number): number {
	return days * (delayMs + REQUEST_TIME_MS);
}

/**
 * A notice that stays at the top with a line of text and a Stop button, and on a desktop a status bar item. The
 * notice can be dismissed with a click; `reveal` puts it back (the status bar item and a command do that), so the
 * progress of a long run is never lost.
 */
export class ProgressNotice {
	private notice: Notice | null = null;
	private text = "";
	private line!: HTMLElement;

	constructor(protected readonly lang: string, private readonly onStop: () => void, protected readonly statusBar: HTMLElement | null) {
		statusBar?.classList.add("mod-clickable");
		statusBar?.addEventListener("click", () => this.reveal());
		this.reveal();
	}

	/** Shows the notice again, with the latest text; an earlier one is removed. */
	reveal(): void {
		this.notice?.hide();
		const fragment = createFragment();
		const wrapper = fragment.createDiv({ cls: "ghs-history-notice" });
		this.line = wrapper.createDiv({ cls: "ghs-history-text", text: this.text });
		wrapper.createEl("button", { text: t("historyStop", this.lang) }).addEventListener("click", this.onStop);
		this.notice = new Notice(fragment, 0);
	}

	setText(text: string, statusText: string): void {
		this.text = text;
		this.line.textContent = text;
		this.statusBar?.setText(statusText);
	}

	/** Removes the notice and the status bar item. */
	dismiss(): void {
		this.notice?.hide();
		this.statusBar?.remove();
	}
}

const UPDATE_EVERY_MS = 1000;

/** What a long history build shows: the day, how many days are done, the time left. Updated at most once a second. */
export class BuildProgressUi extends ProgressNotice {
	private lastUpdate = 0;

	update(progress: BuildProgress): void {
		const now = Date.now();
		if (progress.state === "running" && now - this.lastUpdate < UPDATE_EVERY_MS) return;
		this.lastUpdate = now;
		const values = { date: progress.date, done: String(progress.done), total: String(progress.total) };
		const fill = (text: string): string => Object.entries(values).reduce((acc, [key, value]) => acc.replace(`{${key}}`, value), text);
		let text: string;
		if (progress.state === "paused") {
			text = t("historyPaused", this.lang).replace("{wait}", formatDuration(progress.pauseMs));
		} else if (progress.etaMs === null) {
			text = fill(t("historyProgressStart", this.lang));
		} else {
			text = fill(t("historyProgress", this.lang)).replace("{eta}", formatDuration(progress.etaMs));
		}
		this.setText(text, t("historyStatusBar", this.lang).replace("{percent}", String(Math.round((progress.done / progress.total) * 100))));
	}

	/** Removes the notice and the status bar item and says how it ended. */
	finish(result: BuildResult): void {
		this.dismiss();
		const key = {
			done: result.reachedStart || result.failed === 0 ? "historyDone" : "historyDoneWithErrors",
			stopped: "historyStopped",
			"gave-up": "historyGaveUp",
			"login-required": "noticeLoginRequired",
		}[result.status] as "historyDone" | "historyDoneWithErrors" | "historyStopped" | "historyGaveUp" | "noticeLoginRequired";
		new Notice(
			t(key, this.lang).replace("{fetched}", String(result.fetched)).replace("{skipped}", String(result.skipped)).replace("{failed}", String(result.failed)).replace("{date}", result.date),
			15000,
		);
	}
}
