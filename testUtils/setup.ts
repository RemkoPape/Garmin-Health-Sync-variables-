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
proto.setAttr = function (this: HTMLElement, k: string, v: string) {
	this.setAttribute(k, v);
};
