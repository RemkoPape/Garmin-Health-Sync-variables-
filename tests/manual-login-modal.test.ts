// Why it matters: this dialog is the backup sign-in. It handles a one-time ticket that expires in seconds,
// on phones where the keyboard covers half the screen and the clipboard may be blocked. Every outcome must
// leave the user able to continue.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, Notice, Platform } from "../testUtils/mocks/obsidian";
import { ManualLoginModal } from "../src/ui/manual-login-modal";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";

const URL_ = "https://sso.garmin.com/sso/signin?x=1";
const TICKET = "ST-1234567-abcdefgh";

function open(onSubmit: (input: string) => Promise<boolean> = () => Promise.resolve(true), lang = "en") {
	const modal = new ManualLoginModal(new App() as never, lang, URL_, onSubmit);
	modal.open();
	const root = modal.contentEl;
	const button = (text: string): HTMLButtonElement => [...root.querySelectorAll("button")].find((b) => b.textContent === text)!;
	const field = root.querySelector("input")!;
	const type = (value: string): void => {
		field.value = value;
		field.dispatchEvent(new window.Event("input"));
	};
	const preview = (): HTMLElement => root.querySelector(".ghs-ticket-preview")!;
	return { modal, root, button, field, type, preview };
}
const clipboard = (impl: { writeText?: unknown; readText?: unknown }): void => {
	Object.defineProperty(navigator, "clipboard", { value: impl, configurable: true });
};
const isOpen = (m: unknown): boolean => (m as { isOpen: boolean }).isOpen;
const keydown = (el: HTMLElement, key: string): void => {
	el.dispatchEvent(Object.assign(new window.Event("keydown", { cancelable: true }), { key }));
};

beforeEach(() => {
	clipboard({ writeText: vi.fn().mockResolvedValue(undefined), readText: vi.fn().mockResolvedValue("") });
});

describe("layout", () => {
	it("shows the title, the intro, the three steps and a ticket preview that starts empty", () => {
		const { root, preview } = open();
		expect(root.querySelector("h2")?.textContent).toBe(en.modalManualLoginTitle);
		expect(root.querySelector("p")?.textContent).toBe(en.modalManualLoginIntro);
		expect([...root.querySelectorAll("ol li")].map((li) => li.textContent)).toEqual([
			en.modalManualLoginStep1,
			en.modalManualLoginStep2,
			en.modalManualLoginStep3,
		]);
		expect(preview().textContent).toBe(en.modalManualLoginTicketNone);
		expect(preview().classList.contains("is-found")).toBe(false);
		expect(root.classList.contains("ghs-modal")).toBe(true);
	});

	it("uses the touch wording for step three on mobile", () => {
		Platform.isDesktopApp = false;
		expect(open().root.querySelectorAll("li")[2]?.textContent).toBe(en.modalManualLoginStep3Mobile);
	});

	it("speaks the user's language", () => {
		expect(open(undefined, "de").root.querySelector("h2")?.textContent).toBe(de.modalManualLoginTitle);
	});

	it("keeps the ticket exactly as typed: no autocorrect or capitalisation", () => {
		const { field } = open();
		expect(field.getAttribute("autocapitalize")).toBe("off");
		expect(field.getAttribute("autocorrect")).toBe("off");
		expect(field.spellcheck).toBe(false);
		expect(field.enterKeyHint).toBe("go");
		expect(field.placeholder).toBe(en.modalManualLoginTicketPlaceholder);
	});

	it("empties itself when closed", () => {
		const { modal, root } = open();
		modal.close();
		expect(root.children).toHaveLength(0);
	});
});

describe("the ticket preview", () => {
	it("shows the start of a ticket found in the text and marks it", () => {
		const { type, preview } = open();
		type(`https://sso.garmin.com/sso/embed?ticket=${TICKET}`);
		expect(preview().textContent).toBe(en.modalManualLoginTicketFound.replace("{ticket}", `${TICKET.slice(0, 14)}…`));
		expect(preview().classList.contains("is-found")).toBe(true);
	});

	it("goes back to 'none' when the text no longer has a ticket", () => {
		const { type, preview } = open();
		type(TICKET);
		type("nothing");
		expect(preview().textContent).toBe(en.modalManualLoginTicketNone);
		expect(preview().classList.contains("is-found")).toBe(false);
	});
});

describe("the browser link", () => {
	it("opens the sign-in page in the active window (the one the dialog is in, also a pop-out)", () => {
		const openActive = vi.fn();
		const openMain = vi.fn();
		(window as unknown as { open: unknown }).open = openMain;
		const original = (globalThis as unknown as { activeWindow: unknown }).activeWindow;
		(globalThis as unknown as { activeWindow: unknown }).activeWindow = { open: openActive };
		try {
			open().button(en.modalManualLoginOpenButton).click();
		} finally {
			(globalThis as unknown as { activeWindow: unknown }).activeWindow = original;
		}
		expect(openActive).toHaveBeenCalledWith(URL_);
		expect(openMain).not.toHaveBeenCalled();
	});

	it("copies the link and says so", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		clipboard({ writeText });
		const { root } = open();
		const extra = root.querySelectorAll<HTMLElement>(".setting-item")[0]!.lastElementChild!.lastElementChild as HTMLElement;
		extra.click();
		await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_));
		await vi.waitFor(() => expect(Notice.recorded.map((n) => n.message)).toEqual([en.modalManualLoginCopied]));
	});

	it("C8: a blocked clipboard is reported instead of failing silently", async () => {
		clipboard({ writeText: vi.fn().mockRejectedValue(new Error("blocked")) });
		const unhandled = vi.fn();
		process.on("unhandledRejection", unhandled);
		const { root } = open();
		const extra = root.querySelectorAll<HTMLElement>(".setting-item")[0]!.lastElementChild!.lastElementChild as HTMLElement;
		extra.click();
		await vi.waitFor(() => expect(Notice.recorded.map((n) => n.message)).toEqual([en.modalManualLoginCopyFailed]));
		await new Promise((r) => setTimeout(r, 0));
		process.off("unhandledRejection", unhandled);
		expect(unhandled).not.toHaveBeenCalled();
	});
});

