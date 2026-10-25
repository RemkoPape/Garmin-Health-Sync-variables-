// Why it matters: this is the sign-in path on every platform. It sends the user's password, so it must
// only ever go to Garmin's own SSO host, never appear in a log, URL or error, and every refusal Garmin
// can give (wrong password, CAPTCHA, rate limit, bot block) must map to the right message and cooldown.
import { describe, expect, it, vi } from "vitest";
import { network as net } from "../testUtils/mocks/obsidian";
import { collectCookies, getMobileServiceUrl, mobileLogin, mobileVerifyMfa, type MfaChallenge } from "../src/providers/garmin/garmin-mobile-sso";

const LOGIN = /^https:\/\/sso\.garmin\.com\/mobile\/api\/login\?/;
const MFA = /^https:\/\/sso\.garmin\.com\/mobile\/api\/mfa\/verifyCode\?/;
const PASSWORD = "p4ss w0rd!&=";

const status = (type: string, extra: Record<string, unknown> = {}) => ({ body: { responseStatus: { type }, ...extra } });

describe("collectCookies", () => {
	it("reads one folded string, an array, any header casing, and ignores attributes", () => {
		const jar: Record<string, string> = {};
		collectCookies({ "Set-Cookie": "a=1; Path=/; HttpOnly, b=2; Secure" }, jar);
		collectCookies({ "set-cookie": ["c=3; Path=/", "d=4"] }, jar);
		expect(jar).toEqual({ a: "1", b: "2", c: "3", d: "4" });
	});

	it("does not split inside an Expires date that contains a comma", () => {
		const jar: Record<string, string> = {};
		collectCookies({ "set-cookie": "a=1; Expires=Thu, 01 Jan 2026 00:00:00 GMT; Path=/, b=2" }, jar);
		expect(jar).toEqual({ a: "1", b: "2" });
	});

	it("keeps '=' inside values and overwrites a cookie that is set again", () => {
		const jar: Record<string, string> = { a: "old" };
		collectCookies({ "set-cookie": "a=x=y==; Path=/" }, jar);
		expect(jar["a"]).toBe("x=y==");
	});

	it("ignores missing headers, non-string values and garbage", () => {
		const jar: Record<string, string> = {};
		collectCookies(undefined, jar);
		collectCookies({}, jar);
		collectCookies({ "set-cookie": 5 }, jar);
		collectCookies({ "set-cookie": [1, null, "=novalue", "noequals", ""] }, jar);
		expect(jar).toEqual({});
	});
});

describe("getMobileServiceUrl", () => {
	it("is the mobile integration service of the domain", () => {
		expect(getMobileServiceUrl("garmin.cn")).toBe("https://mobile.integration.garmin.cn/gcm/ios");
	});
});

