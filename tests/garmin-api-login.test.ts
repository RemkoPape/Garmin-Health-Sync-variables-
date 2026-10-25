// Why it matters: sign-in is the one thing that must work the first time. The desktop window has many
// capture paths because Garmin hands the ticket over in different ways; each must finish the login,
// every outcome must clean up the window, and no secret may reach the diagnostics.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { Platform, network as net } from "../testUtils/mocks/obsidian";
import { FakeBrowserWindow, installElectron } from "../testUtils/fakeElectron";
import { GarminApi } from "../src/providers/garmin/garmin-api";

const PRE = /connectapi\.garmin\.com\/oauth-service\/oauth\/preauthorized/;
const EX = /connectapi\.garmin\.com\/oauth-service\/oauth\/exchange\/user\/2\.0/;
const SSO_LOGIN = /^https:\/\/sso\.garmin\.com\/mobile\/api\/login/;
const SSO_MFA = /^https:\/\/sso\.garmin\.com\/mobile\/api\/mfa\/verifyCode/;
const OAUTH2 = { access_token: "at-secret", refresh_token: "rt-secret", expires_in: 3600 };
const NOW = 1_700_000_000_000;

function routeTokens(): void {
	net.fail(/thegarth/);
	net.on(PRE, { body: "oauth_token=OT-secret&oauth_token_secret=OS-secret" });
	net.on(EX, { body: OAUTH2 });
}
const flush = (): Promise<void> => vi.advanceTimersByTimeAsync(0);
const win = (): FakeBrowserWindow => FakeBrowserWindow.instances[0]!;

let api: GarminApi;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	FakeBrowserWindow.reset();
	installElectron();
	api = new GarminApi();
	api.setVersion("0.11.1-test");
});

describe("getSigninUrl", () => {
	it("points the gauth widget at the embed service of the international region", () => {
		const url = new URL(api.getSigninUrl());
		expect(url.origin + url.pathname).toBe("https://sso.garmin.com/sso/signin");
		expect(url.searchParams.get("service")).toBe("https://sso.garmin.com/sso/embed");
		expect(url.searchParams.get("id")).toBe("gauth-widget");
		expect(url.searchParams.get("cssUrl")).toBe("https://connect.garmin.com/gauth-custom-v1.2-min.css");
	});

	it("uses the China domain after setRegion", () => {
		api.setRegion("china");
		expect(api.getSigninUrl()).toContain("https://sso.garmin.cn/sso/signin");
		expect(new URL(api.getSigninUrl()).searchParams.get("service")).toBe("https://sso.garmin.cn/sso/embed");
	});
});

