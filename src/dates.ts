/** YYYY-MM-DD in the user's local time zone (toISOString would give the UTC date). */
export function localDateString(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
