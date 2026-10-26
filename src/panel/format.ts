/** "Thu, 22 Oct" in the plugin language. Built at local noon so no time zone can move the day. */
export function formatPanelDate(date: string, lang: string): string {
	const [y, m, d] = date.split("-").map(Number) as [number, number, number];
	return new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "short" }).format(new Date(y, m - 1, d, 12));
}

/** A whole or one-decimal number in the plugin language ("62", "1,5" in German). */
export function formatNumber(value: number, lang: string): string {
	return new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(value);
}