describe("desktop login window", () => {
	it("is unavailable off desktop (mobile signs in with credentials)", async () => {
		Platform.isDesktopApp = false;
		expect(await api.loginViaOAuth()).toEqual({ ok: false, detail: "unsupported_platform" });
		expect(FakeBrowserWindow.instances).toEqual([]);
	});

	it("opens a sandboxed window with its own session and a plain Chrome user agent, and loads the sign-in page", async () => {
		const p = api.loginViaOAuth();
		await flush();
		expect(FakeBrowserWindow.options[0]).toMatchObject({
			show: true,
			title: "Garmin Connect Login",
			webPreferences: { nodeIntegration: false, contextIsolation: false, partition: "persist:ghs-login" },
		});
		expect(win().loadedUrl).toBe(api.getSigninUrl());
		expect(win().userAgent).toMatch(/Chrome\/137/);
		expect(win().userAgent).not.toMatch(/Electron|obsidian/i);
		expect(win().loadOptions).toEqual({ userAgent: win().userAgent });
		win().userClose();
		await p;
	});

	it.each([
		["macOS", { isMacOS: true }, /Macintosh/],
		["Linux", { isLinux: true }, /X11; Linux/],
		["Windows", {}, /Windows NT/],
	])("matches the user agent to the platform (%s)", async (_label, flags, re) => {
		Object.assign(Platform, flags);
		const p = api.loginViaOAuth();
		await flush();
		expect(win().userAgent).toMatch(re);
		win().userClose();
		await p;
	});

	it("works with the @electron/remote wrapper shape", async () => {
		installElectron("remote");
		const p = api.loginViaOAuth();
		await flush();
		expect(FakeBrowserWindow.instances).toHaveLength(1);
		win().userClose();
		await p;
	});

	describe("capturing the service ticket", () => {
		beforeEach(routeTokens);

		async function loginVia(trigger: (w: FakeBrowserWindow) => void | Promise<void>) {
			const p = api.loginViaOAuth();
			await flush();
			await trigger(win());
			await flush();
			return p;
		}

		it.each(["will-navigate", "will-redirect", "did-redirect-navigation", "did-navigate", "did-navigate-in-page", "did-start-navigation"])(
			"from the ticket parameter of a %s event",
			async (event) => {
				const result = await loginVia((w) => w.emit(event, "https://sso.garmin.com/sso/embed?ticket=ST-12345-abc"));
				expect(result.ok).toBe(true);
				expect(result.detail).toContain("via=redirect");
			},
		);

		it("from an event object that carries the url", async () => {
			const result = await loginVia((w) => w.emit("will-navigate", { url: "https://sso.garmin.com/sso/embed?ticket=ST-777-xyz" }));
			expect(result.ok).toBe(true);
		});

		it("from a bare ST- token elsewhere in the url", async () => {
			const result = await loginVia((w) => w.emit("did-navigate", "https://sso.garmin.com/done/ST-99999-zzz/ok"));
			expect(result.ok).toBe(true);
			expect(net.callsTo("preauthorized")[0]?.url).toContain("ticket=ST-99999-zzz");
		});

		it("ignores urls without a ticket, too-short tickets and unparseable urls", async () => {
			const p = api.loginViaOAuth();
			await flush();
			win().emit("will-navigate", "https://sso.garmin.com/sso/signin");
			win().emit("will-navigate", "https://sso.garmin.com/sso/embed?ticket=ST-");
			win().emit("will-navigate", "http:// not a url ST");
			win().emit("will-navigate", 42, {}, null);
			win().emit("will-navigate");
			expect(net.calls).toEqual([]);
			win().userClose();
			expect((await p).cancelled).toBe(true);
		});

		it("from the network layer: a redirect to the embed page", async () => {
			const result = await loginVia((w) =>
				w.redirectListener!({ url: "https://sso.garmin.com/sso/signin", redirectURL: "https://sso.garmin.com/sso/embed?ticket=ST-555-net", statusCode: 302 }),
			);
			expect(result.ok).toBe(true);
		});

		it("from the network layer: a completed request whose url carries the ticket", async () => {
			const result = await loginVia((w) =>
				w.completedListener!({ url: "https://sso.garmin.com/sso/embed?ticket=ST-556-done", statusCode: 200, method: "GET" }),
			);
			expect(result.ok).toBe(true);
			expect(result.detail).toContain("via=webRequest");
		});

		it("logs but ignores a completed request without a ticket", async () => {
			const p = api.loginViaOAuth();
			await flush();
			win().completedListener!({ url: "https://sso.garmin.com/sso/signin", statusCode: 403, method: "POST" });
			win().completedListener!({ url: "", statusCode: 200, method: "GET" });
			expect(net.calls).toEqual([]);
			win().userClose();
			await p;
		});

		it("from a window the widget tries to open, and denies that open", async () => {
			const result = await loginVia((w) => {
				const verdict = w.windowOpenHandler!({ url: "https://sso.garmin.com/sso/embed?ticket=ST-444-open" });
				expect(verdict).toEqual({ action: "deny" });
			});
			expect(result.ok).toBe(true);
		});

		it("denies a window open without a url", async () => {
			const p = api.loginViaOAuth();
			await flush();
			expect(win().windowOpenHandler!({})).toEqual({ action: "deny" });
			expect(win().windowOpenHandler!(undefined as never)).toEqual({ action: "deny" });
			win().userClose();
			await p;
		});

		it("from a popup the widget created, and closes that popup", async () => {
			const popup = { close: vi.fn() };
			const result = await loginVia((w) => w.emit("did-create-window", popup, { url: "https://sso.garmin.com/sso/embed?ticket=ST-333-pop" }));
			expect(result.ok).toBe(true);
			expect(popup.close).toHaveBeenCalled();
		});

		it("survives a popup that cannot be closed", async () => {
			const popup = { close: () => { throw new Error("gone"); } };
			const result = await loginVia((w) => w.emit("did-create-window", popup, { url: "https://sso.garmin.com/sso/embed?ticket=ST-334-pop" }));
			expect(result.ok).toBe(true);
		});

		it("from a postMessage mirrored into the page title", async () => {
			const result = await loginVia((w) => w.emit("page-title-updated", {}, "GHS_TICKET ST-222-msg"));
			expect(result.ok).toBe(true);
			expect(result.detail).toContain("via=postMessage");
		});

		it("ignores page titles that carry no ticket", async () => {
			const p = api.loginViaOAuth();
			await flush();
			win().emit("page-title-updated", {}, "GARMIN Authentication Application");
			win().emit("page-title-updated", {}, "GHS_TICKET without one");
			expect(net.calls).toEqual([]);
			win().userClose();
			await p;
		});

		it("from the page html after a load completes", async () => {
			FakeBrowserWindow.js = (code) => (code.includes("outerHTML") ? "ST-111-html" : "");
			const result = await loginVia((w) => w.emit("did-stop-loading"));
			expect(result.ok).toBe(true);
			expect(result.detail).toContain("via=scrape");
		});

		it("scrapes and re-installs the in-page patch on every load or navigation event", async () => {
			const p = api.loginViaOAuth();
			await flush();
			for (const ev of ["did-stop-loading", "dom-ready", "did-navigate", "did-navigate-in-page"]) win().emit(ev);
			await flush();
			const scrapes = win().executed.filter((c) => c.includes("outerHTML")).length;
			const patches = win().executed.filter((c) => c.includes("__ghsPatched")).length;
			expect(scrapes).toBe(4);
			expect(patches).toBe(4);
			win().userClose();
			await p;
		});

		it("survives scraping a window that is mid-navigation", async () => {
			FakeBrowserWindow.js = () => {
				throw new Error("Object has been destroyed");
			};
			const p = api.loginViaOAuth();
			await flush();
			win().emit("did-stop-loading");
			await flush();
			win().userClose();
			expect((await p).cancelled).toBe(true);
		});

		it("insert page padding once the dom is ready, ignoring a CSS failure", async () => {
			const p = api.loginViaOAuth();
			await flush();
			win().emit("dom-ready");
			await flush();
			expect(win().insertedCss[0]).toContain("padding");
			win().userClose();
			await p;
		});

		it("takes only the first ticket when several paths fire", async () => {
			const result = await loginVia((w) => {
				w.emit("will-navigate", "https://sso.garmin.com/sso/embed?ticket=ST-1-first");
				w.emit("will-navigate", "https://sso.garmin.com/sso/embed?ticket=ST-2-second");
			});
			expect(result.ok).toBe(true);
			expect(net.callsTo("preauthorized")).toHaveLength(1);
			expect(net.callsTo("preauthorized")[0]?.url).toContain("ST-1-first");
		});

		it("hides the window as soon as the ticket is captured, and closes it afterwards", async () => {
			await loginVia((w) => w.emit("will-navigate", "https://sso.garmin.com/sso/embed?ticket=ST-12345-abc"));
			expect(win().hidden).toBe(true);
			expect(win().destroyed).toBe(true);
			expect(win().webRequestCleared).toBeGreaterThan(0);
		});

		it("finishes the sign-in: tokens set, ready state, session valid, expiry computed", async () => {
			const result = await loginVia((w) => w.emit("will-navigate", "https://sso.garmin.com/sso/embed?ticket=ST-12345-abc"));
			expect(result.ok).toBe(true);
			expect(result.detail).toContain("oauth1 ok; oauth2 ok; expires_in=3600s");
			expect(api.isSessionValid()).toBe(true);
			expect(api.getAuthState()).toBe("ready");
			const tokens = api.getTokens();
			expect(tokens.oauth1).toEqual({ oauth_token: "OT-secret", oauth_token_secret: "OS-secret" });
			expect(tokens.oauth2?.expires_at).toBe(NOW / 1000 + 3600);
		});

		it("uses the embed service as the login url for the ticket exchange", async () => {
			await loginVia((w) => w.emit("will-navigate", "https://sso.garmin.com/sso/embed?ticket=ST-12345-abc"));
			expect(net.callsTo("preauthorized")[0]?.url).toContain("login-url=https%3A%2F%2Fsso.garmin.com%2Fsso%2Fembed");
			expect(net.callsTo("exchange")[0]?.body).toContain("audience=GARMIN_CONNECT_MOBILE_ANDROID_DI");
		});

		it("keeps the existing session when the exchange fails (no half-set state)", async () => {
			api.setTokens({ oauth_token: "old", oauth_token_secret: "old" }, null);
			net.reset();
			net.fail(/thegarth/);
			net.on(PRE, { body: "oauth_token=OT&oauth_token_secret=OS" });
			net.on(EX, { status: 500 });
			const result = await loginVia((w) => w.emit("will-navigate", "https://sso.garmin.com/sso/embed?ticket=ST-12345-abc"));
			expect(result.ok).toBe(false);
			expect(result.detail).toContain("status=500");
			expect(result.detail).toContain("0.11.1-test");
			expect(api.getTokens().oauth1?.oauth_token).toBe("old");
			expect(win().destroyed).toBe(true);
		});

		it("reports an error without a status for a failure that has none", async () => {
			net.reset();
			net.fail(/thegarth/);
			net.on(PRE, () => {
				throw new Error("handler blew up");
			});
			const result = await loginVia((w) => w.emit("will-navigate", "https://sso.garmin.com/sso/embed?ticket=ST-12345-abc"));
			expect(result.ok).toBe(false);
			expect(result.detail).toMatch(/^error status=0 /);
		});
	});

	describe("not capturing a ticket", () => {
		it("reports a deliberate close as cancelled", async () => {
			const p = api.loginViaOAuth();
			await flush();
			win().userClose();
			expect(await p).toEqual({ ok: false, detail: "cancelled", cancelled: true });
			expect(win().webRequestCleared).toBeGreaterThan(0);
			expect(net.calls).toEqual([]);
		});

		it("gives up after 120 seconds with a breadcrumb of the page it stalled on", async () => {
			FakeBrowserWindow.js = () => JSON.stringify({ url: "https://sso.garmin.com/sso/signin", title: "t", body: "b" });
			const p = api.loginViaOAuth();
			await vi.advanceTimersByTimeAsync(119_999);
			expect(win().destroyed).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			const result = await p;
			expect(result).toEqual({ ok: false, detail: "no_ticket (plugin v0.11.1-test)" });
			expect(win().destroyed).toBe(true);
		});

		it("still ends cleanly when the breadcrumb script cannot run", async () => {
			FakeBrowserWindow.js = (code) => {
				if (code.includes("innerText")) throw new Error("destroyed");
				return "";
			};
			const p = api.loginViaOAuth();
			await vi.advanceTimersByTimeAsync(120_000);
			expect((await p).ok).toBe(false);
		});

		it("does not time out after a ticket was captured", async () => {
			routeTokens();
			const p = api.loginViaOAuth();
			await flush();
			win().emit("will-navigate", "https://sso.garmin.com/sso/embed?ticket=ST-12345-abc");
			await vi.advanceTimersByTimeAsync(130_000);
			expect((await p).ok).toBe(true);
			expect(win().executed.some((c) => c.includes("innerText"))).toBe(false);
		});

		it("survives a failing page load", async () => {
			FakeBrowserWindow.loadUrlRejects = true;
			const p = api.loginViaOAuth();
			await flush();
			win().userClose();
			expect((await p).cancelled).toBe(true);
		});
	});

	describe("runtimes that lack parts of the window API", () => {
		it("falls back to navigation capture when webRequest is missing", async () => {
			routeTokens();
			FakeBrowserWindow.hasWebRequest = false;
			const p = api.loginViaOAuth();
			await flush();
			win().emit("will-navigate", "https://sso.garmin.com/sso/embed?ticket=ST-12345-abc");
			expect((await p).ok).toBe(true);
		});

		it("falls back when registering webRequest throws over the remote proxy", async () => {
			routeTokens();
			FakeBrowserWindow.throwOnWebRequest = true;
			const p = api.loginViaOAuth();
			await flush();
			win().emit("will-navigate", "https://sso.garmin.com/sso/embed?ticket=ST-12345-abc");
			expect((await p).ok).toBe(true);
		});

		it("carries on when the window-open handler or the user agent cannot be set", async () => {
			routeTokens();
			FakeBrowserWindow.throwOnWindowOpenHandler = true;
			FakeBrowserWindow.throwOnSetUserAgent = true;
			const p = api.loginViaOAuth();
			await flush();
			win().emit("will-navigate", "https://sso.garmin.com/sso/embed?ticket=ST-12345-abc");
			expect((await p).ok).toBe(true);
		});

		it("survives removing the network listeners from a session that is already gone", async () => {
			routeTokens();
			const p = api.loginViaOAuth();
			await flush();
			FakeBrowserWindow.throwOnClear = true;
			win().emit("will-navigate", "https://sso.garmin.com/sso/embed?ticket=ST-12345-abc");
			expect((await p).ok).toBe(true);
		});
	});

	describe("forwarding the login page's diagnostics", () => {
		it("logs GHS_DIAG lines with the ticket redacted, from positional or object arguments", async () => {
			const debug = vi.spyOn(console, "debug");
			const p = api.loginViaOAuth();
			await flush();
			win().emit("console-message", 1, "GHS_DIAG window.open -> in-place ST-SECRET-123", 0, "");
			win().emit("console-message", { message: "GHS_DIAG form.submit ST-SECRET-456" });
			win().emit("console-message", { message: "unrelated" });
			win().emit("console-message", "nothing relevant");
			const logged = debug.mock.calls.map((c) => c.join(" ")).filter((l) => l.includes("login-page diag"));
			expect(logged).toHaveLength(2);
			expect(logged.join("\n")).not.toContain("ST-SECRET");
			expect(logged.join("\n")).toContain("ST-<redacted>");
			win().userClose();
			await p;
		});
	});

	describe("one window at a time, and cleanup", () => {
		it("shares a single window and result between concurrent calls", async () => {
			routeTokens();
			const a = api.loginViaOAuth();
			const b = api.loginViaOAuth();
			await flush();
			expect(FakeBrowserWindow.instances).toHaveLength(1);
			win().emit("will-navigate", "https://sso.garmin.com/sso/embed?ticket=ST-12345-abc");
			const [ra, rb] = await Promise.all([a, b]);
			expect(ra).toBe(rb);
			expect(ra.ok).toBe(true);
		});

		it("allows a new login after the previous one ended", async () => {
			const first = api.loginViaOAuth();
			await flush();
			win().userClose();
			await first;
			const second = api.loginViaOAuth();
			await flush();
			expect(FakeBrowserWindow.instances).toHaveLength(2);
			FakeBrowserWindow.instances[1]!.userClose();
			await second;
		});

		it("closeActiveLogin closes an open window (plugin unload) and is a no-op otherwise", async () => {
			api.closeActiveLogin();
			const p = api.loginViaOAuth();
			await flush();
			api.closeActiveLogin();
			expect(win().destroyed).toBe(true);
			expect((await p).cancelled).toBe(true);
			api.closeActiveLogin();
		});

		it("closeActiveLogin ignores a window that is already destroyed or cannot close", async () => {
			const p = api.loginViaOAuth();
			await flush();
			win().close = () => {
				throw new Error("cannot close");
			};
			expect(() => api.closeActiveLogin()).not.toThrow();
			win().userClose();
			await p;
		});
	});
});

