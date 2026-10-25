// Why it matters: this dialog takes the user's Garmin password. It must send it once per attempt and
// keep nothing, never let a double click or Enter fire two sign-ins (Garmin rate-limits), show the right
// message for every refusal, enforce the cooldown, and always leave a way out.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, Notice } from "../testUtils/mocks/obsidian";
import { CredentialLoginModal, type CredentialLoginHandlers } from "../src/ui/credential-login-modal";
import type { CredentialLoginOutcome } from "../src/providers/garmin/garmin-api";
import { en } from "../src/i18n/en";

interface Setup {
	modal: CredentialLoginModal;
	root: HTMLElement;
	handlers: CredentialLoginHandlers & { login: ReturnType<typeof vi.fn>; verifyMfa: ReturnType<typeof vi.fn>; onSuccess: ReturnType<typeof vi.fn>; onBrowserFallback: ReturnType<typeof vi.fn>; onClosed: ReturnType<typeof vi.fn> };
	cooldown: { left: number; blocks: (number | undefined)[]; resets: number };
	fields: () => HTMLInputElement[];
	type: (index: number, value: string) => void;
	button: (text: string) => HTMLButtonElement | undefined;
	primary: () => HTMLButtonElement;
	text: () => string;
}

function open(outcome: CredentialLoginOutcome | (() => Promise<CredentialLoginOutcome>) = { status: "ok" }, cooldownLeft = 0): Setup {
	const cooldown = { left: cooldownLeft, blocks: [] as (number | undefined)[], resets: 0 };
	const run = typeof outcome === "function" ? outcome : () => Promise.resolve(outcome);
	const handlers = {
		login: vi.fn().mockImplementation(run),
		verifyMfa: vi.fn().mockImplementation(run),
		onSuccess: vi.fn().mockResolvedValue(undefined),
		onBrowserFallback: vi.fn(),
		onClosed: vi.fn(),
		getDiagnostics: () => "the step log",
		cooldown: {
			remainingSeconds: () => cooldown.left,
			registerBlock: (r?: number) => {
				cooldown.blocks.push(r);
				cooldown.left = 300; // like the real cooldown: a block starts a wait
				return 300;
			},
			reset: () => {
				cooldown.resets++;
			},
		},
	};
	const modal = new CredentialLoginModal(new App() as never, "en", handlers);
	modal.open();
	const root = modal.contentEl;
	return {
		modal,
		root,
		handlers,
		cooldown,
		fields: () => [...root.querySelectorAll("input")],
		type: (i, v) => {
			const f = [...root.querySelectorAll("input")][i]!;
			f.value = v;
			f.dispatchEvent(new window.Event("input"));
		},
		button: (text) => [...root.querySelectorAll("button")].find((b) => b.textContent === text),
		primary: () => root.querySelector("button.mod-cta") as HTMLButtonElement,
		text: () => root.textContent ?? "",
	};
}
const settle = async (): Promise<void> => {
	await vi.advanceTimersByTimeAsync(0);
	await vi.advanceTimersByTimeAsync(0);
};
async function signIn(s: Setup, email = "me@example.com", password = "pw"): Promise<void> {
	s.type(0, email);
	s.type(1, password);
	s.primary().click();
	await settle();
}
const isOpen = (m: unknown): boolean => (m as { isOpen: boolean }).isOpen;
const keydown = (el: HTMLElement, key: string): Event => {
	const ev = Object.assign(new window.Event("keydown", { cancelable: true }), { key });
	el.dispatchEvent(ev);
	return ev;
};

beforeEach(() => {
	vi.useFakeTimers();
});

