/** What the backfill remembers about the days it has fetched, so a second run does not fetch them again. */
export interface FetchLog {
	/** Day to the index in `fetchSets` of the metrics that were requested for it. */
	fetchLog: Record<string, number>;
	/** The distinct sets of requested metrics (a handful: a new one appears when the user changes the enabled metrics). */
	fetchSets: string[][];
}

/** Whether the day was fetched with every metric that is wanted now. */
export function isFetched(log: FetchLog, date: string, wanted: string[]): boolean {
	const index = log.fetchLog[date];
	const have = index === undefined ? undefined : log.fetchSets[index];
	return have !== undefined && wanted.every((metric) => have.includes(metric));
}

/** Records that the day was fetched with these metrics, on top of what was recorded before. */
export function markFetched(log: FetchLog, date: string, requested: string[]): void {
	const before = log.fetchLog[date];
	const joined = [...new Set([...(before === undefined ? [] : (log.fetchSets[before] ?? [])), ...requested])].sort();
	let index = log.fetchSets.findIndex((set) => set.length === joined.length && set.every((metric, i) => metric === joined[i]));
	if (index === -1) index = log.fetchSets.push(joined) - 1;
	log.fetchLog[date] = index;
}
