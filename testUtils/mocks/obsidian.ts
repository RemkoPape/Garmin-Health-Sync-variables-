// In-memory stand-in for the `obsidian` package, which ships only type definitions.
//
// Fidelity notes: normalizePath, the vault's create/read/modify rules and the requestUrl response
// shape (lazy `.json` that throws on an empty or invalid body) follow Obsidian's documented
// behaviour. YAML output comes from the `yaml` package and is not guaranteed byte-identical to
// Obsidian's, so frontmatter tests assert structure and the manual smoke test covers the real
// thing. The semantics here were reconstructed, not captured: testUtils/fixtures/obsidian-golden.json
// (plan 1.5b) is the place to pin values read from a real Obsidian.
import type { TFile as ObsidianTFile } from "obsidian";
import moment from "moment";
import "moment/locale/de";
import "moment/locale/zh-cn";
import { parse, stringify } from "yaml";

// Importing a locale file also switches the global locale to it; Obsidian runs in English unless the user changes it.
moment.locale("en");

export { moment };

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

const PLATFORM_DEFAULTS = {
	isMobile: false,
	isMobileApp: false,
	isPhone: false,
	isTablet: false,
	isDesktop: true,
	isDesktopApp: true,
	isIosApp: false,
	isAndroidApp: false,
	isMacOS: false,
	isLinux: false,
	isWin: true,
};
export const Platform = { ...PLATFORM_DEFAULTS };

// ---------------------------------------------------------------------------
// Paths and YAML
// ---------------------------------------------------------------------------

export function normalizePath(path: string): string {
	let p = path.replace(/[  ]/g, " ").normalize("NFC");
	p = p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
	return p === "" ? "/" : p;
}

export function parseYaml(text: string): unknown {
	return parse(text);
}