describe("the sign-in form", () => {
	it("asks for email and password, with browser-friendly input hints", () => {
		const { root, fields } = open();
		expect(root.querySelector("h2")?.textContent).toBe(en.modalCredTitle);
		expect(root.querySelector("p")?.textContent).toBe(en.modalCredIntro);
		const [email, password] = fields();
		expect(email!.type).toBe("email");
		expect(email!.autocomplete).toBe("username");
		expect(email!.getAttribute("autocapitalize")).toBe("off");
		expect(email!.spellcheck).toBe(false);
		expect(password!.type).toBe("password");
		expect(password!.autocomplete).toBe("current-password");
		expect(password!.enterKeyHint).toBe("go");
		expect(root.classList.contains("ghs-modal")).toBe(true);
	});

	it("offers the browser login as an alternative", () => {
		expect(open().button(en.modalCredBrowserFallback)).toBeDefined();
	});

	it("sends the credentials once, shows progress on the button, and does not take a second click meanwhile", async () => {
		let finish: (o: CredentialLoginOutcome) => void = () => undefined;
		const s = open(() => new Promise((resolve) => (finish = resolve)));
		s.type(0, "me@example.com");
		s.type(1, "pw");
		const cta = s.primary();
		cta.click();
		expect(cta.disabled).toBe(true);
		expect(cta.textContent).toBe(en.modalCredBusy);
		cta.click();
		keydown(s.fields()[1]!, "Enter");
		expect(s.handlers.login).toHaveBeenCalledOnce();
		expect(s.handlers.login).toHaveBeenCalledWith("me@example.com", "pw");
		finish({ status: "ok" });
		await settle();
	});

	it("submits on Enter in the password field and stops the Enter from doing anything else", async () => {
		const s = open();
		s.type(0, "a@b.c");
		s.type(1, "pw");
		const password = s.fields()[1]!;
		expect(keydown(password, "x").defaultPrevented).toBe(false);
		const ev = keydown(password, "Enter");
		expect(ev.defaultPrevented).toBe(true);
		await settle();
		expect(s.handlers.login).toHaveBeenCalledOnce();
	});

	it.each([
		["no email", "", "pw"],
		["a blank email", "   ", "pw"],
		["no password", "a@b.c", ""],
	])("does nothing with %s", async (_label, email, password) => {
		const s = open();
		s.type(0, email);
		s.type(1, password);
		s.primary().click();
		await settle();
		expect(s.handlers.login).not.toHaveBeenCalled();
	});

	it("waits while the cooldown is running, with the button disabled and the time shown", () => {
		const s = open({ status: "ok" }, 95);
		expect(s.primary().disabled).toBe(true);
		expect(s.text()).toContain(en.modalCredCooldown.replace("{time}", "1:35"));
		s.type(0, "a@b.c");
		s.type(1, "pw");
		keydown(s.fields()[1]!, "Enter");
		expect(s.handlers.login).not.toHaveBeenCalled();
	});

	it("counts down every second and enables the button when the wait is over", async () => {
		const s = open({ status: "ok" }, 3);
		s.cooldown.left = 2;
		await vi.advanceTimersByTimeAsync(1000);
		expect(s.text()).toContain("0:02");
		s.cooldown.left = 0;
		await vi.advanceTimersByTimeAsync(1000);
		expect(s.primary().disabled).toBe(false);
		expect(s.text()).not.toContain("Next attempt");
		s.cooldown.left = 5;
		await vi.advanceTimersByTimeAsync(5000);
		expect(s.text()).not.toContain("0:05");
	});

	it("stops the countdown when the dialog closes", async () => {
		const s = open({ status: "ok" }, 60);
		s.modal.close();
		s.cooldown.left = 0;
		const before = s.root.children.length;
		await vi.advanceTimersByTimeAsync(5000);
		expect(s.root.children.length).toBe(before);
		expect(s.handlers.onClosed).toHaveBeenCalledOnce();
	});
});

