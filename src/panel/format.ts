/** "Thu, 22 Oct" in the plugin language. Built at local noon so no time zone can move the day. */
export function formatPanelDate(date: string, lang: string): string {
	const [y, m, d] = date.split("-").map(Number) as [number, number, number];
	return new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "short" }).format(new Date(y, m - 1, d, 12));
}
