// Builds a vault of daily notes whose frontmatter the metadata cache serves, for the side panel tests.
import { shiftDate } from "../src/dates";
import type { App } from "./mocks/obsidian";

export interface HistoryOptions {
	/** Last day of the history (YYYY-MM-DD). */
	end: string;
	days: number;
	/** Frontmatter of the note `ago` days before `end`; return null for a day without a note. */
	frontmatter: (ago: number) => Record<string, unknown> | null;
	/** Folder the notes live in, "" for the vault root. */
	folder?: string;
}

/** Creates one note per day (name YYYY-MM-DD) and registers its frontmatter. */
export async function seedHistory(app: App, options: HistoryOptions): Promise<void> {
	const folder = options.folder ?? "";
	if (folder) await app.vault.createFolder(folder);
	for (let ago = options.days - 1; ago >= 0; ago--) {
		const fm = options.frontmatter(ago);
		if (!fm) continue;
		const path = `${folder ? folder + "/" : ""}${shiftDate(options.end, -ago)}.md`;
		await app.vault.create(path, "---\n---\nbody");
		app.metadataCache.frontmatter.set(path, fm);
	}
}