describe("the in-page scripts, executed in a DOM", () => {
	async function captureScripts(): Promise<{ scrape: string; patch: string }> {
		const p = api.loginViaOAuth();
		await flush();
		const executed: string[] = [];
		const w = win();
		w.emit("did-stop-loading");
		executed.push(...w.executed);
		w.userClose();
		await p;
		return {
			scrape: executed.find((c) => c.includes("outerHTML"))!,
			patch: executed.find((c) => c.includes("__ghsPatched"))!,
		};
	}

	function page(url: string, html: string): Window {
		const w = new Window({ url });
		w.document.write(html);
		return w;
	}

	it("scrapeJs finds the ticket parameter in the url", async () => {
		const { scrape } = await captureScripts();
		const w = page("https://sso.garmin.com/sso/embed?ticket=ST-abc-123", "<html><body>x</body></html>");
		expect(w.eval(scrape)).toBe("ST-abc-123");
	});

	it("scrapeJs finds a ticket in the page html, including the raw JSON form", async () => {
		const { scrape } = await captureScripts();
		const link = page("https://sso.garmin.com/sso/signin", '<a href="embed?ticket=ST-link-1">go</a>');
		expect(link.eval(scrape)).toBe("ST-link-1");
		const json = page("https://sso.garmin.com/sso/signin", "<pre>{serviceUrl: 'x', serviceTicket: 'ST-json-2'}</pre>");
		expect(json.eval(scrape)).toBe("ST-json-2");
	});

	it("scrapeJs returns nothing when there is no ticket, or the ticket parameter is not a ticket", async () => {
		const { scrape } = await captureScripts();
		expect(page("https://sso.garmin.com/sso/signin", "<p>sign in</p>").eval(scrape)).toBe("");
		expect(page("https://sso.garmin.com/x?ticket=nope", "<p>sign in</p>").eval(scrape)).toBe("");
	});

	it("patchJs strips target attributes, rewires window.open and installs only once", async () => {
		const { patch } = await captureScripts();
		const w = page("https://sso.garmin.com/sso/signin", '<a id="a" href="/x" target="_blank">x</a><form id="f" target="_blank"></form>');
		const doc = w.document;
		w.eval(patch);
		expect(doc.getElementById("a")?.getAttribute("target")).toBeNull();
		expect(doc.getElementById("f")?.getAttribute("target")).toBeNull();
		expect((w as unknown as { __ghsPatched: boolean }).__ghsPatched).toBe(true);
		const open = (w as unknown as { open: unknown }).open;
		w.eval(patch);
		expect((w as unknown as { open: unknown }).open).toBe(open);
		expect((w as unknown as { open: (u: string) => null }).open("https://sso.garmin.com/sso/embed?ticket=ST-1")).toBeNull();
	});

	it("patchJs mirrors a postMessage that carries a ticket into the title", async () => {
		const { patch } = await captureScripts();
		const w = page("https://sso.garmin.com/sso/signin", "<p>x</p>");
		w.eval(patch);
		w.dispatchEvent(Object.assign(new w.Event("message"), { data: { serviceTicket: "ST-msg-7" } }));
		expect(w.document.title).toBe("GHS_TICKET ST-msg-7");
	});
});