describe("submitting a ticket", () => {
	it("sends the trimmed text on the Log in button and closes the dialog on success", async () => {
		const onSubmit = vi.fn().mockResolvedValue(true);
		const { modal, type, button } = open(onSubmit);
		type(`  ${TICKET}  `);
		button(en.modalManualLoginSubmit).click();
		await vi.waitFor(() => expect(isOpen(modal)).toBe(false));
		expect(onSubmit).toHaveBeenCalledWith(TICKET);
	});

	it("also submits on Enter and keeps the Enter key from doing anything else", async () => {
		const onSubmit = vi.fn().mockResolvedValue(true);
		const { field, type } = open(onSubmit);
		type(TICKET);
		const ev = Object.assign(new window.Event("keydown", { cancelable: true }), { key: "Enter" });
		field.dispatchEvent(ev);
		expect(ev.defaultPrevented).toBe(true);
		await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith(TICKET));
		keydown(field, "a");
		expect(onSubmit).toHaveBeenCalledOnce();
	});

	it("ignores an empty field and whitespace", async () => {
		const onSubmit = vi.fn().mockResolvedValue(true);
		const { button, type } = open(onSubmit);
		button(en.modalManualLoginSubmit).click();
		type("   ");
		button(en.modalManualLoginSubmit).click();
		await Promise.resolve();
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("keeps the dialog open when the ticket is refused, and lets the user try again", async () => {
		const onSubmit = vi.fn().mockResolvedValue(false);
		const { modal, type, button } = open(onSubmit);
		type(TICKET);
		button(en.modalManualLoginSubmit).click();
		await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
		expect(isOpen(modal)).toBe(true);
		button(en.modalManualLoginSubmit).click();
		await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
	});

	it("does not send a ticket twice while the first request is still running", async () => {
		let finish: (ok: boolean) => void = () => undefined;
		const onSubmit = vi.fn().mockReturnValue(new Promise<boolean>((resolve) => (finish = resolve)));
		const { type, button } = open(onSubmit);
		type(TICKET);
		button(en.modalManualLoginSubmit).click();
		button(en.modalManualLoginSubmit).click();
		await Promise.resolve();
		expect(onSubmit).toHaveBeenCalledOnce();
		finish(false);
		await new Promise((r) => setTimeout(r, 0));
		button(en.modalManualLoginSubmit).click();
		await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
	});

	it("allows another attempt after the submit handler failed", async () => {
		const onSubmit = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(true);
		const handler = vi.fn();
		process.on("unhandledRejection", handler);
		const { type, button, modal } = open(onSubmit);
		type(TICKET);
		button(en.modalManualLoginSubmit).click();
		await new Promise((r) => setTimeout(r, 0));
		process.off("unhandledRejection", handler);
		button(en.modalManualLoginSubmit).click();
		await vi.waitFor(() => expect(isOpen(modal)).toBe(false));
	});
});

describe("the clipboard button", () => {
	it("reads the ticket from the clipboard, shows it and submits it", async () => {
		const onSubmit = vi.fn().mockResolvedValue(true);
		clipboard({ readText: vi.fn().mockResolvedValue(`ticket=${TICKET}`) });
		const { button, preview, modal } = open(onSubmit);
		const previewEl = preview();
		button(en.modalManualLoginPasteButton).click();
		await vi.waitFor(() => expect(isOpen(modal)).toBe(false));
		expect(onSubmit).toHaveBeenCalledWith(`ticket=${TICKET}`);
		expect(previewEl.classList.contains("is-found")).toBe(true);
	});

	it("points to the field when the clipboard cannot be read", async () => {
		clipboard({ readText: vi.fn().mockRejectedValue(new Error("blocked")) });
		const onSubmit = vi.fn();
		const { button } = open(onSubmit);
		button(en.modalManualLoginPasteButton).click();
		await vi.waitFor(() => expect(Notice.recorded.map((n) => n.message)).toEqual([en.modalManualLoginClipboardBlocked]));
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("says so when the clipboard holds no ticket, and submits nothing", async () => {
		clipboard({ readText: vi.fn().mockResolvedValue("just some text") });
		const onSubmit = vi.fn();
		const { button, preview } = open(onSubmit);
		button(en.modalManualLoginPasteButton).click();
		await vi.waitFor(() => expect(Notice.recorded.map((n) => n.message)).toEqual([en.modalManualLoginPasteEmpty]));
		expect(onSubmit).not.toHaveBeenCalled();
		expect(preview().textContent).toBe(en.modalManualLoginTicketNone);
	});

	it("is the primary button", () => {
		expect(open().button(en.modalManualLoginPasteButton).classList.contains("mod-cta")).toBe(true);
	});
});
