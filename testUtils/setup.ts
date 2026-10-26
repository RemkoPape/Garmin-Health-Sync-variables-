// Global test setup: browser-ish globals that Obsidian provides to plugins and that happy-dom lacks.
// Behaviour of the Obsidian API itself lives in testUtils/mocks/obsidian.ts.
import { Window } from "happy-dom";

const win = new Window();
const g = globalThis as Record<string, unknown>;

g.window = g.window ?? win;
g.document = g.document ?? win.document;
g.activeWindow = g.window;
g.activeDocument = g.document;
g.createFragment = (callback?: (el: DocumentFragment) => void): DocumentFragment => {
	const frag = win.document.createDocumentFragment() as unknown as DocumentFragment;
	callback?.(frag);
	return frag;
};

const proto = win.HTMLElement.prototype as unknown as Record<string, unknown>;
const fragProto = win.DocumentFragment.prototype as unknown as Record<string, unknown>;
proto.createEl = function (this: HTMLElement, tag: string, o?: { text?: string; cls?: string; attr?: Record<string, string> }) {
	const el = this.ownerDocument.createElement(tag);
	if (o?.text) el.textContent = o.text;
	if (o?.cls) el.className = o.cls;
	for (const [k, v] of Object.entries(o?.attr ?? {})) el.setAttribute(k, v);
	this.appendChild(el);
	return el;
};
proto.createDiv = function (this: HTMLElement, o?: { text?: string; cls?: string }) {
	return (this as unknown as { createEl: (t: string, o?: unknown) => HTMLElement }).createEl("div", o);
};
proto.createSpan = function (this: HTMLElement, o?: { text?: string; cls?: string }) {
	return (this as unknown as { createEl: (t: string, o?: unknown) => HTMLElement }).createEl("span", o);
};
proto.empty = function (this: HTMLElement) {
	this.textContent = "";
};
proto.addClass = function (this: HTMLElement, ...c: string[]) {
	this.classList.add(...c);
};
proto.removeClass = function (this: HTMLElement, ...c: string[]) {
	this.classList.remove(...c);
};
proto.toggleClass = function (this: HTMLElement, c: string, on: boolean) {
	this.classList.toggle(c, on);
};
proto.setText = function (this: HTMLElement, t: string) {
	this.textContent = t;
};
const svgProto = win.SVGElement.prototype as unknown as Record<string, unknown>;
proto.createSvg = svgProto.createSvg = function (this: HTMLElement, tag: string, o?: { cls?: string; attr?: Record<string, string> }) {
	const el = this.ownerDocument.createElementNS("http://www.w3.org/2000/svg", tag);
	if (o?.cls) el.setAttribute("class", o.cls);
	for (const [k, v] of Object.entries(o?.attr ?? {})) el.setAttribute(k, v);
	this.appendChild(el);
	return el;
};
proto.setCssProps = function (this: HTMLElement, props: Record<string, string>) {
	for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
};
proto.isShown = function () {
	return true;
};
proto.setAttr = function (this: HTMLElement, k: string, v: string) {
	this.setAttribute(k, v);
};

// ---------------------------------------------------------------------------
// Per-test hygiene
// ---------------------------------------------------------------------------
import { afterEach, beforeEach, expect, vi } from "vitest";
import { network, resetObsidianMock } from "./mocks/obsidian";

beforeEach(() => {
	resetObsidianMock();
	// The plugin logs through console.debug/warn/error; keep test output readable. Tests that assert on
	// logging spy again (and see these calls cleared by vitest's per-test mock reset).
	vi.spyOn(console, "debug").mockImplementation(() => undefined);
	vi.spyOn(console, "warn").mockImplementation(() => undefined);
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
	const unrouted = [...network.unrouted];
	vi.useRealTimers();
	// A request nobody routed would have hit the real network: fail the test even if the code swallowed the error.
	expect(unrouted, "requests with no registered route").toEqual([]);
});

// Obsidian code calls window.setTimeout and friends. happy-dom's window has its own timers, which
// vi.useFakeTimers() does not patch, so delegate to the global ones at call time.
for (const name of ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] as const) {
	(win as unknown as Record<string, unknown>)[name] = (...args: unknown[]): unknown =>
		(globalThis as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!(...args);
}

// Obsidian adds createDiv/createEl to DocumentFragment as well (used for rich notices).
fragProto.createEl = function (this: DocumentFragment, tag: string, o?: { text?: string; cls?: string }) {
	const el = win.document.createElement(tag);
	if (o?.text) el.textContent = o.text;
	if (o?.cls) el.className = o.cls;
	this.appendChild(el as unknown as Node);
	return el;
};
fragProto.createDiv = function (this: DocumentFragment, o?: { text?: string; cls?: string }) {
	return (this as unknown as { createEl: (t: string, o?: unknown) => HTMLElement }).createEl("div", o);
};