export function stringifyYaml(value: unknown): string {
	return stringify(value);
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

export class TAbstractFile {
	path = "";
	name = "";
	parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
	basename = "";
	extension = "md";
	stat = { size: 0, ctime: 0, mtime: 0 };
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
}

type VaultListener = (file: TAbstractFile) => void;

export class Vault {
	/** Every write, in order, for assertions: "create" | "modify" | "createFolder". */
	readonly log: { op: "create" | "modify" | "createFolder"; path: string }[] = [];
	private readonly files = new Map<string, TFile>();
	private readonly contents = new Map<string, string>();
	private readonly folders = new Map<string, TFolder>();
	private readonly listeners: Record<string, VaultListener[]> = {};
	readonly root = new TFolder();
	/** Hook to make the next operation fail: return an Error to throw it. */
	failOn: ((op: string, path: string) => Error | null) | null = null;

	constructor() {
		this.root.path = "/";
		this.root.name = "";
		this.folders.set("/", this.root);
	}

	on(name: "create" | "modify" | "delete" | "rename", cb: VaultListener): { name: string; cb: VaultListener } {
		(this.listeners[name] ??= []).push(cb);
		return { name, cb };
	}

	/** Test helper: deliver an event to the listeners, e.g. for a folder, which the mock itself never announces. */
	fire(name: "create" | "modify" | "delete" | "rename", file: TAbstractFile): void {
		this.emit(name, file);
	}

	private emit(name: string, file: TAbstractFile): void {
		for (const cb of this.listeners[name] ?? []) cb(file);
	}

	private check(op: string, path: string): void {
		const err = this.failOn?.(op, path);
		if (err) throw err;
	}

	getAbstractFileByPath(path: string): TAbstractFile | null {
		if (path === "/") return this.root;
		return this.files.get(path) ?? this.folders.get(path) ?? null;
	}

	getMarkdownFiles(): TFile[] {
		return this.getFiles().filter((f) => f.extension === "md");
	}

	getFiles(): TFile[] {
		return [...this.files.values()];
	}

	private attach(item: TAbstractFile, path: string): void {
		item.path = path;
		item.name = path.slice(path.lastIndexOf("/") + 1);
		if (item instanceof TFile) item.basename = item.name.replace(/\.[^.]*$/, "");
		const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/";
		const parent = this.folders.get(parentPath);
		if (!parent) throw new Error(`Parent folder does not exist: ${parentPath}`);
		item.parent = parent;
		parent.children.push(item);
	}

	async createFolder(path: string): Promise<TFolder> {
		this.check("createFolder", path);
		if (this.folders.has(path) || this.files.has(path)) throw new Error("Folder already exists.");
		const folder = new TFolder();
		this.attach(folder, path);
		this.folders.set(path, folder);
		this.log.push({ op: "createFolder", path });
		return folder;
	}

	async create(path: string, content: string): Promise<TFile> {
		this.check("create", path);
		if (this.files.has(path) || this.folders.has(path)) throw new Error("File already exists.");
		const file = new TFile();
		this.attach(file, path);
		file.extension = path.slice(path.lastIndexOf(".") + 1);
		this.files.set(path, file);
		this.setContent(file, content);
		this.log.push({ op: "create", path });
		this.emit("create", file);
		return file;
	}

	async read(file: TFile): Promise<string> {
		this.check("read", file.path);
		return this.contents.get(file.path) ?? "";
	}

	/** Obsidian's cached read: the same text, without hitting the disk again. */
	async cachedRead(file: TFile): Promise<string> {
		return this.read(file);
	}

	async modify(file: TFile, content: string): Promise<void> {
		this.check("modify", file.path);
		this.setContent(file, content);
		this.log.push({ op: "modify", path: file.path });
		this.emit("modify", file);
	}

	/** Atomic read-modify-write like Obsidian's: `fn` sees the CURRENT content and returns the new content. */
	async process(file: TFile, fn: (data: string) => string): Promise<string> {
		this.check("process", file.path);
		const next = fn(this.contents.get(file.path) ?? "");
		this.setContent(file, next);
		this.log.push({ op: "modify", path: file.path });
		this.emit("modify", file);
		return next;
	}

	/** Test helper: change a file behind the plugin's back (the user typing in an open note), without a write log. */
	overwrite(path: string, content: string): void {
		const file = this.files.get(path);
		if (!file) throw new Error(`no such file in the test vault: ${path}`);
		this.setContent(file, content);
	}

	private setContent(file: TFile, content: string): void {
		this.contents.set(file.path, content);
		file.stat = { size: new TextEncoder().encode(content).length, ctime: 0, mtime: 0 };
	}

	// ---- test helpers (not part of Obsidian's API) ----

	/** Seed a file (and its parent folders) without logging or emitting events. */
	seed(path: string, content: string): ObsidianTFile {
		const parts = path.split("/");
		let current = "";
		for (const part of parts.slice(0, -1)) {
			current = current ? `${current}/${part}` : part;
			if (!this.folders.has(current)) {
				const folder = new TFolder();
				this.attach(folder, current);
				this.folders.set(current, folder);
			}
		}
		const file = new TFile();
		this.attach(file, path);
		file.extension = path.slice(path.lastIndexOf(".") + 1);
		this.files.set(path, file);
		this.setContent(file, content);
		// Typed as the real TFile so tests can hand it to code under test; at runtime it is the mock class.
		return file as unknown as ObsidianTFile;
	}

	/** Current content of a seeded or written file; throws if it does not exist. */
	text(path: string): string {
		const content = this.contents.get(path);
		if (content === undefined) throw new Error(`no such file in the test vault: ${path}`);
		return content;
	}

	/** Paths of every file, sorted. */
	paths(): string[] {
		return [...this.files.keys()].sort();
	}

	/** Number of modify calls so far (a dirty-check regression shows up here). */
	modifyCount(): number {
		return this.log.filter((l) => l.op === "modify").length;
	}
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

export class Notice {
	static recorded: { message: string; duration?: number; hidden: boolean; fragment?: DocumentFragment }[] = [];
	private entry: { message: string; duration?: number; hidden: boolean; fragment?: DocumentFragment };
	constructor(message: string | DocumentFragment, duration?: number) {
		const isText = typeof message === "string";
		this.entry = { message: isText ? message : (message.textContent ?? ""), duration, hidden: false, ...(isText ? {} : { fragment: message }) };
		Notice.recorded.push(this.entry);
	}
	hide(): void {
		this.entry.hidden = true;
	}
	/** Messages shown so far (test helper). */
	static messages(): string[] {
		return Notice.recorded.map((n) => n.message);
	}
}

// ---------------------------------------------------------------------------
// App, workspace and plugin shells
// ---------------------------------------------------------------------------

export class SecretStorageFake {
	store = new Map<string, string>();
	/** When set, getSecret returns this instead of the stored value ("write accepted, reads back differently"). */
	readOverride: ((id: string, stored: string | null) => string | null) | null = null;
	throwOnSet = false;
	throwOnGet = false;
	getSecret(id: string): string | null {
		if (this.throwOnGet) throw new Error("getSecret failed");
		const stored = this.store.get(id) ?? null;
		return this.readOverride ? this.readOverride(id, stored) : stored;
	}
	setSecret(id: string, value: string): void {
		if (this.throwOnSet) throw new Error("setSecret failed");
		this.store.set(id, value);
	}
}

type WorkspaceListener = (...args: unknown[]) => void;

export class WorkspaceLeaf {
	view: ItemView | null = null;
	viewType = "";
	constructor(private readonly app: App) {}
	setViewState(state: { type: string }): Promise<void> {
		this.viewType = state.type;
		const factory = this.app.workspace.viewFactories.get(state.type);
		this.view = factory ? factory(this) : null;
		this.app.workspace.leaves.push(this);
		return Promise.resolve();
	}
	detach(): void {
		const i = this.app.workspace.leaves.indexOf(this);
		if (i >= 0) this.app.workspace.leaves.splice(i, 1);
		this.view?.onClose();
	}
}

export abstract class ItemView {
	app: App;
	contentEl: HTMLElement = document.createElement("div");
	containerEl: HTMLElement = document.createElement("div");
	events: { name: string }[] = [];
	constructor(public leaf: WorkspaceLeaf) {
		this.app = (leaf as unknown as { app: App }).app;
	}
	abstract getViewType(): string;
	abstract getDisplayText(): string;
	getIcon(): string {
		return "";
	}
	registerEvent(ref: { name: string }): void {
		this.events.push(ref);
	}
	onOpen(): Promise<void> {
		return Promise.resolve();
	}
	onClose(): Promise<void> {
		return Promise.resolve();
	}
}

export function setIcon(el: HTMLElement, icon: string): void {
	el.setAttribute("data-icon", icon);
}

export class Workspace {
	activeFile: TFile | null = null;
	leaves: WorkspaceLeaf[] = [];
	viewFactories = new Map<string, (leaf: WorkspaceLeaf) => ItemView>();
	/** What getRightLeaf returns; tests set it to null to model a layout with no right sidebar. */
	rightLeafAvailable = true;
	revealed: WorkspaceLeaf[] = [];
	getRightLeaf(): WorkspaceLeaf | null {
		return this.rightLeafAvailable ? new WorkspaceLeaf(this.app) : null;
	}
	getLeavesOfType(type: string): WorkspaceLeaf[] {
		return this.leaves.filter((l) => l.viewType === type);
	}
	detachLeavesOfType(type: string): void {
		for (const leaf of this.getLeavesOfType(type)) leaf.detach();
	}
	revealLeaf(leaf: WorkspaceLeaf): Promise<void> {
		this.revealed.push(leaf);
		return Promise.resolve();
	}
	constructor(public app: App) {}
	private readyCallbacks: (() => void)[] = [];
	private listeners: Record<string, WorkspaceListener[]> = {};
	onLayoutReady(cb: () => void): void {
		this.readyCallbacks.push(cb);
	}
	on(name: string, cb: WorkspaceListener): { name: string } {
		(this.listeners[name] ??= []).push(cb);
		return { name };
	}
	getActiveFile(): TFile | null {
		return this.activeFile;
	}
	// ---- test helpers ----
	/** Obsidian finished loading the layout: run the callbacks registered with onLayoutReady. */
	layoutReady(): void {
		for (const cb of this.readyCallbacks.splice(0)) cb();
	}
	fire(name: string, ...args: unknown[]): void {
		for (const cb of this.listeners[name] ?? []) cb(...args);
	}
}

export class MetadataCache {
	frontmatter = new Map<string, Record<string, unknown>>();
	private listeners: ((file: TFile) => void)[] = [];
	getFileCache(file: TFile): { frontmatter?: Record<string, unknown> } | null {
		const fm = this.frontmatter.get(file.path);
		return fm ? { frontmatter: fm } : null;
	}
	on(_name: "changed", cb: (file: TFile) => void): { name: string } {
		this.listeners.push(cb);
		return { name: "changed" };
	}
	/** Test helper: deliver a "changed" event. */
	fireChanged(file: TFile): void {
		for (const cb of this.listeners) cb(file);
	}
}

export class App {
	vault = new Vault();
	metadataCache = new MetadataCache();
	workspace = new Workspace(this);
	secretStorage: SecretStorageFake | undefined = new SecretStorageFake();
	local = new Map<string, unknown>();
	/** Obsidian's command registry (not in the typings): records what was executed. */
	commands = {
		executed: [] as string[],
		executeCommandById(id: string): boolean {
			this.executed.push(id);
			return true;
		},
	};
	/** Set by tests to exercise the Periodic Notes / Daily Notes auto-detection. */
	plugins: { plugins: Record<string, unknown> } | undefined = undefined;
	internalPlugins: { plugins: Record<string, unknown> } | undefined = undefined;
	loadLocalStorage(key: string): unknown {
		return this.local.has(key) ? this.local.get(key) : null;
	}
	saveLocalStorage(key: string, value: unknown): void {
		this.local.set(key, value);
	}
}

export interface Command {
	id: string;
	name: string;
	callback?: () => void;
}

export class Plugin {
	app: App;
	manifest: { version: string };
	/** What loadData returns and saveData stores (a copy, like data.json on disk). */
	data: unknown = null;
	saves = 0;
	commands = new Map<string, Command>();
	settingTabs: unknown[] = [];
	events: unknown[] = [];
	constructor(app: App = new App(), manifest: { version: string } = { version: "0.0.0-test" }) {
		this.app = app;
		this.manifest = manifest;
	}
	loadData(): Promise<unknown> {
		return Promise.resolve(this.data === null ? null : (JSON.parse(JSON.stringify(this.data)) as unknown));
	}
	saveData(data: unknown): Promise<void> {
		this.saves++;
		this.data = JSON.parse(JSON.stringify(data));
		return Promise.resolve();
	}
	addCommand(command: Command): Command {
		this.commands.set(command.id, command);
		return command;
	}
	addSettingTab(tab: unknown): void {
		this.settingTabs.push(tab);
	}
	registerEvent(ref: unknown): void {
		this.events.push(ref);
	}
	cleanups: (() => void)[] = [];
	register(cleanup: () => void): void {
		this.cleanups.push(cleanup);
	}
	/** Obsidian runs what was registered when the plugin unloads. */
	unload(): void {
		for (const cleanup of this.cleanups) cleanup();
	}
	registerView(type: string, factory: (leaf: WorkspaceLeaf) => ItemView): void {
		this.app.workspace.viewFactories.set(type, factory);
	}
	ribbonIcons: { icon: string; title: string; callback: () => void }[] = [];
	addRibbonIcon(icon: string, title: string, callback: () => void): void {
		this.ribbonIcons.push({ icon, title, callback });
	}
}

export class PluginSettingTab {
	app: App;
	plugin: unknown;
	containerEl: HTMLElement = document.createElement("div");
	updates = 0;
	constructor(app: App, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
	}
	update(): void {
		this.updates++;
	}
}

// ---------------------------------------------------------------------------
// Modal and the Setting components (DOM-backed, enough for the plugin's own screens)
// ---------------------------------------------------------------------------

export class Modal {
	static opened: Modal[] = [];
	app: App;
	contentEl: HTMLElement = document.createElement("div");
	modalEl: HTMLElement = document.createElement("div");
	isOpen = false;
	constructor(app: App) {
		this.app = app;
		// Obsidian's own close icon: a click ends in close(), like Escape and a click outside.
		const closeButton = document.createElement("div");
		closeButton.className = "modal-close-button";
		closeButton.addEventListener("click", () => this.close());
		this.modalEl.appendChild(closeButton);
	}
	onOpen(): void {}
	onClose(): void {}
	open(): void {
		this.isOpen = true;
		Modal.opened.push(this);
		this.onOpen();
	}
	close(): void {
		if (!this.isOpen) return;
		this.isOpen = false;
		this.onClose();
	}
}

type Listener = () => void | Promise<void>;

export class ButtonComponent {
	buttonEl: HTMLButtonElement;
	tooltip = "";
	constructor(containerEl: HTMLElement) {
		this.buttonEl = document.createElement("button");
		containerEl.appendChild(this.buttonEl);
	}
	setButtonText(text: string): this {
		this.buttonEl.textContent = text;
		return this;
	}
	setCta(): this {
		this.buttonEl.classList.add("mod-cta");
		return this;
	}
	setTooltip(tooltip: string): this {
		this.tooltip = tooltip;
		return this;
	}
	setDisabled(disabled: boolean): this {
		this.buttonEl.disabled = disabled;
		return this;
	}
	onClick(cb: Listener): this {
		this.buttonEl.addEventListener("click", () => void cb());
		return this;
	}
}

export class ExtraButtonComponent {
	extraSettingsEl: HTMLElement;
	icon = "";
	tooltip = "";
	constructor(containerEl: HTMLElement) {
		this.extraSettingsEl = document.createElement("div");
		containerEl.appendChild(this.extraSettingsEl);
	}
	setIcon(icon: string): this {
		this.icon = icon;
		return this;
	}
	setTooltip(tooltip: string): this {
		this.tooltip = tooltip;
		return this;
	}
	onClick(cb: Listener): this {
		this.extraSettingsEl.addEventListener("click", () => void cb());
		return this;
	}
}

export class TextComponent {
	inputEl: HTMLInputElement;
	constructor(containerEl: HTMLElement) {
		this.inputEl = document.createElement("input");
		containerEl.appendChild(this.inputEl);
	}
	setValue(value: string): this {
		this.inputEl.value = value;
		return this;
	}
	getValue(): string {
		return this.inputEl.value;
	}
	setPlaceholder(text: string): this {
		this.inputEl.placeholder = text;
		return this;
	}
	onChange(cb: (value: string) => void): this {
		this.inputEl.addEventListener("input", () => cb(this.inputEl.value));
		return this;
	}
	/** Test helper: type into the field the way a user would. */
	type(value: string): void {
		this.inputEl.value = value;
		this.inputEl.dispatchEvent(new window.Event("input"));
	}
}

export class Setting {
	static all: Setting[] = [];
	settingEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;
	controlEl: HTMLElement;
	buttons: ButtonComponent[] = [];
	extraButtons: ExtraButtonComponent[] = [];
	texts: TextComponent[] = [];
	constructor(public containerEl: HTMLElement) {
		this.settingEl = document.createElement("div");
		this.settingEl.classList.add("setting-item");
		const info = document.createElement("div");
		this.nameEl = document.createElement("div");
		this.descEl = document.createElement("div");
		this.controlEl = document.createElement("div");
		info.append(this.nameEl, this.descEl);
		this.settingEl.append(info, this.controlEl);
		containerEl.appendChild(this.settingEl);
		Setting.all.push(this);
	}
	setName(name: string): this {
		this.nameEl.textContent = name;
		return this;
	}
	setDesc(desc: string): this {
		this.descEl.textContent = desc;
		return this;
	}
	setClass(cls: string): this {
		this.settingEl.classList.add(cls);
		return this;
	}
	addButton(cb: (b: ButtonComponent) => unknown): this {
		const b = new ButtonComponent(this.controlEl);
		this.buttons.push(b);
		cb(b);
		return this;
	}
	addExtraButton(cb: (b: ExtraButtonComponent) => unknown): this {
		const b = new ExtraButtonComponent(this.controlEl);
		this.extraButtons.push(b);
		cb(b);
		return this;
	}
	addText(cb: (t: TextComponent) => unknown): this {
		const t = new TextComponent(this.controlEl);
		this.texts.push(t);
		cb(t);
		return this;
	}
}

// ---------------------------------------------------------------------------
// requestUrl
// ---------------------------------------------------------------------------

export interface RequestUrlParam {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string | ArrayBuffer;
	contentType?: string;
	throw?: boolean;
}

export interface RequestUrlResponse {
	status: number;
	headers: Record<string, string>;
	text: string;
	json: unknown;
	arrayBuffer: ArrayBuffer;
}

export interface MockReply {
	status?: number;
	/** JSON-serialised unless it is a string. `undefined` = empty body. */
	body?: unknown;
	headers?: Record<string, string>;
	/** Deliver a response without any headers object (`undefined`), as some platform HTTP stacks might. */
	noHeaders?: boolean;
	/** Reading `.json` throws this (e.g. a string, to exercise non-Error handling). */
	jsonError?: unknown;
}

type Responder = MockReply | ((req: RequestUrlParam) => MockReply | Promise<MockReply>);
type Matcher = string | RegExp | ((req: RequestUrlParam) => boolean);

/**
 * Router for requestUrl. Register routes in the test; any request that matches none is recorded in
 * `network.unrouted`, throws, and fails the test in testUtils/setup.ts (no accidental real network).
 */
export const network = {
	routes: [] as { match: Matcher; respond: Responder | "network-error"; message?: string }[],
	calls: [] as RequestUrlParam[],
	unrouted: [] as string[],
	reset(): void {
		this.routes = [];
		this.calls = [];
		this.unrouted = [];
	},
	/** Reply to requests whose URL equals / matches / satisfies `match`. First registered route wins. */
	on(match: Matcher, respond: Responder): void {
		this.routes.push({ match, respond });
	},
	/** Make matching requests reject like a network failure. */
	fail(match: Matcher, message = "net::ERR_FAILED"): void {
		this.routes.push({ match, respond: "network-error", message });
	},
	/** Requests whose URL contains `fragment`. */
	callsTo(fragment: string): RequestUrlParam[] {
		return this.calls.filter((c) => c.url.includes(fragment));
	},
};

function matches(m: Matcher, req: RequestUrlParam): boolean {
	if (typeof m === "string") return req.url === m || req.url.startsWith(m);
	if (m instanceof RegExp) return m.test(req.url);
	return m(req);
}

function buildResponse(reply: MockReply): RequestUrlResponse {
	const status = reply.status ?? 200;
	const text = reply.body === undefined ? "" : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
	const response = {
		status,
		headers: reply.noHeaders ? undefined : (reply.headers ?? {}),
		text,
		arrayBuffer: new TextEncoder().encode(text).buffer as ArrayBuffer,
	} as RequestUrlResponse;
	// Obsidian parses lazily: reading `.json` on an empty or invalid body throws.
	Object.defineProperty(response, "json", {
		get(): unknown {
			if (reply.jsonError !== undefined) throw reply.jsonError;
			return JSON.parse(text);
		},
	});
	return response;
}

export async function requestUrl(request: RequestUrlParam | string): Promise<RequestUrlResponse> {
	const req: RequestUrlParam = typeof request === "string" ? { url: request } : request;
	network.calls.push(req);
	const route = network.routes.find((r) => matches(r.match, req));
	if (!route) {
		network.unrouted.push(`${req.method ?? "GET"} ${req.url}`);
		throw new Error(`requestUrl: unrouted request ${req.method ?? "GET"} ${req.url}`);
	}
	if (route.respond === "network-error") throw new Error(route.message ?? "net::ERR_FAILED");
	const reply = typeof route.respond === "function" ? await route.respond(req) : route.respond;
	const response = buildResponse(reply);
	// Like Obsidian: non-2xx rejects unless the caller passed throw: false.
	if (req.throw !== false && (response.status < 200 || response.status >= 300)) {
		const err = new Error(`Request failed, status ${response.status}`) as Error & { status: number };
		err.status = response.status;
		throw err;
	}
	return response;
}

// ---------------------------------------------------------------------------
// Reset between tests (called from testUtils/setup.ts)
// ---------------------------------------------------------------------------

export function resetObsidianMock(): void {
	Object.assign(Platform, PLATFORM_DEFAULTS);
	Notice.recorded = [];
	Modal.opened = [];
	Setting.all = [];
	network.reset();
}
