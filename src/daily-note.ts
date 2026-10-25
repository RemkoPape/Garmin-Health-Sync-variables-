import { App, Notice, TFile, TFolder, moment, normalizePath, parseYaml, stringifyYaml } from "obsidian";

/**
 * Obsidian re-exports moment, but its type declarations resolve through the
 * external moment package, which the directory review bot's lint environment
 * does not install — every call becomes error-typed there. Type the tiny
 * surface this module uses locally so the checks hold in any environment.
 */
type MomentFn = (input?: string, format?: string, strict?: boolean) => { format(format: string): string; isValid(): boolean };
const momentFn = moment as unknown as MomentFn;
import type { HealthData } from "./providers/provider";
import { applyPrefix } from "./metrics";
import { reverseGeocode } from "./geocoding";
import { t } from "./i18n/t";

/**
 * Searches for a daily note recursively in the given directory and all subdirectories.
 * Returns the TFile if found, null otherwise.
 */
function findDailyNoteRecursive(app: App, fileName: string, basePath: string): TFile | null {
	// 1. Check directly in root directory (fast path)
	const directPath = normalizePath(`${basePath}/${fileName}.md`);
	const directFile = app.vault.getAbstractFileByPath(directPath);
	if (directFile instanceof TFile) return directFile;

	// A format containing "/" (e.g. "YYYY/YYYY-MM-DD") pins the note to an exact
	// subfolder — the recursive search below matches on file name only and could
	// never find it, so skip the pointless vault walk.
	if (fileName.includes("/")) return null;

	// 2. Search recursively in subdirectories
	const baseFolder = app.vault.getAbstractFileByPath(normalizePath(basePath));
	if (!(baseFolder instanceof TFolder)) return null;

	return findInFolder(baseFolder, `${fileName}.md`);
}

function findInFolder(folder: TFolder, targetName: string): TFile | null {
	for (const child of folder.children) {
		if (child instanceof TFile && child.name === targetName) {
			return child;
		}
		if (child instanceof TFolder) {
			const found = findInFolder(child, targetName);
			if (found) return found;
		}
	}
	return null;
}

/**
 * Returns true if a *real* daily note for the given date exists in the vault
 * (searched recursively under the daily-note path). Pure local lookup — no
 * network. Used to gate syncing before any API call when automatic note
 * creation is disabled, so a missing note costs zero requests.
 *
 * A 0-byte file is deliberately treated as "not yet a real note": clicking a
 * day in the Calendar plugin creates an empty placeholder, and writing health
 * data into that stub is exactly what the wait-for-note mode is meant to avoid.
 * Such a placeholder keeps the date in the waiting state until it has content.
 */
export function dailyNoteExists(
	app: App,
	date: string,
	options: { dailyNotePath: string; dailyNoteFormat: string }
): boolean {
	const fileName = formatDate(date, options.dailyNoteFormat);
	const file = findDailyNoteRecursive(app, fileName, options.dailyNotePath);
	return file !== null && file.stat.size > 0;
}

/**
 * Given a freshly observed file, returns which of `candidateDates` it is the
 * daily note for, or null. Resolves the expected file name via the SAME
 * formatDate() the existence gate uses, so trigger and gate agree on what counts
 * as a daily note — including formats with extra moment tokens (ddd, MMM, …) or
 * subfolders, which the basename-regex in main.ts cannot handle.
 *
 * This runs on every vault create/modify event, so it only ever compares paths:
 * it mirrors the two lookup steps of findDailyNoteRecursive() (exact target path,
 * then same file name anywhere below the folder) without walking the vault.
 *
 * Empty (0-byte) placeholders return null, mirroring dailyNoteExists(): an empty
 * stub must not trigger a catch-up sync.
 */
