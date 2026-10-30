import type { App } from "obsidian";
import { dateFromDailyNote } from "../daily-note";
import type { DayRecord } from "./format";
import { recordFromNote } from "./record";
import type { HistoryStore } from "./store";

/** Copies the Garmin values of every daily note into the history (no Garmin requests). Returns how many days were copied. */
export async function importFromNotes(app: App, store: HistoryStore, settings: { dailyNotePath: string; dailyNoteFormat: string }): Promise<number> {
	const records = new Map<string, DayRecord>();
	for (const file of app.vault.getMarkdownFiles()) {
		if (store.isHistoryFile(file)) continue;
		const date = dateFromDailyNote(file, settings);
		const frontmatter = date ? app.metadataCache.getFileCache(file)?.frontmatter : undefined;
		const record = frontmatter ? recordFromNote(frontmatter) : null;
		if (date && record) records.set(date, record);
	}
	if (records.size > 0) await store.putMany(records);
	return records.size;
}
