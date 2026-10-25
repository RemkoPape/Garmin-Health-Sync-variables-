// Why it matters: Garmin rate-limits sign-in; hammering it makes the block longer. The cooldown must
// escalate, forget old strikes, honour Retry-After within a cap, and survive a bad clock or storage.
import { describe, expect, it } from "vitest";
import { App } from "../testUtils/mocks/obsidian";
import { LoginCooldown, backoffSeconds, formatCountdown } from "../src/login-cooldown";

const KEY = "garmin-health-sync-login-cooldown";
const HOUR = 3600_000;

function setup(start = 1_000_000) {
	const app = new App();
	let now = start;
	const cooldown = new LoginCooldown(app as never, () => now);
	return { app, cooldown, advance: (ms: number) => (now += ms), setNow: (v: number) => (now = v) };
}

describe("backoffSeconds", () => {
	it("escalates 5, 15, 30, 60 minutes and stays at 60", () => {
		expect([1, 2, 3, 4, 5, 20].map(backoffSeconds)).toEqual([300, 900, 1800, 3600, 3600, 3600]);
	});
	it("treats zero or negative strikes as the first", () => {
		expect(backoffSeconds(0)).toBe(300);
		expect(backoffSeconds(-3)).toBe(300);
	});
});

describe("formatCountdown", () => {
	it("formats m:ss, rounding up and never going negative", () => {
		expect(formatCountdown(0)).toBe("0:00");
		expect(formatCountdown(59.2)).toBe("1:00");
		expect(formatCountdown(61)).toBe("1:01");
		expect(formatCountdown(3600)).toBe("60:00");
		expect(formatCountdown(-5)).toBe("0:00");
	});
});

describe("LoginCooldown", () => {
	it("has no wait before any block", () => {
		const { cooldown } = setup();
		expect(cooldown.remainingSeconds()).toBe(0);
		expect(cooldown.strikes()).toBe(0);
	});

	it("starts a 5 minute wait on the first block and counts down", () => {
		const { cooldown, advance } = setup();
		expect(cooldown.registerBlock()).toBe(300);
		expect(cooldown.remainingSeconds()).toBe(300);
		advance(100_000);
		expect(cooldown.remainingSeconds()).toBe(200);
		advance(250_000);
		expect(cooldown.remainingSeconds()).toBe(0);
	});

	it("escalates on consecutive blocks", () => {
		const { cooldown, advance } = setup();
		const waits = [1, 2, 3, 4, 5].map(() => {
			const w = cooldown.registerBlock();
			advance(1000);
			return w;
		});
		expect(waits).toEqual([300, 900, 1800, 3600, 3600]);
		expect(cooldown.strikes()).toBe(5);
	});

	it("forgets strikes after two hours", () => {
		const { cooldown, advance } = setup();
		cooldown.registerBlock();
		cooldown.registerBlock();
		advance(2 * HOUR + 1);
		expect(cooldown.registerBlock()).toBe(300);
		expect(cooldown.strikes()).toBe(1);
	});

	it("keeps strikes just inside the two hour window", () => {
		const { cooldown, advance } = setup();
		cooldown.registerBlock();
		advance(2 * HOUR);
		expect(cooldown.registerBlock()).toBe(900);
	});

	it("uses Retry-After when it asks for more than the estimate, capped at one hour", () => {
		const { cooldown } = setup();
		expect(cooldown.registerBlock(1200)).toBe(1200);
		expect(cooldown.registerBlock(99_999)).toBe(3600);
	});

	it("ignores a Retry-After that is smaller than the estimate, zero, or negative", () => {
		const { cooldown } = setup();
		expect(cooldown.registerBlock(10)).toBe(300);
		expect(cooldown.registerBlock(0)).toBe(900);
		expect(cooldown.registerBlock(-5)).toBe(1800);
	});

	it("never reports more than an hour even if the clock moved backwards", () => {
		const { cooldown, setNow } = setup(10 * HOUR);
		cooldown.registerBlock(3600);
		setNow(0);
		expect(cooldown.remainingSeconds()).toBe(3600);
	});

	it("reset forgets the wait and the strikes", () => {
		const { cooldown } = setup();
		cooldown.registerBlock();
		cooldown.reset();
		expect(cooldown.remainingSeconds()).toBe(0);
		expect(cooldown.strikes()).toBe(0);
	});

	it("noteAttempt reports seconds since the previous attempt, and keeps the block state", () => {
		const { cooldown, advance } = setup();
		expect(cooldown.noteAttempt()).toBeNull();
		advance(42_400);
		expect(cooldown.noteAttempt()).toBe(42);
		cooldown.registerBlock();
		advance(1000);
		expect(cooldown.noteAttempt()).toBe(1);
		expect(cooldown.strikes()).toBe(1);
	});

	it("shares state through the app's local storage (survives a new instance)", () => {
		const { app, cooldown } = setup();
		cooldown.registerBlock();
		const again = new LoginCooldown(app as never, () => 1_000_000);
		expect(again.strikes()).toBe(1);
		expect(again.remainingSeconds()).toBe(300);
	});

	it("treats corrupt stored values as no cooldown", () => {
		const { app, cooldown } = setup();
		app.local.set(KEY, { until: "garbage", strikes: null, lastAttemptAt: {}, lastStrikeAt: undefined });
		expect(cooldown.remainingSeconds()).toBe(0);
		expect(cooldown.strikes()).toBe(0);
		app.local.set(KEY, "not an object");
		expect(cooldown.strikes()).toBe(0);
	});

	it("works when storage throws on read or write", () => {
		const { app, cooldown } = setup();
		app.loadLocalStorage = () => {
			throw new Error("storage unavailable");
		};
		app.saveLocalStorage = () => {
			throw new Error("storage unavailable");
		};
		expect(cooldown.remainingSeconds()).toBe(0);
		expect(() => cooldown.registerBlock()).not.toThrow();
		expect(() => cooldown.reset()).not.toThrow();
		expect(() => cooldown.noteAttempt()).not.toThrow();
	});

	it("uses the real clock by default", () => {
		const app = new App();
		const c = new LoginCooldown(app as never);
		c.registerBlock();
		expect(c.remainingSeconds()).toBeGreaterThan(290);
	});
});