export function matchDailyNoteDate(
	file: TFile,
	candidateDates: string[],
	options: { dailyNotePath: string; dailyNoteFormat: string }
): string | null {
	if (file.stat.size === 0) return null;

	// Cheap rejection first: anything outside the daily-note folder can never match.
	const basePath = options.dailyNotePath.replace(/^\/+|\/+$/g, "");
	if (basePath && !file.path.startsWith(basePath + "/")) return null;

	for (const date of candidateDates) {
		const fileName = formatDate(date, options.dailyNoteFormat);
		if (file.path === normalizePath(`${options.dailyNotePath}/${fileName}.md`)) return date;
		// A format with "/" pins the note to an exact subfolder — no name-only match.
		if (!fileName.includes("/") && file.name === `${fileName}.md`) return date;
	}
	return null;
}

/** Creates a folder including all parent directories */
async function ensureFolderExists(app: App, folderPath: string): Promise<void> {
	const normalized = normalizePath(folderPath);
	if (app.vault.getAbstractFileByPath(normalized)) return;
	const parts = normalized.split("/");
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) {
			await app.vault.createFolder(current);
		}
	}
}

/**
 * Writes health data as frontmatter properties into a daily note.
 * Creates the daily note if it does not exist and `createIfMissing` is set;
 * otherwise the write is skipped (returns false) and the note is left alone.
 * Returns true if the file was actually modified, false if all target values
 * already matched the existing frontmatter (dirty check — avoids redundant
 * writes that would trigger sync engines like LiveSync) or the note was absent
 * and creation was disabled.
 */
export async function writeToDailyNote(
	app: App,
	date: string,
	data: HealthData,
	options: {
		dailyNotePath: string;
		dailyNoteFormat: string;
		prefix: string;
		template: string;
		writeTrainings: boolean;
		writeWorkoutLocation: boolean;
		createIfMissing: boolean;
		language: string;
	}
): Promise<boolean> {
	const fileName = formatDate(date, options.dailyNoteFormat);

	// Search for existing daily note recursively
	let file: TFile | null = findDailyNoteRecursive(app, fileName, options.dailyNotePath);

	if (!file) {
		// Safety net: the caller normally gates on dailyNoteExists() before
		// fetching, so this only triggers if the note vanished mid-sync. Honour
		// the setting and skip creation rather than re-creating an unwanted note.
		if (!options.createIfMissing) {
			console.debug("Garmin Health Sync: daily note missing and creation disabled, skipping write for", fileName);
			return false;
		}
		// Create new daily note (optionally with subdirectories from the format)
		const filePath = normalizePath(`${options.dailyNotePath}/${fileName}.md`);
		const fileDir = filePath.substring(0, filePath.lastIndexOf("/"));
		if (fileDir) {
			await ensureFolderExists(app, fileDir);
		}
		const initialContent = options.template || "";
		file = await app.vault.create(filePath, initialContent);
	}

	// Build properties map
	const properties: Record<string, number | string | Record<string, unknown>[]> = {};

	for (const [key, value] of Object.entries(data.metrics)) {
		properties[applyPrefix(key, options.prefix)] = value;
	}

	for (const [key, value] of Object.entries(data.activities)) {
		properties[applyPrefix(key, options.prefix)] = value;
	}

	// Machine-readable training data (optional)
	if (options.writeTrainings && data.trainings && data.trainings.length > 0) {
		properties[applyPrefix("trainings", options.prefix)] = data.trainings as unknown as Record<string, unknown>[];
	}

	// Workout Location via Reverse Geocoding (optional)
	if (options.writeWorkoutLocation && data.startLocation) {
		const locationName = await reverseGeocode(data.startLocation.lat, data.startLocation.lon);
		if (locationName) {
			properties[applyPrefix("workout_location", options.prefix)] = locationName;
		}
	}

	// Write to frontmatter (returns false if nothing would change)
	return updateFrontmatter(app, file, properties, options.language);
}

