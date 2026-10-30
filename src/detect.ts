import type { App } from "obsidian";
import { dateFromDailyNote } from "./daily-note";
import { METRICS } from "./metrics";
import { LIFESTYLE_PREFIX } from "./providers/garmin/lifestyle";
import type { HealthSyncSettings } from "./settings";

const PREFIX = "ohs_";
/** The keys a note in imperial units holds, and the metric each stands for. */
const IMPERIAL_KEYS: Record<string, string> = { distance_mi: "distance_km", weight_lbs: "weight_kg" };
const METRIC_KEYS = new Set(METRICS.map((m) => m.key));
/** A daily note with at least this many Garmin properties is a note the sync wrote: a single `steps` in a note of something else is not. */
const MIN_KEYS_PER_NOTE = 3;

/** What the daily notes of a vault say about how the sync was set up on the device that wrote them. */
export interface Detection {
	/** Daily notes that hold Garmin data. */
	notes: number;
	/** The metrics found in them (`distance_km` also for a note in miles). */
	metrics: string[];
	/** Every Garmin property carries the `ohs_` prefix. */
	prefix: boolean;
	/** The notes hold miles and pounds, not kilometres and kilograms. */
	imperial: boolean;
	/** The notes hold habits of the lifestyle log. */
	lifestyle: boolean;
}

/** A property that holds a value: a blank property of a template is not data. */
const filled = (value: unknown): boolean => (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.trim() !== "");

/**
 * Looks through the properties of the daily notes (Obsidian's metadata cache, no file is read) for Garmin data, so a
 * device that has the notes but not the plugin's settings (a second computer, a vault that came by Obsidian Sync) can
 * set itself up like the device that wrote them. Null when no daily note has enough Garmin properties.
 */
export function detectGarminData(app: App, settings: Pick<HealthSyncSettings, "dailyNotePath" | "dailyNoteFormat">): Detection | null {
	const metrics = new Set<string>();
	let notes = 0;
	let prefixed = 0;
	let plain = 0;
	let miles = false;
	let kilometres = false;
	let lifestyle = false;
	for (const file of app.vault.getMarkdownFiles()) {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm || dateFromDailyNote(file, settings) === null) continue;
		const found: string[] = [];
		let notePrefixed = 0;
		let notePlain = 0;
		let noteLifestyle = false;
		for (const [raw, value] of Object.entries(fm)) {
			if (!filled(value)) continue;
			const withPrefix = raw.startsWith(PREFIX);
			const key = withPrefix ? raw.slice(PREFIX.length) : raw;
			if (key.startsWith(LIFESTYLE_PREFIX)) {
				if (typeof value === "number") noteLifestyle = true;
				continue;
			}
			if (!METRIC_KEYS.has(key) && !(key in IMPERIAL_KEYS)) continue;
			found.push(key);
			if (withPrefix) notePrefixed++;
			else notePlain++;
		}
		if (found.length < MIN_KEYS_PER_NOTE) continue;
		notes++;
		prefixed += notePrefixed;
		plain += notePlain;
		if (noteLifestyle) lifestyle = true;
		for (const key of found) {
			if (key in IMPERIAL_KEYS) {
				miles = true;
				metrics.add(IMPERIAL_KEYS[key]!);
			} else {
				if (key === "distance_km" || key === "weight_kg") kilometres = true;
				metrics.add(key);
			}
		}
	}
	if (notes === 0) return null;
	return { notes, metrics: [...metrics].sort(), prefix: prefixed > 0 && plain === 0, imperial: miles && !kilometres, lifestyle };
}

/** Sets a fresh install up like the notes say: the metrics found are switched on (none is switched off), the prefix and the unit system follow the notes, the habits of the lifestyle log are read, and the side panel is on. */
export function applyDetection(settings: HealthSyncSettings, found: Detection): void {
	for (const key of found.metrics) settings.enabledMetrics[key] = true;
	if (found.lifestyle) settings.enabledMetrics["lifestyle_log"] = true;
	if (found.prefix) settings.usePrefix = true;
	if (found.imperial) settings.unitSystem = "imperial";
	settings.panelEnabled = true;
}
