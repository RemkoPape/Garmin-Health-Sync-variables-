/** "Thu, 22 Oct" in the plugin language. Built at local noon so no time zone can move the day. */
export function formatPanelDate(date: string, lang: string): string {
	const [y, m, d] = date.split("-").map(Number) as [number, number, number];
	return new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "short" }).format(new Date(y, m - 1, d, 12));
}

/** A number in the plugin language with up to `digits` decimals ("62", "1,5" in German). */
export function formatNumber(value: number, lang: string, digits = 1): string {
	return new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(value);
}

/** One-letter weekday ("M", "T") of a YYYY-MM-DD date in the plugin language. */
export function weekdayInitial(date: string, lang: string): string {
	const [y, m, d] = date.split("-").map(Number) as [number, number, number];
	return new Intl.DateTimeFormat(lang, { weekday: "narrow" }).format(new Date(y, m - 1, d, 12));
}
