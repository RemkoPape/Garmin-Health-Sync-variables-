// Why it matters: a request that never answers (a phone that suspended the app) must not hold a sync, a
// token refresh or a note write forever, and the timer must not outlive the request.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "../src/timeout";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("withTimeout", () => {
	it("passes the answer through and leaves no timer behind", async () => {
		await expect(withTimeout(Promise.resolve(7), 1000, "late")).resolves.toBe(7);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("passes an error through", async () => {
		await expect(withTimeout(Promise.reject(new Error("boom")), 1000, "late")).rejects.toThrow("boom");
		expect(vi.getTimerCount()).toBe(0);
	});

	it("rejects with the message when nothing came in time", async () => {
		const result = withTimeout(new Promise<number>(() => undefined), 1000, "late").catch((e: Error) => e.message);
		await vi.advanceTimersByTimeAsync(999);
		expect(vi.getTimerCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(await result).toBe("late");
	});
});
