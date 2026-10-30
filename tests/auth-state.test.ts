// Why it matters: this state machine is the difference between "a single failed refresh permanently
// disables auto-sync" (the old bug) and a plugin that survives flaky networks. Only an auth failure
// pauses for good; everything else retries with a capped backoff that never stops.
import { describe, expect, it } from "vitest";
import { AuthStateMachine } from "../src/providers/garmin/auth-state";

const MIN = 60_000;

describe("AuthStateMachine", () => {
	it("starts unknown and willing to sync", () => {
		const m = new AuthStateMachine();
		expect(m.state).toBe("unknown");
		expect(m.shouldAttemptSync(0)).toBe(true);
		expect(m.nextRetryAt).toBe(0);
	});

	it("success makes it ready and clears the backoff", () => {
		const m = new AuthStateMachine();
		m.onTransientError(0);
		m.onSuccess();
		expect(m.state).toBe("ready");
		expect(m.nextRetryAt).toBe(0);
		expect(m.shouldAttemptSync(0)).toBe(true);
	});

	it("a transient error waits 1 minute, then doubles up to a 30 minute cap that never stops retrying", () => {
		const m = new AuthStateMachine();
		const waits: number[] = [];
		for (let i = 0; i < 9; i++) {
			m.onTransientError(1000);
			waits.push(m.nextRetryAt - 1000);
		}
		expect(waits).toEqual([1, 2, 4, 8, 16, 30, 30, 30, 30].map((x) => x * MIN));
		expect(m.state).toBe("temporarilyUnavailable");
	});

	it("only attempts a sync once the backoff has elapsed", () => {
		const m = new AuthStateMachine();
		m.onTransientError(10_000);
		expect(m.shouldAttemptSync(10_000 + MIN - 1)).toBe(false);
		expect(m.shouldAttemptSync(10_000 + MIN)).toBe(true);
	});

	it("an auth error pauses until the user logs in, and nothing else un-pauses it", () => {
		const m = new AuthStateMachine();
		m.onAuthError();
		expect(m.state).toBe("needsUserLogin");
		expect(m.shouldAttemptSync(Number.MAX_SAFE_INTEGER)).toBe(false);
		m.onTransientError(0);
		m.beginRefresh();
		expect(m.state).toBe("needsUserLogin");
	});

	it("a fresh login clears needsUserLogin", () => {
		const m = new AuthStateMachine();
		m.onAuthError();
		m.onLogin();
		expect(m.state).toBe("ready");
		expect(m.shouldAttemptSync(0)).toBe(true);
	});

	it("a refresh in progress blocks a second batch", () => {
		const m = new AuthStateMachine();
		m.beginRefresh();
		expect(m.state).toBe("refreshing");
		expect(m.shouldAttemptSync(0)).toBe(false);
		m.onSuccess();
		expect(m.shouldAttemptSync(0)).toBe(true);
	});

	it.each([401, 403])("classifies HTTP %i as an auth failure", (status) => {
		const m = new AuthStateMachine();
		m.onHttpError(status, 0);
		expect(m.state).toBe("needsUserLogin");
	});

	it.each([0, 429, 500, 503])("classifies HTTP %i as transient", (status) => {
		const m = new AuthStateMachine();
		m.onHttpError(status, 5000);
		expect(m.state).toBe("temporarilyUnavailable");
		expect(m.nextRetryAt).toBe(5000 + MIN);
	});

	it("uses the real clock when no time is passed", () => {
		const m = new AuthStateMachine();
		m.onTransientError();
		expect(m.nextRetryAt).toBeGreaterThan(Date.now());
		expect(m.shouldAttemptSync()).toBe(false);
		m.onHttpError(503);
		expect(m.state).toBe("temporarilyUnavailable");
	});

	it("reset forgets everything, including the backoff count", () => {
		const m = new AuthStateMachine();
		m.onTransientError(0);
		m.onTransientError(0);
		m.onAuthError();
		m.reset();
		expect(m.state).toBe("unknown");
		expect(m.nextRetryAt).toBe(0);
		m.onTransientError(0);
		expect(m.nextRetryAt).toBe(MIN);
	});
});