describe("outcomes", () => {
	it("success: resets the cooldown, runs the post-login step and closes", async () => {
		const s = open({ status: "ok" });
		await signIn(s);
		expect(s.cooldown.resets).toBe(1);
		expect(s.handlers.onSuccess).toHaveBeenCalledOnce();
		expect(isOpen(s.modal)).toBe(false);
		expect(s.handlers.onClosed).toHaveBeenCalledOnce();
	});

	it("success: a failing post-login step is logged and does not look like a failed sign-in", async () => {
		const s = open({ status: "ok" });
		s.handlers.onSuccess.mockRejectedValue(new Error("save failed"));
		await signIn(s);
		expect(isOpen(s.modal)).toBe(false);
		expect(console.error).toHaveBeenCalled();
	});

	it("wrong password: back to the form with the message, email kept, password cleared", async () => {
		const s = open({ status: "error", reason: "invalid_credentials", detail: "x" });
		await signIn(s, "me@example.com", "wrong");
		expect(s.text()).toContain(en.modalCredErrorInvalid);
		expect(s.fields()[0]!.value).toBe("me@example.com");
		expect(s.fields()[1]!.value).toBe("");
		s.type(1, "right");
		s.primary().click();
		await settle();
		expect(s.handlers.login).toHaveBeenLastCalledWith("me@example.com", "right");
	});

	it("two-step verification: asks for the code, checks it, and closes on success", async () => {
		const s = open({ status: "mfa", method: "email" });
		await signIn(s);
		expect(s.root.querySelector("h2")?.textContent).toBe(en.modalCredMfaTitle);
		expect(s.fields()[0]!.inputMode).toBe("numeric");
		expect(s.fields()[0]!.autocomplete).toBe("one-time-code");
		s.handlers.verifyMfa.mockResolvedValue({ status: "ok" });
		s.type(0, "123456");
		s.primary().click();
		await settle();
		expect(s.handlers.verifyMfa).toHaveBeenCalledWith("123456");
		expect(isOpen(s.modal)).toBe(false);
	});

	it("two-step verification: an empty code is ignored, a wrong code shows the message and asks again", async () => {
		const s = open({ status: "mfa", method: "email" });
		await signIn(s);
		s.primary().click();
		s.type(0, "  ");
		s.primary().click();
		await settle();
		expect(s.handlers.verifyMfa).not.toHaveBeenCalled();
		s.handlers.verifyMfa.mockResolvedValue({ status: "error", reason: "mfa_failed", detail: "x" });
		s.type(0, "000000");
		s.primary().click();
		await settle();
		expect(s.text()).toContain(en.modalCredErrorMfa);
		expect(s.root.querySelector("h2")?.textContent).toBe(en.modalCredMfaTitle);
	});

	it("two-step verification: does not take a second click while the first runs", async () => {
		const s = open({ status: "mfa", method: "email" });
		await signIn(s);
		let finish: (o: CredentialLoginOutcome) => void = () => undefined;
		s.handlers.verifyMfa.mockReturnValue(new Promise((resolve) => (finish = resolve)));
		s.type(0, "123456");
		s.primary().click();
		s.primary().click();
		expect(s.handlers.verifyMfa).toHaveBeenCalledOnce();
		finish({ status: "ok" });
		await settle();
	});

	it.each([
		["blocked", en.modalCredErrorBlocked],
		["captcha", en.modalCredErrorBlocked],
		["rate_limited", en.modalCredErrorRateLimited],
	])("%s: starts the cooldown (with Garmin's Retry-After) and shows the failure screen", async (reason, message) => {
		const s = open({ status: "error", reason, detail: "x", retryAfter: 90 } as CredentialLoginOutcome);
		await signIn(s);
		expect(s.cooldown.blocks).toEqual([90]);
		expect(s.text()).toContain(message);
		expect(s.button(en.modalCredBrowserFallback)!.classList.contains("mod-cta")).toBe(true);
	});

	it.each(["unexpected", "network", "exchange_failed"])("%s: the generic message, no cooldown", async (reason) => {
		const s = open({ status: "error", reason, detail: "x" } as CredentialLoginOutcome);
		await signIn(s);
		expect(s.text()).toContain(en.modalCredErrorGeneric);
		expect(s.cooldown.blocks).toEqual([]);
	});

	it("a crash in the sign-in handler shows the generic failure and frees the button", async () => {
		const s = open(() => Promise.reject(new Error("boom")));
		await signIn(s);
		expect(s.text()).toContain(en.modalCredErrorGeneric);
		expect(console.error).toHaveBeenCalled();
		s.button(en.modalCredRetry)!.click();
		expect(s.root.querySelector("h2")?.textContent).toBe(en.modalCredTitle);
	});

	it("a crash that arrives after the dialog was dismissed starts no countdown", async () => {
		let fail: (e: Error) => void = () => undefined;
		const s = open(() => new Promise((_, reject) => (fail = reject)), 0);
		s.type(0, "a@b.c");
		s.type(1, "pw");
		s.primary().click();
		s.modal.close();
		s.cooldown.left = 60;
		fail(new Error("late"));
		await settle();
		await vi.advanceTimersByTimeAsync(3000);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("renders nothing for an outcome that arrives after the dialog was dismissed", async () => {
		let finish: (o: CredentialLoginOutcome) => void = () => undefined;
		const s = open(() => new Promise((resolve) => (finish = resolve)));
		s.type(0, "a@b.c");
		s.type(1, "pw");
		s.primary().click();
		s.modal.close();
		finish({ status: "error", reason: "invalid_credentials", detail: "x" });
		await settle();
		expect(s.root.children).toHaveLength(0);
	});
});

describe("the failure screen", () => {
	async function failed(): Promise<Setup> {
		const s = open({ status: "error", reason: "unexpected", detail: "x" });
		await signIn(s);
		return s;
	}

	it("leaves the dialog and opens the browser login", async () => {
		const s = await failed();
		s.button(en.modalCredBrowserFallback)!.click();
		expect(isOpen(s.modal)).toBe(false);
		expect(s.handlers.onBrowserFallback).toHaveBeenCalledOnce();
	});

	it("from the form, the browser login does the same", () => {
		const s = open();
		s.button(en.modalCredBrowserFallback)!.click();
		expect(isOpen(s.modal)).toBe(false);
		expect(s.handlers.onBrowserFallback).toHaveBeenCalledOnce();
	});

	it("goes back to the form on 'try again'", async () => {
		const s = await failed();
		s.button(en.modalCredRetry)!.click();
		expect(s.root.querySelector("h2")?.textContent).toBe(en.modalCredTitle);
		expect(s.fields()).toHaveLength(2);
	});

	it("disables 'try again' with a countdown while a cooldown runs", async () => {
		const s = open({ status: "error", reason: "rate_limited", detail: "x" });
		await signIn(s);
		expect(s.button(en.modalCredRetry)!.disabled).toBe(true);
		expect(s.text()).toContain("5:00");
		s.cooldown.left = 0;
		await vi.advanceTimersByTimeAsync(1000);
		expect(s.button(en.modalCredRetry)!.disabled).toBe(false);
	});

	it("copies the diagnostics and confirms", async () => {
		const s = await failed();
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
		s.button(en.modalCredCopyDiagnostics)!.click();
		await settle();
		expect(writeText).toHaveBeenCalledWith("the step log");
		expect(Notice.recorded.map((n) => n.message)).toEqual([en.modalCredDiagnosticsCopied]);
	});

	it("shows the diagnostics in a selectable field when the clipboard is blocked", async () => {
		const s = await failed();
		Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) }, configurable: true });
		s.button(en.modalCredCopyDiagnostics)!.click();
		await settle();
		const area = s.root.querySelector("textarea")!;
		expect(area.value || area.textContent).toBe("the step log");
		expect(area.readOnly).toBe(true);
		expect(Number(area.rows)).toBe(6);
		expect(area.classList.contains("ghs-diagnostics")).toBe(true);
		expect(Notice.recorded).toEqual([]);
	});

	it("has no diagnostics button on the form itself, only on the failure screen", async () => {
		const s = open();
		expect(s.button(en.modalCredCopyDiagnostics)).toBeUndefined();
	});
});

describe("closing", () => {
	it("empties itself and tells the caller", () => {
		const s = open();
		s.modal.close();
		expect(s.root.children).toHaveLength(0);
		expect(s.handlers.onClosed).toHaveBeenCalledOnce();
	});

	it("works without an onClosed callback", () => {
		const modal = new CredentialLoginModal(new App() as never, "en", {
			login: () => Promise.resolve({ status: "ok" }),
			verifyMfa: () => Promise.resolve({ status: "ok" }),
			onSuccess: () => Promise.resolve(),
			onBrowserFallback: () => undefined,
			getDiagnostics: () => "",
			cooldown: { remainingSeconds: () => 0, registerBlock: () => 0, reset: () => undefined },
		});
		modal.open();
		expect(() => modal.close()).not.toThrow();
	});
});
