/** Minutes from the "6h 13min" strings the sync writes for sleep durations (also "6h", "45min"), or null. No lookbehind (iOS). */
export function parseDuration(value: unknown): number | null {
	if (typeof value !== "string") return null;
	const m = /^(?:(\d+)h)?\s*(?:(\d+)min)?$/.exec(value.trim());
	if (!m || (m[1] === undefined && m[2] === undefined)) return null;
	return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

/** Minutes since midnight from a "23:15" clock string, or null. */
export function parseClock(value: unknown): number | null {
	if (typeof value !== "string") return null;
	const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	return h < 24 && min < 60 ? h * 60 + min : null;
}