describe("credential login (mobile)", () => {
	beforeEach(() => {
		Platform.isDesktopApp = false;
		Platform.isMobileApp = true;
		Platform.isIosApp = true;
		net.fail(/thegarth/);
	});

	it("signs in with email and password, trimming the email", async () => {
		net.on(SSO_LOGIN, { body: { responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: "ST-cred-1" } });
		net.on(PRE, { body: "oauth_token=OT&oauth_token_secret=OS" });
		net.on(EX, { body: OAUTH2 });
		expect(await api.loginWithCredentials("  me@example.com ", "pw")).toEqual({ status: "ok" });
		expect(JSON.parse(net.callsTo("mobile/api/login")[0]!.body as string).username).toBe("me@example.com");
		expect(api.isSessionValid()).toBe(true);
		expect(api.getAuthState()).toBe("ready");
	});

	it("exchanges the ticket against the mobile service, not the embed page", async () => {
		net.on(SSO_LOGIN, { body: { responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: "ST-cred-1" } });
		net.on(PRE, { body: "oauth_token=OT&oauth_token_secret=OS" });
		net.on(EX, { body: OAUTH2 });
		await api.loginWithCredentials("a", "b");
		expect(net.callsTo("preauthorized")[0]!.url).toContain("login-url=https%3A%2F%2Fmobile.integration.garmin.com%2Fgcm%2Fios");
	});

	it("asks for a code when two-step verification is on, then completes with it", async () => {
		net.on(SSO_LOGIN, { body: { responseStatus: { type: "MFA_REQUIRED" }, customerMfaInfo: { mfaLastMethodUsed: "sms" } }, headers: { "set-cookie": "SESSION=abc" } });
		net.on(SSO_MFA, { body: { responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: "ST-mfa-1" } });
		net.on(PRE, { body: "oauth_token=OT&oauth_token_secret=OS&mfa_token=MFA-1" });
		net.on(EX, { body: OAUTH2 });
		expect(await api.loginWithCredentials("a", "b")).toEqual({ status: "mfa", method: "sms" });
		expect(api.isSessionValid()).toBe(false);
		expect(await api.completeMfaLogin("123456")).toEqual({ status: "ok" });
		expect(net.callsTo("verifyCode")[0]!.headers?.["Cookie"]).toBe("SESSION=abc");
		expect(net.callsTo("exchange")[0]!.body).toContain("mfa_token=MFA-1");
		expect(api.getTokens().oauth1?.mfa_token).toBe("MFA-1");
	});

	it("allows retrying a wrong code, and a successful retry clears the pending challenge", async () => {
		net.on(SSO_LOGIN, { body: { responseStatus: { type: "MFA_REQUIRED" } }, headers: { "set-cookie": "SESSION=abc" } });
		let attempts = 0;
		net.on(SSO_MFA, () =>
			++attempts === 1
				? { body: { responseStatus: { type: "MFA_CODE_INVALID" } } }
				: { body: { responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: "ST-mfa-2" } },
		);
		net.on(PRE, { body: "oauth_token=OT&oauth_token_secret=OS" });
		net.on(EX, { body: OAUTH2 });
		await api.loginWithCredentials("a", "b");
		expect(await api.completeMfaLogin("000000")).toMatchObject({ status: "error", reason: "mfa_failed" });
		expect(await api.completeMfaLogin("123456")).toEqual({ status: "ok" });
		expect(await api.completeMfaLogin("again")).toEqual({ status: "error", reason: "unexpected", detail: "no_pending_mfa" });
	});

	it("refuses a code when no challenge is pending", async () => {
		expect(await api.completeMfaLogin("123456")).toEqual({ status: "error", reason: "unexpected", detail: "no_pending_mfa" });
	});

	it("forgets a pending challenge when a new login starts", async () => {
		net.on(SSO_LOGIN, { body: { responseStatus: { type: "MFA_REQUIRED" } } });
		await api.loginWithCredentials("a", "b");
		net.reset();
		net.fail(/thegarth/);
		net.on(SSO_LOGIN, { body: { responseStatus: { type: "INVALID_USERNAME_PASSWORD" } } });
		await api.loginWithCredentials("a", "wrong");
		expect(await api.completeMfaLogin("123456")).toMatchObject({ detail: "no_pending_mfa" });
	});

	it.each([
		["invalid_credentials", { body: { responseStatus: { type: "INVALID_USERNAME_PASSWORD" } } }],
		["captcha", { body: { responseStatus: { type: "CAPTCHA_REQUIRED" } } }],
		["blocked", { status: 403 }],
		["rate_limited", { status: 429 }],
	])("reports %s with the redacted step log", async (reason, reply) => {
		net.on(SSO_LOGIN, reply);
		const out = await api.loginWithCredentials("me@example.com", "hunter2-pw");
		expect(out).toMatchObject({ status: "error", reason });
		const detail = (out as { detail: string }).detail;
		expect(detail).toContain("plugin v0.11.1-test, platform=ios, region=garmin.com");
		expect(detail).not.toContain("hunter2-pw");
		expect(detail).not.toContain("me@example.com");
	});

	it("passes Garmin's Retry-After on to the caller", async () => {
		net.on(SSO_LOGIN, { status: 429, headers: { "retry-after": "90" } });
		expect(await api.loginWithCredentials("a", "b")).toMatchObject({ reason: "rate_limited", retryAfter: 90 });
	});

	it("reports a rejected ticket exchange as exchange_failed, and a 429 there as rate limited", async () => {
		net.on(SSO_LOGIN, { body: { responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: "ST-cred-1" } });
		net.on(PRE, { status: 500 });
		expect(await api.loginWithCredentials("a", "b")).toMatchObject({ status: "error", reason: "exchange_failed" });
		net.reset();
		net.fail(/thegarth/);
		net.on(SSO_LOGIN, { body: { responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: "ST-cred-1" } });
		net.on(PRE, { status: 429 });
		expect(await api.loginWithCredentials("a", "b")).toMatchObject({ status: "error", reason: "rate_limited" });
		expect(api.isSessionValid()).toBe(false);
	});

	it("reports a failure that is not an HTTP error without a status", async () => {
		net.on(SSO_LOGIN, { body: { responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: "ST-cred-1" } });
		net.on(PRE, { body: "garbage" });
		const out = await api.loginWithCredentials("a", "b");
		expect(out).toMatchObject({ status: "error", reason: "exchange_failed" });
	});

	it("turns an unexpected crash into an error whose log has the type and message but never the password", async () => {
		net.on(SSO_LOGIN, () => {
			throw new Error("boom with context");
		});
		net.on(/./, () => {
			throw new Error("boom with context");
		});
		const out = await api.loginWithCredentials("a", "topsecret");
		expect(out).toMatchObject({ status: "error", reason: "network" });
		expect(api.getLoginDiagnostics()).not.toContain("topsecret");
	});

	it("turns an exception escaping the MFA step into an unexpected error", async () => {
		net.on(SSO_LOGIN, { body: { responseStatus: { type: "MFA_REQUIRED" } } });
		await api.loginWithCredentials("a", "b");
		const challenge = (api as unknown as { pendingMfa: { cookies: unknown } }).pendingMfa;
		challenge.cookies = null;
		const out = await api.completeMfaLogin("123456");
		expect(out).toMatchObject({ status: "error", reason: "unexpected" });
		expect((out as { detail: string }).detail).toContain("unexpected error:");
	});

	it("turns an exception escaping the password step into an unexpected error", async () => {
		const out = await api.loginWithCredentials(undefined as never, "pw");
		expect(out).toMatchObject({ status: "error", reason: "unexpected" });
		expect((out as { detail: string }).detail).toContain("unexpected error: TypeError");
		const crash = await api.loginWithCredentials({ trim: () => { throw "plain string"; } } as never, "pw");
		expect((crash as { detail: string }).detail).toContain("unexpected error: error: plain string");
	});

	it("keeps the diagnostics free of tokens and tickets", async () => {
		net.on(SSO_LOGIN, { body: { responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: "ST-cred-SECRET" } });
		net.on(PRE, { body: "oauth_token=OT-SECRET&oauth_token_secret=OS-SECRET" });
		net.on(EX, { body: OAUTH2 });
		await api.loginWithCredentials("a", "b");
		const log = api.getLoginDiagnostics();
		for (const secret of ["ST-cred-SECRET", "OT-SECRET", "OS-SECRET", "at-secret", "rt-secret"]) expect(log).not.toContain(secret);
		expect(log).toContain("ticket received");
		expect(log.split("\n").length).toBeLessThanOrEqual(90);
	});

	it("labels the platform in the log (android, desktop, other)", async () => {
		net.on(SSO_LOGIN, { status: 403 });
		Object.assign(Platform, { isIosApp: false, isAndroidApp: true });
		await api.loginWithCredentials("a", "b");
		expect(api.getLoginDiagnostics()).toContain("platform=android");
		Object.assign(Platform, { isAndroidApp: false, isDesktopApp: true });
		await api.loginWithCredentials("a", "b");
		expect(api.getLoginDiagnostics()).toContain("platform=desktop");
		Object.assign(Platform, { isDesktopApp: false });
		await api.loginWithCredentials("a", "b");
		expect(api.getLoginDiagnostics()).toContain("platform=other");
	});

	it("starts with an unknown plugin version when none was set", async () => {
		const fresh = new GarminApi();
		net.on(SSO_LOGIN, { status: 403 });
		await fresh.loginWithCredentials("a", "b");
		expect(fresh.getLoginDiagnostics()).toContain("plugin v?");
	});

	it("uses the China domain for the sign-in", async () => {
		api.setRegion("china");
		net.on(/sso\.garmin\.cn\/mobile\/api\/login/, { body: { responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: "ST-cn" } });
		net.on(/connectapi\.garmin\.cn.*preauthorized/, { body: "oauth_token=OT&oauth_token_secret=OS" });
		net.on(/connectapi\.garmin\.cn.*exchange/, { body: OAUTH2 });
		expect(await api.loginWithCredentials("a", "b")).toEqual({ status: "ok" });
	});
});

