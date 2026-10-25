// Why it matters: the Garmin sign-in tokens live in secret storage. A lost token logs the user out;
// a token left in data.json leaks into synced vaults. The one-time move must only clear after a
// verified write, and a broken secret store must never throw into the plugin.
import { describe, expect, it } from "vitest";
import { App } from "obsidian";
import { isSecretStorageAvailable, readStoredTokens, writeStoredTokens } from "../src/token-store";

const OAUTH1 = { oauth_token: "t1", oauth_token_secret: "s1" };
const OAUTH2 = { access_token: "a", refresh_token: "r", expires_in: 3600, expires_at: 99 };

describe("isSecretStorageAvailable", () => {
	it("is true for a store with getSecret and setSecret", () => {
		expect(isSecretStorageAvailable(new App() as never)).toBe(true);
	});
	it("is false when the store is missing or incomplete", () => {
		const app = new App();
		app.secretStorage = undefined;
		expect(isSecretStorageAvailable(app as never)).toBe(false);
		expect(isSecretStorageAvailable({ secretStorage: { getSecret: () => null } } as never)).toBe(false);
		expect(isSecretStorageAvailable({ secretStorage: { setSecret: () => undefined } } as never)).toBe(false);
	});
});

describe("write then read", () => {
	it("round-trips both tokens and reports success", () => {
		const app = new App();
		expect(writeStoredTokens(app as never, OAUTH1, OAUTH2)).toBe(true);
		expect(readStoredTokens(app as never)).toEqual({ oauth1: OAUTH1, oauth2: OAUTH2 });
	});

	it("clears with nulls (the API has no delete, so empty strings are stored) and reads back nothing", () => {
		const app = new App();
		writeStoredTokens(app as never, OAUTH1, OAUTH2);
		expect(writeStoredTokens(app as never, null, null)).toBe(true);
		expect(readStoredTokens(app as never)).toEqual({ oauth1: null, oauth2: null });
	});

	it("keeps the OAuth1 token when only OAuth2 is cleared", () => {
		const app = new App();
		writeStoredTokens(app as never, OAUTH1, null);
		expect(readStoredTokens(app as never)).toEqual({ oauth1: OAUTH1, oauth2: null });
	});
});

describe("failure handling", () => {
	it("reports failure and writes nothing when secret storage is unavailable", () => {
		const app = new App();
		app.secretStorage = undefined;
		expect(writeStoredTokens(app as never, OAUTH1, OAUTH2)).toBe(false);
		expect(readStoredTokens(app as never)).toEqual({ oauth1: null, oauth2: null });
	});

	it("reports failure when the write is accepted but reads back something else", () => {
		const app = new App();
		app.secretStorage!.readOverride = () => "something else";
		expect(writeStoredTokens(app as never, OAUTH1, OAUTH2)).toBe(false);
	});

	it("reports failure when setSecret throws", () => {
		const app = new App();
		app.secretStorage!.throwOnSet = true;
		expect(writeStoredTokens(app as never, OAUTH1, OAUTH2)).toBe(false);
	});

	it("reads nothing when getSecret throws", () => {
		const app = new App();
		writeStoredTokens(app as never, OAUTH1, OAUTH2);
		app.secretStorage!.throwOnGet = true;
		expect(readStoredTokens(app as never)).toEqual({ oauth1: null, oauth2: null });
	});

	it("treats a null read of an empty value as a match (getSecret may return null for empty)", () => {
		const app = new App();
		app.secretStorage!.readOverride = (_id, stored) => (stored === "" ? null : stored);
		expect(writeStoredTokens(app as never, null, null)).toBe(true);
	});

	it.each([
		["not JSON", "{oops"],
		["a JSON scalar", "42"],
		["JSON null", "null"],
		["an object without the required fields", JSON.stringify({ foo: 1 })],
		["wrong field types", JSON.stringify({ oauth_token: 1, oauth_token_secret: 2 })],
	])("ignores a corrupt stored OAuth1 token: %s", (_label, raw) => {
		const app = new App();
		app.secretStorage!.store.set("garmin-health-sync-oauth1", raw);
		app.secretStorage!.store.set("garmin-health-sync-oauth2", JSON.stringify({ nope: true }));
		expect(readStoredTokens(app as never)).toEqual({ oauth1: null, oauth2: null });
	});
});