/**
 * Updates or adds frontmatter properties in a file.
 *
 * Reads the file directly, parses the frontmatter block strictly via parseYaml,
 * merges new values, re-serializes via stringifyYaml, writes via vault.modify.
 *
 * This replaces app.fileManager.processFrontMatter, which has shown two
 * data-corrupting failure modes against real notes:
 *   1. Files with `---` somewhere in the body (Markdown horizontal rules)
 *      were misinterpreted as having frontmatter spanning into the body.
 *   2. YAML maps that ended with a block sequence (e.g. `book_titles:\n- '[[..]]'`)
 *      received new keys *before* the sequence, breaking the file.
 *
 * Returns true if the file was modified, false if all incoming values already
 * matched what was already in the frontmatter (dirty-check).
 */
async function updateFrontmatter(
	app: App,
	file: TFile,
	properties: Record<string, number | string | Record<string, unknown>[]>,
	language: string
): Promise<boolean> {
	const content = await app.vault.read(file);
	const parsed = extractFrontmatter(content);

	if (parsed.kind === "invalid") {
		// Don't overwrite a damaged file — back it up and bail with a notice.
		await backupFile(app, file, content, parsed.reason);
		const msg = t("noticeFrontmatterBroken", language).replace("{path}", file.path).replace("{reason}", parsed.reason);
		console.warn(msg);
		new Notice(msg, 15000);
		return false;
	}

	const existing = parsed.kind === "present" ? parsed.data : {};

	// Dirty-check: skip the write when every incoming key is already present
	// with the same value. Avoids flipping the file's mtime and firing LiveSync
	// when nothing changed.
	let changed = false;
	for (const [key, value] of Object.entries(properties)) {
		if (!isDeepEqual(existing[key], value)) {
			changed = true;
			break;
		}
	}
	if (!changed) {
		console.debug("Garmin Health Sync: frontmatter unchanged, skipping write for", file.path);
		return false;
	}

	const merged = { ...existing };
	for (const [key, value] of Object.entries(properties)) {
		merged[key] = value;
	}

	const newContent = renderWithFrontmatter(merged, parsed);
	await app.vault.modify(file, newContent);
	return true;
}

type FrontmatterParse =
	| { kind: "absent"; body: string; lineEnding: string; bom: string }
	| {
			kind: "present";
			data: Record<string, unknown>;
			body: string;
			lineEnding: string;
			rawHeader: string;
			bom: string;
	  }
	| { kind: "invalid"; reason: string };

/**
 * Extracts the frontmatter block strictly: the file must start with `---`
 * on its own line. The block ends at the next `---` line. Anything between
 * is parsed via parseYaml and must yield a plain object.
 */
function extractFrontmatter(rawContent: string): FrontmatterParse {
	// A UTF-8 byte order mark may precede the opening `---`. Set it aside and put it back first when writing,
	// otherwise the block is not recognised and a second one would be added above the mark.
	const bom = rawContent.startsWith("\uFEFF") ? "\uFEFF" : "";
	const content = bom ? rawContent.slice(1) : rawContent;
	const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";

	// File doesn't open with `---\n` → no frontmatter.
	if (!/^---\r?\n/.test(content)) {
		return { kind: "absent", body: content, lineEnding, bom };
	}

	const lines = content.split(/\r?\n/);
	// Find the closing `---` (start at line 1, line 0 is the opener).
	let closingIdx = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i] === "---") {
			closingIdx = i;
			break;
		}
	}
	if (closingIdx === -1) {
		return { kind: "invalid", reason: "no closing --- marker found" };
	}

	const yamlText = lines.slice(1, closingIdx).join(lineEnding);
	let data: unknown;
	try {
		data = parseYaml(yamlText);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return { kind: "invalid", reason: `YAML parse error: ${msg}` };
	}

	// Empty frontmatter (`---\n---`) → parseYaml returns null. Treat as empty object.
	if (data === null || data === undefined) {
		const body = lines.slice(closingIdx + 1).join(lineEnding);
		return {
			kind: "present",
			data: {},
			body,
			lineEnding,
			rawHeader: "",
			bom,
		};
	}

	if (typeof data !== "object" || Array.isArray(data)) {
		return { kind: "invalid", reason: "Frontmatter is not a YAML object (e.g. list or scalar)" };
	}

	const body = lines.slice(closingIdx + 1).join(lineEnding);
	return {
		kind: "present",
		data: data as Record<string, unknown>,
		body,
		lineEnding,
		rawHeader: yamlText,
		bom,
	};
}