describe("manual ticket login", () => {
	beforeEach(() => {
		net.fail(/thegarth/);
		net.on(PRE, { body: "oauth_token=OT&oauth_token_secret=OS" });
		net.on(EX, { body: OAUTH2 });
	});

	it.each([
		["a bare ticket", "ST-1234567-abcdef"],
		["the embed url", "https://sso.garmin.com/sso/embed?ticket=ST-1234567-abcdef"],
		["the success JSON", '{"serviceUrl":"x","serviceTicket":"ST-1234567-abcdef"}'],
		["text around it", "  here you go: ST-1234567-abcdef  thanks"],
	])("accepts %s", async (_label, input) => {
		expect(await api.loginWithTicket(input)).toMatchObject({ ok: true });
		expect(net.callsTo("preauthorized")[0]!.url).toContain("ticket=ST-1234567-abcdef");
		expect(api.getAuthState()).toBe("ready");
	});

	it("rejects input without a ticket and calls nothing", async () => {
		expect(await api.loginWithTicket("hello")).toEqual({ ok: false, detail: "no_ticket_in_input" });
		expect(net.calls).toEqual([]);
	});

	it("reports an exchange failure with its status and the plugin version, leaving the session alone", async () => {
		net.reset();
		net.fail(/thegarth/);
		net.on(PRE, { status: 401 });
		const out = await api.loginWithTicket("ST-1234567-abcdef");
		expect(out.ok).toBe(false);
		expect(out.detail).toContain("status=401");
		expect(out.detail).toContain("0.11.1-test");
		expect(api.isSessionValid()).toBe(false);
	});

	it("reports a failure without a status", async () => {
		net.reset();
		net.fail(/thegarth/);
		net.on(PRE, () => {
			throw "plain";
		});
		const out = await api.loginWithTicket("ST-1234567-abcdef");
		expect(out.ok).toBe(false);
	});
});
