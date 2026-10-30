/** YYYY-MM-DD in the user's local time zone (toISOString would give the UTC date). */
export function localDateString(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The local calendar day `days` away from a YYYY-MM-DD date (negative = earlier). Safe across DST changes. */
export function shiftDate(date: string, days: number): string {
	const [y, m, d] = date.split("-").map(Number) as [number, number, number];
	return localDateString(new Date(y, m - 1, d + days));
}

/** The Monday of the ISO week a YYYY-MM-DD date falls in. */
export function weekStart(date: string): string {
	const [y, m, d] = date.split("-").map(Number) as [number, number, number];
	const weekday = new Date(y, m - 1, d).getDay(); // 0 = Sunday
	return shiftDate(date, -((weekday + 6) % 7));
}

/** Whole days from `from` to `to` (YYYY-MM-DD), negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
	const utc = (d: string): number => {
		const [y, m, day] = d.split("-").map(Number) as [number, number, number];
		return Date.UTC(y, m - 1, day);
	};
	return Math.round((utc(to) - utc(from)) / 86_400_000);
}
