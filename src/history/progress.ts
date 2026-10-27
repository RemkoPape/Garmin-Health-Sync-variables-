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

const UPDATE_EVERY_MS = 1000;

/**
 * What a long history build shows: a notice that stays at the top with the day, how many days are done, the time
 * left and a Stop button, and on a desktop a status bar item with the percentage. Updated at most once a second.
 */
export class BuildProgressUi {
	private readonly notice: Notice;
	private readonly text: HTMLElement;
	private lastUpdate = 0;

	constructor(private readonly lang: string, onStop: () => void, private readonly statusBar: HTMLElement | null) {
		const fragment = createFragment();
		const wrapper = fragment.createDiv({ cls: "ghs-history-notice" });
		this.text = wrapper.createDiv({ cls: "ghs-history-text" });
		wrapper.createEl("button", { text: t("historyStop", lang) }).addEventListener("click", onStop);
		this.notice = new Notice(fragment, 0);
	}

	update(progress: BuildProgress): void {
		const now = Date.now();
		if (progress.state === "running" && now - this.lastUpdate < UPDATE_EVERY_MS) return;
		this.lastUpdate = now;
		const values = { date: progress.date, done: String(progress.done), total: String(progress.total) };
		const fill = (text: string): string => Object.entries(values).reduce((acc, [key, value]) => acc.replace(`{${key}}`, value), text);
		if (progress.state === "paused") {
			this.text.textContent = t("historyPaused", this.lang).replace("{wait}", formatDuration(progress.pauseMs));
		} else if (progress.etaMs === null) {
			this.text.textContent = fill(t("historyProgressStart", this.lang));
		} else {
			this.text.textContent = fill(t("historyProgress", this.lang)).replace("{eta}", formatDuration(progress.etaMs));
		}
		this.statusBar?.setText(t("historyStatusBar", this.lang).replace("{percent}", String(Math.round((progress.done / progress.total) * 100))));
	}

	/** Removes the notice and the status bar item. */
	dismiss(): void {
		this.notice.hide();
		this.statusBar?.remove();
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
