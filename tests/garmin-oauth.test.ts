// Why it matters: OAuth signing and token exchange keep the user signed in. A wrong signature, or a
// body that differs from the signed one, is a 401 that logs everyone out at the next refresh.
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { network as net } from "../testUtils/mocks/obsidian";
import {
	exchange,
	getConsumer,
	getOAuth1,
	oauth1Header,
	rfc3986,
	withExpirations,
	type Consumer,
	type OAuth2Token,
} from "../src/providers/garmin/garmin-oauth";
import { GarminAuthError } from "../src/errors";

const CONSUMER: Consumer = { consumer_key: "ck", consumer_secret: "cs" };
const TOKEN = { oauth_token: "tok", oauth_token_secret: "sec" };
const NOW = 1_700_000_000_000;

/** Independent HMAC-SHA1 OAuth1 signature using node:crypto and a hand-built base string. */
function reference(method: string, url: string, params: Record<string, string>, consumerSecret: string, tokenSecret: string): string {
	const enc = (s: string): string =>
		encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
	const u = new URL(url);
	const all: [string, string][] = [...u.searchParams.entries(), ...Object.entries(params)].map(([k, v]) => [enc(k), enc(v)]);
	all.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
	const paramString = all.map(([k, v]) => `${k}=${v}`).join("&");
	const base = `${method}&${enc(`${u.origin}${u.pathname}`)}&${enc(paramString)}`;
	return createHmac("sha1", `${enc(consumerSecret)}&${enc(tokenSecret)}`).update(base).digest("base64");
}

function parseHeader(header: string): Record<string, string> {
	expect(header.startsWith("OAuth ")).toBe(true);
	const out: Record<string, string> = {};
	for (const part of header.slice(6).split(", ")) {
		const m = /^([^=]+)="(.*)"$/.exec(part);
		out[decodeURIComponent(m![1]!)] = decodeURIComponent(m![2]!);
	}
	return out;
}

function pinRandomAndClock(byte = 0xab): void {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	vi.spyOn(crypto, "getRandomValues").mockImplementation(((arr: Uint8Array) => {
		arr.fill(byte);
		return arr;
	}) as never);
}

describe("rfc3986", () => {
	it("encodes the characters encodeURIComponent leaves alone", () => {
		expect(rfc3986("a b!*'()~-._")).toBe("a%20b%21%2A%27%28%29~-._");
	});
	it("encodes unicode and reserved characters", () => {
		expect(rfc3986("é/?&=+")).toBe("%C3%A9%2F%3F%26%3D%2B");
	});
});

