import { normalizePath, type App, type TAbstractFile, type TFile, type TFolder } from "obsidian";
import { ensureFolderExists } from "../daily-note";
import { mergeRecord, parseMonth, sameRecord, serializeMonth, type DayRecord } from "./format";

export const HISTORY_FOLDER = "Garmin history";
const FILE_NAME = /^Garmin history (\d{4}-\d{2})(?!\d)/;

/** "2026-10" of a note name like "Garmin history 2026-10.md" (also of a sync conflict copy), or null. */
function monthOfName(name: string): string | null {
	return name.endsWith(".md") ? (FILE_NAME.exec(name)?.[1] ?? null) : null;
}

/** The months from the one of `from` to the one of `to`. */
function monthsBetween(from: string, to: string): string[] {
	const months: string[] = [];
	for (let month = from.slice(0, 7); month <= to.slice(0, 7); month = nextMonth(month)) months.push(month);
	return months;
}

function nextMonth(month: string): string {
	const [y, m] = month.split("-").map(Number) as [number, number];
	return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * The per-day history kept in the vault as one note per month ("Garmin history 2026-10.md", one JSON line per
 * day). Notes are plain markdown so every sync tool carries them. Reads fill an in-memory cache that the panel
 * then queries synchronously; writes are queued so two writers never race on one note.
 */
export class HistoryStore {
	/** Month to its days; a month without a note is cached as empty so it is not looked for again. */
	private cache = new Map<string, Map<string, DayRecord>>();
	private queue: Promise<unknown> = Promise.resolve();

	constructor(private readonly app: App, private readonly settings: { readonly dailyNotePath: string }) {}

	/** Whether a file or deleted file is a history note. */
	isHistoryFile(file: TAbstractFile): boolean {
		return monthOfName(file.name) !== null;
	}

	/** Forget what was read, all of it or the month of one changed note. */
	invalidate(file?: TAbstractFile): void {
		const month = file ? monthOfName(file.name) : null;
		if (month) this.cache.delete(month);
		else this.cache.clear();
	}

	/** Whether every month from `from` to `to` has been read. */
	covers(from: string, to: string): boolean {
		return monthsBetween(from, to).every((month) => this.cache.has(month));
	}

	/** Reads the months of a date range that are not cached yet; true when one of them has a note. */
	async warm(from: string, to: string): Promise<boolean> {
		let found = false;
		for (const month of monthsBetween(from, to)) {
			if (this.cache.has(month)) continue;
			const days = new Map<string, DayRecord>();
			for (const file of this.filesOf(month)) {
				found = true;
				for (const [date, record] of parseMonth(await this.app.vault.cachedRead(file))) days.set(date, mergeRecord(days.get(date), record));
			}
			this.cache.set(month, days);
		}
		return found;
	}

	/** The day's record from the cache, or null (also for a month that was not read). */
	get(date: string): DayRecord | null {
		return this.cache.get(date.slice(0, 7))?.get(date) ?? null;
	}

	has(date: string): boolean {
		return this.get(date) !== null;
	}

	/** Adds or merges one day. */
	async put(date: string, record: DayRecord): Promise<void> {
		await this.putMany(new Map([[date, record]]));
	}

	/** Adds or merges days, one write per month note. Safe to call while another write runs. */
	putMany(records: Map<string, DayRecord>): Promise<void> {
		const byMonth = new Map<string, Map<string, DayRecord>>();
		for (const [date, record] of records) {
			const month = date.slice(0, 7);
			if (!byMonth.has(month)) byMonth.set(month, new Map());
			byMonth.get(month)!.set(date, record);
		}
		const run = async (): Promise<void> => {
			await this.move();
			for (const [month, days] of byMonth) {
				await this.write(month, days);
				this.cache.delete(month);
			}
		};
		const result = this.queue.then(run);
		this.queue = result.catch(() => undefined);
		return result;
	}

	/** The notes of a month, the one in the history folder first. */
	private filesOf(month: string): TFile[] {
		const home = `${this.folder()}/`;
		const files = this.app.vault.getMarkdownFiles().filter((file) => monthOfName(file.name) === month);
		return files.sort((a, b) => Number(b.path.startsWith(home)) - Number(a.path.startsWith(home)) || a.path.length - b.path.length);
	}

	/**
	 * Brings history notes that lie anywhere else in the vault into the history folder of the daily notes folder, so a
	 * changed daily notes folder (a new year's subfolder, say) does not strand them: they are moved, never fetched again.
	 * A note whose place is taken stays where it is (it is merged when read). Returns how many were moved.
	 */
	relocate(): Promise<number> {
		const result = this.queue.then(() => this.move());
		this.queue = result.catch(() => undefined);
		return result;
	}

	private async move(): Promise<number> {
		const home = this.folder();
		const strays = this.app.vault.getMarkdownFiles().filter((file) => monthOfName(file.name) !== null && file.parent?.path !== home);
		if (strays.length === 0) return 0;
		await ensureFolderExists(this.app, home);
		const left = new Set<TAbstractFile>();
		let moved = 0;
		for (const file of strays) {
			const target = `${home}/${file.name}`;
			if (this.app.vault.getAbstractFileByPath(target)) continue; // that place is taken: both are read and merged
			left.add(file.parent!);
			await this.app.fileManager.renameFile(file, target);
			moved++;
		}
		if (moved === 0) return 0;
		this.cache.clear();
		// a folder the notes left empty goes too, but only one that was made for them
		for (const folder of left) {
			if (folder.name === HISTORY_FOLDER && (folder as TFolder).children.length === 0) await this.app.fileManager.trashFile(folder);
		}
		return moved;
	}

	private folder(): string {
		return normalizePath(`${this.settings.dailyNotePath}/${HISTORY_FOLDER}`);
	}

	private async write(month: string, incoming: Map<string, DayRecord>): Promise<void> {
		const [file] = this.filesOf(month);
		if (!file) {
			await ensureFolderExists(this.app, this.folder());
			await this.app.vault.create(`${this.folder()}/${HISTORY_FOLDER} ${month}.md`, serializeMonth(month, incoming));
			return;
		}
		await this.app.vault.process(file, (current) => {
			const days = parseMonth(current);
			let changed = false;
			for (const [date, record] of incoming) {
				const before = days.get(date);
				const merged = mergeRecord(before, record);
				if (before && sameRecord(before, merged)) continue;
				days.set(date, merged);
				changed = true;
			}
			return changed ? serializeMonth(month, days) : current;
		});
	}
}