describe("mobileLogin", () => {
	it("posts the credentials as JSON to the SSO host only and returns the service ticket", async () => {
		net.on(LOGIN, status("SUCCESSFUL", { serviceTicketId: "ST-123" }));
		expect(await mobileLogin("garmin.com", "me@example.com", PASSWORD)).toEqual({ kind: "ticket", ticket: "ST-123" });
		const call = net.calls[0]!;
		expect(call.method).toBe("POST");
		expect(call.url).toContain("clientId=GCM_IOS_DARK");
		expect(call.url).toContain("service=https%3A%2F%2Fmobile.integration.garmin.com%2Fgcm%2Fios");
		expect(JSON.parse(call.body as string)).toEqual({ username: "me@example.com", password: PASSWORD, rememberMe: true, captchaToken: "" });
		expect(call.headers?.["Origin"]).toBe("https://sso.garmin.com");
		expect(call.headers).not.toHaveProperty("Cookie");
		expect(call.throw).toBe(false);
	});

	it("never puts the password into a URL or a header", async () => {
		net.on(LOGIN, status("SUCCESSFUL", { serviceTicketId: "ST-1" }));
		await mobileLogin("garmin.com", "me@example.com", PASSWORD);
		const call = net.calls[0]!;
		const haystack = `${call.url}${JSON.stringify(call.headers)}`;
		expect(haystack).not.toContain(PASSWORD);
		expect(haystack).not.toContain(encodeURIComponent(PASSWORD));
		expect(haystack).not.toContain("me@example.com");
	});

	it("uses the China SSO host for garmin.cn", async () => {
		net.on(/^https:\/\/sso\.garmin\.cn\/mobile\/api\/login/, status("SUCCESSFUL", { serviceTicketId: "ST-9" }));
		expect(await mobileLogin("garmin.cn", "a", "b")).toEqual({ kind: "ticket", ticket: "ST-9" });
	});

	it("refuses any other domain before sending anything (the password never leaves for another host)", async () => {
		for (const domain of ["evil.example.com", "garmin.com.evil.net", ""]) {
			const r = await mobileLogin(domain, "a", PASSWORD);
			expect(r).toMatchObject({ kind: "error", reason: "network" });
			expect(JSON.stringify(r)).toContain("unsupported_domain");
			expect(JSON.stringify(r)).not.toContain(PASSWORD);
		}
		expect(net.calls).toEqual([]);
	});

	it("asks for the code on an MFA challenge and carries the session cookies to the next step", async () => {
		net.on(LOGIN, {
			body: { responseStatus: { type: "MFA_REQUIRED" }, customerMfaInfo: { mfaLastMethodUsed: "sms" } },
			headers: { "set-cookie": "SESSION=abc; Path=/, other=1" },
		});
		expect(await mobileLogin("garmin.com", "a", "b")).toEqual({
			kind: "mfa",
			challenge: { method: "sms", cookies: { SESSION: "abc", other: "1" } },
		});
	});

	it("defaults the MFA method to email", async () => {
		net.on(LOGIN, status("MFA_REQUIRED"));
		expect(await mobileLogin("garmin.com", "a", "b")).toMatchObject({ kind: "mfa", challenge: { method: "email", cookies: {} } });
		net.reset();
		net.on(LOGIN, status("MFA_REQUIRED", { customerMfaInfo: { mfaLastMethodUsed: 5 } }));
		expect(await mobileLogin("garmin.com", "a", "b")).toMatchObject({ challenge: { method: "email" } });
		net.reset();
		net.on(LOGIN, status("MFA_REQUIRED", { customerMfaInfo: "x" }));
		expect(await mobileLogin("garmin.com", "a", "b")).toMatchObject({ challenge: { method: "email" } });
	});

	it("maps a wrong password and a CAPTCHA request", async () => {
		net.on(LOGIN, status("INVALID_USERNAME_PASSWORD"));
		expect(await mobileLogin("garmin.com", "a", "b")).toMatchObject({ kind: "error", reason: "invalid_credentials" });
		net.reset();
		net.on(LOGIN, status("CAPTCHA_REQUIRED"));
		expect(await mobileLogin("garmin.com", "a", "b")).toMatchObject({ kind: "error", reason: "captcha" });
	});

	it("reports rate limiting with Garmin's Retry-After hint when it is a number", async () => {
		net.on(LOGIN, { status: 429, headers: { "Retry-After": "120" } });
		expect(await mobileLogin("garmin.com", "a", "b")).toMatchObject({ kind: "error", reason: "rate_limited", retryAfter: 120 });
		net.reset();
		net.on(LOGIN, { status: 429, headers: { "retry-after": "soon" } });
		const r = await mobileLogin("garmin.com", "a", "b");
		expect(r).toMatchObject({ kind: "error", reason: "rate_limited" });
		expect(r).not.toHaveProperty("retryAfter");
		net.reset();
		net.on(LOGIN, { status: 429 });
		expect(await mobileLogin("garmin.com", "a", "b")).toMatchObject({ reason: "rate_limited", detail: "login: HTTP 429" });
	});

	it("reports a 403 and a non-JSON reply as the bot-protection block", async () => {
		net.on(LOGIN, { status: 403, body: "<html>Cloudflare</html>" });
		expect(await mobileLogin("garmin.com", "a", "b")).toMatchObject({ kind: "error", reason: "blocked" });
		net.reset();
		net.on(LOGIN, { status: 200, body: "<html>" });
		expect(await mobileLogin("garmin.com", "a", "b")).toMatchObject({ kind: "error", reason: "blocked" });
		net.reset();
		net.on(LOGIN, { status: 200, body: "null" });
		expect(await mobileLogin("garmin.com", "a", "b")).toMatchObject({ kind: "error", reason: "blocked" });
	});

	it("reports a network failure", async () => {
		net.fail(LOGIN, "offline");
		expect(await mobileLogin("garmin.com", "a", "b")).toMatchObject({ kind: "error", reason: "network", detail: "login: network error (offline)" });
	});

	it("reports anything else as unexpected, naming the status but never the body", async () => {
		net.on(LOGIN, { status: 500, body: { responseStatus: { type: "WEIRD" }, secret: "do-not-log" } });
		const r = await mobileLogin("garmin.com", "a", "b");
		expect(r).toMatchObject({ kind: "error", reason: "unexpected", detail: "login: HTTP 500, responseStatus=WEIRD" });
		expect(JSON.stringify(r)).not.toContain("do-not-log");
		net.reset();
		net.on(LOGIN, { body: { responseStatus: "x" } });
		expect(await mobileLogin("garmin.com", "a", "b")).toMatchObject({ detail: "login: HTTP 200, responseStatus=none" });
	});

	it("does not call SUCCESSFUL without a ticket a success", async () => {
		net.on(LOGIN, status("SUCCESSFUL"));
		expect(await mobileLogin("garmin.com", "a", "b")).toMatchObject({ kind: "error", reason: "unexpected" });
		net.reset();
		net.on(LOGIN, status("SUCCESSFUL", { serviceTicketId: 7 }));
		expect(await mobileLogin("garmin.com", "a", "b")).toMatchObject({ kind: "error", reason: "unexpected" });
	});

	it("survives a cookie header it cannot parse", async () => {
		net.on(LOGIN, () => ({
			body: { responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: "ST-1" },
			headers: new Proxy({}, { ownKeys: () => { throw new Error("hostile headers"); } }) as Record<string, string>,
		}));
		expect(await mobileLogin("garmin.com", "a", "b")).toEqual({ kind: "ticket", ticket: "ST-1" });
	});
});

