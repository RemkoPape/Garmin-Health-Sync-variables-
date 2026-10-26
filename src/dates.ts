/** YYYY-MM-DD in the user's local time zone (toISOString would give the UTC date). */
export function localDateString(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The local calendar day `days` away from a YYYY-MM-DD date (negative = earlier). Safe across DST changes. */
export function shiftDate(date: string, days: number): string {
	const [y, m, d] = date.split("-").map(Number) as [number, number, number];
	return localDateString(new Date(y, m - 1, d + days));
}