describe("the reference implementation used below", () => {
	it("reproduces Twitter's documented signature example", () => {
		const sig = reference(
			"POST",
			"https://api.twitter.com/1.1/statuses/update.json?include_entities=true",
			{
				status: "Hello Ladies + Gentlemen, a signed OAuth request!",
				oauth_consumer_key: "xvz1evFS4wEEPTGEFPHBog",
				oauth_nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
				oauth_signature_method: "HMAC-SHA1",
				oauth_timestamp: "1318622958",
				oauth_token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
				oauth_version: "1.0",
			},
			"kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
			"LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
		);
		expect(sig).toBe("hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
	});
});

describe("oauth1Header", () => {
	beforeEach(() => pinRandomAndClock());

	const expectedParams = (extra: Record<string, string> = {}): Record<string, string> => ({
		oauth_consumer_key: "ck",
		oauth_nonce: "ab".repeat(16),
		oauth_signature_method: "HMAC-SHA1",
		oauth_timestamp: String(NOW / 1000),
		oauth_version: "1.0",
		...extra,
	});

	it("signs a GET with query parameters exactly like an independent implementation", async () => {
		const url = "https://connectapi.garmin.com/oauth-service/oauth/preauthorized?ticket=ST-1&login-url=https%3A%2F%2Fsso.garmin.com%2Fsso%2Fembed&accepts-mfa-tokens=true";
		const header = parseHeader(await oauth1Header("GET", url, null, CONSUMER, null));
		expect(header["oauth_signature"]).toBe(reference("GET", url, expectedParams(), "cs", ""));
		expect(header).toMatchObject(expectedParams());
		expect(header).not.toHaveProperty("oauth_token");
	});

	it("signs a POST with body parameters and a token", async () => {
		const url = "https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0";
		const body = { audience: "GARMIN_CONNECT_MOBILE_ANDROID_DI", mfa_token: "m f/a" };
		const header = parseHeader(await oauth1Header("POST", url, body, CONSUMER, TOKEN));
		expect(header["oauth_token"]).toBe("tok");
		expect(header["oauth_signature"]).toBe(
			reference("POST", url, { ...body, ...expectedParams({ oauth_token: "tok" }) }, "cs", "sec"),
		);
	});

	it("handles reserved characters in the secrets and parameters (! * ' ( ) and spaces)", async () => {
		const consumer = { consumer_key: "k(1)", consumer_secret: "s!*'()" };
		const token = { oauth_token: "t'x", oauth_token_secret: "ts (1)!" };
		const url = "https://h.example/p?a=b%20c&d=e!f";
		const header = parseHeader(await oauth1Header("post", url, { x: "y z*" }, consumer, token));
		expect(header["oauth_signature"]).toBe(
			reference("POST", url, { x: "y z*", ...expectedParams({ oauth_consumer_key: "k(1)", oauth_token: "t'x" }) }, "s!*'()", "ts (1)!"),
		);
	});

	it("uses a fresh 32 hex character nonce from random bytes and the current time", async () => {
		vi.restoreAllMocks();
		vi.useRealTimers();
		const a = parseHeader(await oauth1Header("GET", "https://h.example/p", null, CONSUMER, null));
		const b = parseHeader(await oauth1Header("GET", "https://h.example/p", null, CONSUMER, null));
		expect(a["oauth_nonce"]).toMatch(/^[0-9a-f]{32}$/);
		expect(a["oauth_nonce"]).not.toBe(b["oauth_nonce"]);
		expect(Math.abs(Number(a["oauth_timestamp"]) - Date.now() / 1000)).toBeLessThan(5);
	});

	it("lists its parameters sorted", async () => {
		const raw = await oauth1Header("GET", "https://h.example/p", null, CONSUMER, TOKEN);
		const keys = raw.slice(6).split(", ").map((p) => p.split("=")[0]);
		expect(keys).toEqual([...keys].sort());
	});
});

describe("getConsumer", () => {
	const URL = "https://thegarth.s3.amazonaws.com/oauth_consumer.json";

	it("returns the published keys", async () => {
		net.on(URL, { body: { consumer_key: "k", consumer_secret: "s" } });
		expect(await getConsumer()).toEqual({ consumer_key: "k", consumer_secret: "s" });
	});

	it.each([
		["an HTTP error", { status: 403, body: "denied" }],
		["a malformed body", { status: 200, body: { consumer_key: "k" } }],
		["a non-JSON body", { status: 200, body: "<html>" }],
		["a null body", { status: 200, body: "null" }],
	])("falls back to the bundled keys on %s", async (_label, reply) => {
		net.on(URL, reply);
		const c = await getConsumer();
		expect(c.consumer_key).toBe("fc3e99d2-118c-44b8-8ae3-03370dde24c0");
		expect(c.consumer_secret).toBeTruthy();
	});

	it("falls back when the request fails outright (AWS blocked)", async () => {
		net.fail(URL);
		expect((await getConsumer()).consumer_key).toBe("fc3e99d2-118c-44b8-8ae3-03370dde24c0");
	});

	it("returns a copy of the fallback so callers cannot corrupt it", async () => {
		net.fail(URL);
		const first = await getConsumer();
		first.consumer_key = "mutated";
		expect((await getConsumer()).consumer_key).toBe("fc3e99d2-118c-44b8-8ae3-03370dde24c0");
	});
});

describe("withExpirations", () => {
	const token: OAuth2Token = { access_token: "a", refresh_token: "r", expires_in: 3600, expires_at: 0 };

	it("sets the access expiry from now and the refresh expiry when given", () => {
		expect(withExpirations({ ...token, refresh_token_expires_in: 86400 }, 1000)).toMatchObject({
			expires_at: 4600,
			refresh_token_expires_at: 87400,
		});
	});

	it("leaves the refresh expiry unset when the token has none", () => {
		expect(withExpirations(token, 1000)).not.toHaveProperty("refresh_token_expires_at");
	});

	it("neither mutates its input nor double-extends when applied twice", () => {
		const input = { ...token };
		const once = withExpirations(input, 1000);
		const twice = withExpirations(once, 1000);
		expect(input.expires_at).toBe(0);
		expect(once.expires_at).toBe(4600);
		expect(twice.expires_at).toBe(4600);
	});
});

describe("getOAuth1", () => {
	const PRE = /connectapi\.garmin\.com\/oauth-service\/oauth\/preauthorized/;
	beforeEach(() => pinRandomAndClock());

	it("sends the signed request with the encoded ticket and the embed login url", async () => {
		net.on(PRE, { body: "oauth_token=t&oauth_token_secret=s" });
		await getOAuth1("ST-1 2", CONSUMER, "garmin.com");
		const call = net.calls[0]!;
		expect(call.method).toBe("GET");
		expect(call.url).toBe(
			"https://connectapi.garmin.com/oauth-service/oauth/preauthorized?ticket=ST-1%202&login-url=https%3A%2F%2Fsso.garmin.com%2Fsso%2Fembed&accepts-mfa-tokens=true",
		);
		expect(call.headers?.["User-Agent"]).toBe("com.garmin.android.apps.connectmobile");
		expect(call.headers?.["Authorization"]).toMatch(/^OAuth /);
		expect(call.throw).toBe(false);
	});

	it("uses the given login url (the mobile service) and the China domain", async () => {
		net.on(/connectapi\.garmin\.cn/, { body: "oauth_token=t&oauth_token_secret=s" });
		await getOAuth1("ST-1", CONSUMER, "garmin.cn", "https://mobile.integration.garmin.cn/gcm/ios");
		expect(net.calls[0]!.url).toContain("connectapi.garmin.cn");
		expect(net.calls[0]!.url).toContain("login-url=https%3A%2F%2Fmobile.integration.garmin.cn%2Fgcm%2Fios");
	});

	it("parses the token and the optional MFA token", async () => {
		net.on(PRE, { body: "oauth_token=t&oauth_token_secret=s" });
		expect(await getOAuth1("ST-1", CONSUMER, "garmin.com")).toEqual({ oauth_token: "t", oauth_token_secret: "s" });
		net.reset();
		net.on(PRE, { body: "oauth_token=t&oauth_token_secret=s&mfa_token=m%3D1" });
		expect(await getOAuth1("ST-1", CONSUMER, "garmin.com")).toEqual({ oauth_token: "t", oauth_token_secret: "s", mfa_token: "m=1" });
	});

	it("reports an HTTP error with its status", async () => {
		net.on(PRE, { status: 401 });
		await expect(getOAuth1("ST-1", CONSUMER, "garmin.com")).rejects.toMatchObject({ name: "GarminAuthError", status: 401 });
	});

	it("reports a network failure as status 0", async () => {
		net.fail(PRE, "offline");
		const err = await getOAuth1("ST-1", CONSUMER, "garmin.com").catch((e: unknown) => e);
		expect(err).toBeInstanceOf(GarminAuthError);
		expect(err).toMatchObject({ status: 0 });
		expect((err as Error).message).toContain("offline");
	});

	it("rejects a 200 answer without the token fields, with the 200 status (transient, not an auth failure)", async () => {
		net.on(PRE, { body: "nothing=here" });
		await expect(getOAuth1("ST-1", CONSUMER, "garmin.com")).rejects.toMatchObject({ status: 200 });
	});
});

describe("exchange", () => {
	const EX = /connectapi\.garmin\.com\/oauth-service\/oauth\/exchange\/user\/2\.0/;
	const answer = { access_token: "at", refresh_token: "rt", expires_in: 3600, refresh_token_expires_in: 7200 };
	beforeEach(() => pinRandomAndClock());

	it("posts form-encoded and returns the token with computed expiry times", async () => {
		net.on(EX, { body: answer });
		const token = await exchange(TOKEN, CONSUMER, "garmin.com");
		expect(token).toMatchObject({ access_token: "at", expires_at: NOW / 1000 + 3600, refresh_token_expires_at: NOW / 1000 + 7200 });
		const call = net.calls[0]!;
		expect(call.method).toBe("POST");
		expect(call.headers?.["Content-Type"]).toBe("application/x-www-form-urlencoded");
		expect(call.throw).toBe(false);
	});

	it("sends no audience and no mfa_token on a silent refresh (a repeated mfa_token logs everyone out)", async () => {
		net.on(EX, { body: answer });
		await exchange({ ...TOKEN, mfa_token: "m" }, CONSUMER, "garmin.com");
		expect(net.calls[0]!.body).toBe("");
	});

	it("sends audience and the mfa_token only on login", async () => {
		net.on(EX, { body: answer });
		await exchange({ ...TOKEN, mfa_token: "m 1" }, CONSUMER, "garmin.com", { login: true });
		expect(new URLSearchParams(net.calls[0]!.body as string).toString()).toBe("audience=GARMIN_CONNECT_MOBILE_ANDROID_DI&mfa_token=m+1");
		net.reset();
		net.on(EX, { body: answer });
		await exchange(TOKEN, CONSUMER, "garmin.com", { login: true });
		expect(net.calls[0]!.body).toBe("audience=GARMIN_CONNECT_MOBILE_ANDROID_DI");
	});

	it("signs exactly the body it sends", async () => {
		net.on(EX, { body: answer });
		await exchange({ ...TOKEN, mfa_token: "m&1" }, CONSUMER, "garmin.com", { login: true });
		const call = net.calls[0]!;
		const sent = Object.fromEntries(new URLSearchParams(call.body as string));
		const header = parseHeader(call.headers!["Authorization"]!);
		expect(header["oauth_signature"]).toBe(
			reference("POST", call.url, { ...sent, ...Object.fromEntries(Object.entries(header).filter(([k]) => k !== "oauth_signature")) }, "cs", "sec"),
		);
	});

	it("reports an HTTP error with its status", async () => {
		net.on(EX, { status: 403 });
		await expect(exchange(TOKEN, CONSUMER, "garmin.com")).rejects.toMatchObject({ status: 403 });
	});

	it("reports a network failure as status 0", async () => {
		net.fail(EX);
		await expect(exchange(TOKEN, CONSUMER, "garmin.com")).rejects.toMatchObject({ status: 0 });
	});

	it("uses the China domain", async () => {
		net.on(/connectapi\.garmin\.cn/, { body: answer });
		await exchange(TOKEN, CONSUMER, "garmin.cn");
		expect(net.calls[0]!.url).toContain("connectapi.garmin.cn");
	});

	// C3: a 2xx answer without access_token is accepted as a token (known limitation, #TODO-C3). The next call then
	// sends "Bearer undefined", gets a 401 and logs the user out. A fix touches sign-in and ships in its own beta.
	it("accepts a 200 answer without an access token and computes a NaN expiry (known limitation, #TODO-C3)", async () => {
		net.on(EX, { body: {} });
		const token = await exchange(TOKEN, CONSUMER, "garmin.com");
		expect(token.access_token).toBeUndefined();
		expect(Number.isNaN(token.expires_at)).toBe(true);
	});
});
