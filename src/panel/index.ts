import type { App } from "obsidian";
import { dateFromDailyNote } from "../daily-note";
import { parseClock, parseDuration } from "./parse";
import type { HistoryStore } from "../history/store";
import { parseSessions, type Session } from "./sessions";

/** Frontmatter prefix the sync adds when "use prefix" is on. Notes of both kinds can sit in one vault. */
const PREFIX = "ohs_";

export interface IndexSettings {
	dailyNotePath: string;
	dailyNoteFormat: string;
}

/**
 * Daily-note frontmatter by date, read from Obsidian's metadata cache only (no Garmin calls), with the history
 * notes as a second source for a day without a note or a value the note lacks (the note wins per value).
 * Built lazily on first use and rebuilt after `invalidate()`; one pass over the vault is a few milliseconds.
 */
export class DayIndex {
	private days = new Map<string, Record<string, unknown>>();
	private built = false;

	constructor(private readonly app: App, private readonly settings: () => IndexSettings, private readonly history: HistoryStore | null = null) {}

	/** Changes with every invalidation or touch: what was worked out from the index is out of date when it differs. */
	private revision = 0;
	private sessionCache = new Map<string, Session[]>();

	get version(): number {
		return this.revision;
	}

	invalidate(): void {
		this.built = false;
		this.touch();
	}

	/** The history that the index reads from changed, the notes did not. */
	touch(): void {
		this.revision++;
		this.sessionCache.clear();
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

	/** Whether the day has a note or a history record. */
	hasDay(date: string): boolean {
		return this.hasNote(date) || (this.history?.has(date) ?? false);
	}

	/** The day's sessions; empty for a day without sessions. A note's own entries win over the history's. */
	sessions(date: string): Session[] {
		this.build();
		let sessions = this.sessionCache.get(date);
		if (!sessions) {
			sessions = parseSessions({ ...this.history?.get(date), ...this.days.get(date) });
			this.sessionCache.set(date, sessions);
		}
		return sessions;
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

	/** A clock time ("23:15") on a day in minutes since midnight, or null. */
	clock(key: string, date: string): number | null {
		return parseClock(this.raw(key, date));
	}

	/** The frontmatter value under the plain or the prefixed key. */
	private raw(key: string, date: string): unknown {
		this.build();
		const fm = this.days.get(date);
		// an empty property in the note (a template left it blank) is no value: the history record may have it
		const own = fm?.[key] ?? fm?.[PREFIX + key];
		return own === undefined || own === null || own === "" ? this.history?.get(date)?.[key] : own;
	}

	private build(): void {
		if (this.built) return;
		this.built = true;
		this.days = new Map();
		const settings = this.settings();
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (this.history?.isHistoryFile(file)) continue;
			const date = dateFromDailyNote(file, settings);
			const fm = date ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
			if (date && fm) this.days.set(date, fm);
		}
	}
}
