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

/** A signed change ("+0.7", "−3") that never shows a minus sign in front of a value that rounds to zero. */
export function formatSigned(value: number, lang: string, digits = 1): string {
	const abs = formatNumber(Math.abs(value), lang, digits);
	return `${value < 0 && Number(abs.replace(/\D/g, "")) !== 0 ? "−" : "+"}${abs}`;
}

/** "Friday" of a YYYY-MM-DD date in the plugin language. */
export function weekdayName(date: string, lang: string): string {
	const [y, m, d] = date.split("-").map(Number) as [number, number, number];
	return new Intl.DateTimeFormat(lang, { weekday: "long" }).format(new Date(y, m - 1, d, 12));
}
