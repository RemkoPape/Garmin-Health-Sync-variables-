// Why it matters: the error classes decide whether a failure logs the user out (auth), is retried with
// backoff (transient), or is shown as "no data". Misclassifying one is a wrong logout or a silent miss.
import { describe, expect, it } from "vitest";
import {
	GarminAuthError,
	LoginRequiredError,
	SyncFetchError,
	isAuthFailureStatus,
	isGarminAuthError,
	isLoginRequiredError,
	isSyncFetchError,
} from "../src/errors";

describe("LoginRequiredError", () => {
	it("is recognised as an instance and by its message (errors cross module boundaries)", () => {
		expect(isLoginRequiredError(new LoginRequiredError())).toBe(true);
		expect(isLoginRequiredError(new Error("login_required"))).toBe(true);
		expect(new LoginRequiredError().name).toBe("LoginRequiredError");
		expect(new LoginRequiredError("custom").message).toBe("custom");
	});

	it("does not match other errors or non-errors", () => {
		expect(isLoginRequiredError(new Error("boom"))).toBe(false);
		expect(isLoginRequiredError("login_required")).toBe(false);
		expect(isLoginRequiredError(null)).toBe(false);
	});
});

describe("SyncFetchError", () => {
	it("is recognised and carries a default message", () => {
		const e = new SyncFetchError();
		expect(isSyncFetchError(e)).toBe(true);
		expect(e.message).toBe("sync_fetch_failed");
		expect(e.name).toBe("SyncFetchError");
		expect(new SyncFetchError("x").message).toBe("x");
		expect(isSyncFetchError(new Error("sync_fetch_failed"))).toBe(false);
	});
});

describe("GarminAuthError", () => {
	it("carries the HTTP status and a default message", () => {
		const e = new GarminAuthError(401);
		expect(e.status).toBe(401);
		expect(e.message).toBe("garmin_auth_error_401");
		expect(e.name).toBe("GarminAuthError");
		expect(new GarminAuthError(0, "network").message).toBe("network");
		expect(isGarminAuthError(e)).toBe(true);
		expect(isGarminAuthError(new Error("x"))).toBe(false);
	});
});

describe("isAuthFailureStatus", () => {
	it.each([401, 403])("treats %i as the OAuth grant being rejected", (status) => {
		expect(isAuthFailureStatus(status)).toBe(true);
	});
	it.each([0, 200, 400, 404, 429, 500, 503])("treats %i as not an auth failure", (status) => {
		expect(isAuthFailureStatus(status)).toBe(false);
	});
});