describe("mobileVerifyMfa", () => {
	const challenge = (cookies: Record<string, string> = { SESSION: "abc" }): MfaChallenge => ({ method: "email", cookies });

	it("sends the trimmed code with the session cookie and returns the ticket", async () => {
		net.on(MFA, status("SUCCESSFUL", { serviceTicketId: "ST-77" }));
		expect(await mobileVerifyMfa("garmin.com", challenge(), " 123456 ")).toEqual({ kind: "ticket", ticket: "ST-77" });
		const call = net.calls[0]!;
		expect(call.headers?.["Cookie"]).toBe("SESSION=abc");
		expect(JSON.parse(call.body as string)).toEqual({
			mfaMethod: "email",
			mfaVerificationCode: "123456",
			rememberMyBrowser: true,
			reconsentList: [],
			mfaSetup: false,
		});
	});

	it("joins several cookies and keeps cookies set in the reply", async () => {
		const c = challenge({ A: "1", B: "2" });
		net.on(MFA, { body: { responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: "ST-1" }, headers: { "set-cookie": "C=3" } });
		await mobileVerifyMfa("garmin.com", c, "1");
		expect(net.calls[0]!.headers?.["Cookie"]).toBe("A=1; B=2");
		expect(c.cookies).toEqual({ A: "1", B: "2", C: "3" });
	});

	it("reports a wrong code as mfa_failed", async () => {
		net.on(MFA, status("MFA_CODE_INVALID"));
		expect(await mobileVerifyMfa("garmin.com", challenge(), "000000")).toMatchObject({
			kind: "error",
			reason: "mfa_failed",
			detail: "mfa: HTTP 200, responseStatus=MFA_CODE_INVALID",
		});
	});

	it("does not blame the user's code when no session cookie was visible", async () => {
		net.on(MFA, status("MFA_CODE_INVALID"));
		expect(await mobileVerifyMfa("garmin.com", challenge({}), "123456")).toMatchObject({
			reason: "unexpected",
			detail: expect.stringContaining("no session cookies") as unknown as string,
		});
		expect(net.calls[0]!.headers).not.toHaveProperty("Cookie");
	});

	it("passes through rate limits, blocks and network errors", async () => {
		net.on(MFA, { status: 429 });
		expect(await mobileVerifyMfa("garmin.com", challenge(), "1")).toMatchObject({ reason: "rate_limited" });
		net.reset();
		net.on(MFA, { status: 403 });
		expect(await mobileVerifyMfa("garmin.com", challenge(), "1")).toMatchObject({ reason: "blocked" });
		net.reset();
		net.fail(MFA);
		expect(await mobileVerifyMfa("garmin.com", challenge(), "1")).toMatchObject({ reason: "network" });
	});

	it("refuses an unsupported domain without sending the code", async () => {
		const r = await mobileVerifyMfa("evil.example", challenge(), "1");
		expect(r).toMatchObject({ kind: "error" });
		expect(JSON.stringify(r)).toContain("unsupported_domain");
		expect(net.calls).toEqual([]);
	});

	it("does not print anything to the console", async () => {
		const log = vi.spyOn(console, "log");
		net.on(MFA, status("SUCCESSFUL", { serviceTicketId: "ST-1" }));
		await mobileVerifyMfa("garmin.com", challenge(), "123456");
		expect(log).not.toHaveBeenCalled();
	});
});
