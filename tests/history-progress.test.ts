// Why it matters: a build can run for hours, so the notice is the user's only window into it. It has to show
// where the run is, how long it will take, a way to stop it, and how it ended, in the user's language.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notice } from "../testUtils/mocks/obsidian";
import { BuildProgressUi, formatDuration } from "../src/history/progress";
import type { BuildProgress, BuildResult } from "../src/history/backfill";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";

const progress = (patch: Partial<BuildProgress> = {}): BuildProgress => ({ state: "running", date: "2026-10-24", done: 40, total: 400, fetched: 30, skipped: 10, failed: 0, etaMs: 3_900_000, pauseMs: 0, ...patch });
const result = (patch: Partial<BuildResult> = {}): BuildResult => ({ status: "done", fetched: 380, skipped: 20, failed: 0, date: "2025-01-01", reachedStart: false, ...patch });
const messages = (): string[] => Notice.recorded.map((n) => n.message);
/** What the progress notice shows now: it is changed after it was created, so read its content, not the first message. */
const shown = (): string => Notice.recorded[0]!.fragment!.textContent ?? "";

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(2026, 9, 25, 12));
});

describe("formatDuration", () => {
	it("uses plain units, rounds up and never says zero", () => {
		expect(formatDuration(1)).toBe("1 min");
		expect(formatDuration(12 * 60_000)).toBe("12 min");
		expect(formatDuration(65 * 60_000 - 1)).toBe("1 h 05 min");
		expect(formatDuration(120 * 60_000)).toBe("2 h 00 min");
	});
});

describe("the progress notice", () => {
	it("stays on screen and says the day, the days done, and the time left", () => {
		const ui = new BuildProgressUi("en", () => undefined, null);
		ui.update(progress());
		expect(Notice.recorded[0]).toMatchObject({ duration: 0, hidden: false });
		expect(shown()).toBe("Backfill · 2026-10-24 · 40 of 400 days · about 1 h 05 min left" + en.historyStop);
	});

	it("leaves the time out until there is a pace to estimate it from", () => {
		const ui = new BuildProgressUi("en", () => undefined, null);
		ui.update(progress({ etaMs: null, done: 0 }));
		expect(shown()).toBe("Backfill · 2026-10-24 · 0 of 400 days" + en.historyStop);
	});

	it("says when it is paused and for how long, in the user's language", () => {
		const ui = new BuildProgressUi("de", () => undefined, null);
		ui.update(progress({ state: "paused", pauseMs: 300_000 }));
		expect(shown()).toBe("Nachsynchronisierung pausiert, Garmin antwortet nicht. Weiter in 5 min." + de.historyStop);
	});

	it("updates at most once a second, but always shows a pause", () => {
		const ui = new BuildProgressUi("en", () => undefined, null);
		const text = (): string => Notice.recorded[0]!.fragment!.textContent ?? "";
		ui.update(progress({ done: 1 }));
		ui.update(progress({ done: 2 }));
		expect(text()).toContain("1 of");
		ui.update(progress({ state: "paused", pauseMs: 300_000 }));
		expect(text()).toContain("paused");
		vi.advanceTimersByTime(1000);
		ui.update(progress({ done: 3 }));
		expect(text()).toContain("3 of");
	});

	it("calls the stop handler from its button", () => {
		const stop = vi.fn();
		new BuildProgressUi("en", stop, null);
		(Notice.recorded[0]!.fragment!.querySelector("button") as HTMLButtonElement).click();
		expect(stop).toHaveBeenCalledOnce();
	});

	it("shows the percentage in the status bar and removes the item at the end", () => {
		const bar = document.createElement("div");
		document.body.appendChild(bar);
		const ui = new BuildProgressUi("en", () => undefined, bar);
		ui.update(progress({ done: 100, total: 400 }));
		expect(bar.textContent).toBe("Backfill 25%");
		ui.dismiss();
		expect(bar.isConnected).toBe(false);
		expect(Notice.recorded[0]!.hidden).toBe(true);
	});
});

describe("how a build ends", () => {
	const end = (r: BuildResult, lang = "en"): void => new BuildProgressUi(lang, () => undefined, null).finish(r);

	it("hides the progress notice and reports what was done for a minute-long read", () => {
		end(result());
		expect(Notice.recorded[0]!.hidden).toBe(true);
		expect(messages().at(-1)).toBe("Backfill done: 380 days fetched, 20 were already there");
		expect(Notice.recorded.at(-1)!.duration).toBe(15000);
	});

	it("mentions failed days, unless the build ended where the data starts", () => {
		end(result({ failed: 2 }));
		expect(messages().at(-1)).toBe("Backfill done: 380 days fetched, 20 were already there, 2 failed. Run the backfill again to retry them.");
		end(result({ failed: 2, reachedStart: true }));
		expect(messages().at(-1)).toBe("Backfill done: 380 days fetched, 20 were already there");
	});

	it("says so when there was nothing to fetch, and keeps the status bar at a whole when no days are due", () => {
		end(result({ fetched: 0, skipped: 20 }));
		expect(messages().at(-1)).toBe(en.noticeBackfillNothing);
		const bar = document.createElement("div");
		new BuildProgressUi("en", () => undefined, bar).update(progress({ done: 0, total: 0 }));
		expect(bar.textContent).toBe("Backfill 0%");
	});

	it("tells where it stopped, that Garmin kept failing, and that a sign-in is needed", () => {
		end(result({ status: "stopped", date: "2025-06-01" }));
		expect(messages().at(-1)).toBe("Backfill stopped at 2025-06-01. Run it again to continue.");
		end(result({ status: "gave-up" }));
		expect(messages().at(-1)).toBe(en.historyGaveUp);
		end(result({ status: "login-required" }));
		expect(messages().at(-1)).toBe(en.noticeLoginRequired);
		end(result({ status: "stopped", date: "2025-06-01" }), "de");
		expect(messages().at(-1)).toBe("Nachsynchronisierung bei 2025-06-01 gestoppt. Starte sie erneut, um fortzufahren.");
	});
});
