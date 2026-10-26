import type { App } from "obsidian";
import { dateFromDailyNote } from "../daily-note";
import { parseDuration } from "./parse";
import { parseSessions, type Session } from "./sessions";

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
		const v = this.raw(key, date);
		return typeof v === "number" && Number.isFinite(v) ? v : null;
	}

	/** A duration metric ("6h 13min") on a day in minutes, or null. */
	minutes(key: string, date: string): number | null {
		return parseDuration(this.raw(key, date));
	}

	/** Whether a daily note exists for the day (even one without data). */
	hasNote(date: string): boolean {
		this.build();
		return this.days.has(date);
	}

	/** The day's sessions; empty for a day without note or sessions. */
	sessions(date: string): Session[] {
		this.build();
		const fm = this.days.get(date);
		return fm ? parseSessions(fm) : [];
	}

	/** A text metric of the day, or null. */
	text(key: string, date: string): string | null {
		const v = this.raw(key, date);
		return typeof v === "string" && v.trim() !== "" ? v : null;
	}

	/** The place name of the day's first GPS workout, if the sync wrote one. */
	location(date: string): string | null {
		return this.text("workout_location", date);
	}

	/** The frontmatter value under the plain or the prefixed key. */
	private raw(key: string, date: string): unknown {
		this.build();
		const fm = this.days.get(date);
		return fm?.[key] ?? fm?.[PREFIX + key];
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
