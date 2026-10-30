/** Rejects with `message` when `promise` has not settled after `ms`. The request itself cannot be cancelled, but its caller no longer waits for it (a request that never answers, e.g. after the phone suspended the app). */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	let timer = 0;
	const expired = new Promise<never>((_, reject) => {
		timer = window.setTimeout(() => reject(new Error(message)), ms);
	});
	return Promise.race([promise, expired]).finally(() => window.clearTimeout(timer));
}
