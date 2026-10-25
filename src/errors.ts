export class LoginRequiredError extends Error {
	constructor(message = "login_required") {
		super(message);
		this.name = "LoginRequiredError";
	}
}

export function isLoginRequiredError(error: unknown): error is LoginRequiredError {
	return error instanceof LoginRequiredError
		|| (error instanceof Error && error.message === "login_required");
}

/** A data fetch produced no usable response (refresh/profile/network failure, timeout, or
 *  every endpoint failed). Distinct from a successful fetch that simply has no data, so the
 *  sync can report an error instead of "no health data". */
export class SyncFetchError extends Error {
	constructor(message = "sync_fetch_failed") {
		super(message);
		this.name = "SyncFetchError";
	}
}

export function isSyncFetchError(error: unknown): error is SyncFetchError {
	return error instanceof SyncFetchError;
}

/** Carries the HTTP status of a failed Garmin OAuth/API call so the auth state
 *  machine can tell a dead OAuth1 grant (401/403 → needsUserLogin) apart from a
 *  transient failure (429/5xx/network → temporarilyUnavailable + backoff).
 *  `status === 0` is the sentinel for a network-level failure (no HTTP response). */
export class GarminAuthError extends Error {
	readonly status: number;

	constructor(status: number, message?: string) {
		super(message ?? `garmin_auth_error_${status}`);
		this.name = "GarminAuthError";
		this.status = status;
	}
}

export function isGarminAuthError(error: unknown): error is GarminAuthError {
	return error instanceof GarminAuthError;
}

/** Auth failure: the OAuth1 grant / token is no longer accepted by Garmin.
 *  Per the migration concept, Garmin answers 401 OR 403 when the token is
 *  missing or expired — both must pause auto-sync (needsUserLogin). The legacy
 *  code only checked 401; the added 403 is the documented side-finding. */
export function isAuthFailureStatus(status: number): boolean {
	return status === 401 || status === 403;
}
