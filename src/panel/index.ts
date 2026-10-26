import type { App } from "obsidian";
import { dateFromDailyNote } from "../daily-note";

/** Frontmatter prefix the sync adds when "use prefix" is on. Notes of both kinds can sit in one vault. */
const PREFIX = "ohs_";

export interface IndexSettings {
	dailyNotePath: string;
	dailyNoteFormat: string;
}

/**
 * Daily-note frontmatter by date, read from Obsidian's metadata cache only (no file reads, no Garmin calls).
 * Built lazily on first use and rebuilt after `invalidate()`; one pass over the vault is a few milliseconds.
 */
export class DayIndex {
	private days = new Map<string, Record<string, unknown>>();
	private built = false;

	constructor(private readonly app: App, private readonly settings: () => IndexSettings) {}

	invalidate(): void {
		this.built = false;
	}

	/** The numeric value of a metric on a day, or null when the note, the key or a finite number is missing. */
	value(key: string, date: string): number | null {
		this.build();
		const fm = this.days.get(date);
		if (!fm) return null;
		for (const k of [key, PREFIX + key]) {
			const v = fm[k];
			if (typeof v === "number" && Number.isFinite(v)) return v;
		}
		return null;
	}

	private build(): void {
		if (this.built) return;
		this.built = true;
		this.days = new Map();
		const settings = this.settings();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const date = dateFromDailyNote(file, settings);
			const fm = date ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
			if (date && fm) this.days.set(date, fm);
		}
	}
}