/** Re-assembles the file content with the merged frontmatter. */
function renderWithFrontmatter(
	merged: Record<string, unknown>,
	parsed: Exclude<FrontmatterParse, { kind: "invalid" }>
): string {
	const lineEnding = parsed.lineEnding;
	let yaml = stringifyYaml(merged);
	// stringifyYaml ends with a newline already; trim trailing newlines so we control the joining exactly.
	yaml = yaml.replace(/\r?\n+$/, "");
	const yamlBlock = `${parsed.bom}---${lineEnding}${yaml.replace(/\n/g, lineEnding)}${lineEnding}---`;

	if (parsed.kind === "absent") {
		// Insert frontmatter at the top. Empty file → just the FM.
		if (parsed.body.length === 0) return `${yamlBlock}${lineEnding}`;
		return `${yamlBlock}${lineEnding}${parsed.body}`;
	}

	// Present: yaml block + original body (body was sliced AFTER the closing ---,
	// so it already starts at the right line; rejoin with one line ending).
	return `${yamlBlock}${lineEnding}${parsed.body}`;
}

/**
 * Writes a timestamped backup of the file content into _garmin-health-sync/backups/.
 * Best-effort — failures are logged but not propagated.
 */
async function backupFile(app: App, file: TFile, content: string, reason: string): Promise<void> {
	try {
		const backupDir = "_garmin-health-sync/backups";
		await ensureFolderExists(app, backupDir);
		const ts = momentFn().format("YYYY-MM-DDTHH-mm-ss");
		const safeName = file.name.replace(/\.md$/, "");
		const backupPath = normalizePath(`${backupDir}/${safeName}.${ts}.md`);
		const header = `<!-- Garmin Health Sync Backup\nReason: ${reason}\nOriginal: ${file.path}\nTimestamp: ${ts}\n-->\n`;
		await app.vault.create(backupPath, header + content);
		console.warn("Garmin Health Sync: backup written to", backupPath);
	} catch (e) {
		console.error("Garmin Health Sync: backup failed for", file.path, e);
	}
}

function isDeepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;
	if (typeof a !== typeof b) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!isDeepEqual(a[i], b[i])) return false;
		}
		return true;
	}
	if (typeof a === "object" && typeof b === "object") {
		const aObj = a as Record<string, unknown>;
		const bObj = b as Record<string, unknown>;
		const aKeys = Object.keys(aObj);
		const bKeys = Object.keys(bObj);
		if (aKeys.length !== bKeys.length) return false;
		for (const key of aKeys) {
			if (!isDeepEqual(aObj[key], bObj[key])) return false;
		}
		return true;
	}
	return false;
}

/**
 * The reverse of formatDate(): the YYYY-MM-DD date a note name was formatted from, or null.
 *
 * Understands every moment token (weekday and month names included, in the app's language), which a hand-written
 * pattern cannot. The strict parse alone is not trusted: the result must format back to exactly the same name,
 * so a name that merely resembles the format (wrong weekday, wrong language, extra text) is rejected.
 */
export function dateFromFormattedName(name: string, format: string): string | null {
	const parsed = momentFn(name, format, true);
	if (!parsed.isValid() || parsed.format(format) !== name) return null;
	return parsed.format("YYYY-MM-DD");
}

/**
 * Formats a date string using moment.js — the same library Obsidian's
 * core Daily Notes plugin uses. Supports all moment tokens (YYYY, MM, DD,
 * ddd, MMM, Wo, etc.).
 */
function formatDate(dateStr: string, format: string): string {
	return momentFn(dateStr, "YYYY-MM-DD").format(format);
}
