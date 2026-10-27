import { ACTIVITY_KEYS } from "../activity-keys";
import type { HealthSyncSettings } from "../settings";
import { PANEL_CARDS } from "./cards";

/** What a note holds in imperial units instead of the metric key a card names. */
const IMPERIAL_ALIASES: Record<string, string> = { distance_km: "distance_mi", weight_kg: "weight_lbs" };
/** Cards that draw from the sessions of the day: the activities, the training list and the workout place. */
const SESSION_CARDS = new Set(["sessions", "weekly", "load"]);
const SESSION_KEYS = ["trainings", "workout_location"];

/** The property keys (without prefix) of a daily note that the side panel shows, so they can be hidden from the properties block. Empty while the panel is off. */
export function visualisedKeys(settings: Pick<HealthSyncSettings, "panelEnabled" | "panelCards">): Set<string> {
	const keys = new Set<string>();
	if (!settings.panelEnabled) return keys;
	for (const card of PANEL_CARDS) {
		if (settings.panelCards[card.id] === false) continue;
		for (const key of [...card.metrics, ...(card.extra ?? [])]) {
			keys.add(key);
			const alias = IMPERIAL_ALIASES[key];
			if (alias) keys.add(alias);
		}
		if (SESSION_CARDS.has(card.id)) for (const key of [...ACTIVITY_KEYS, ...SESSION_KEYS]) keys.add(key);
	}
	return keys;
}
