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
import { parse, stringify } from "yaml";

export { moment };

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

const PLATFORM_DEFAULTS = {
	isMobile: false,
	isMobileApp: false,
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

	getFiles(): TFile[] {
		return [...this.files.values()];
	}

	private attach(item: TAbstractFile, path: string): void {
		item.path = path;
		item.name = path.slice(path.lastIndexOf("/") + 1);
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

	async modify(file: TFile, content: string): Promise<void> {
		this.check("modify", file.path);
		this.setContent(file, content);
		this.log.push({ op: "modify", path: file.path });
		this.emit("modify", file);
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
	static recorded: { message: string; duration?: number; hidden: boolean }[] = [];
	private entry: { message: string; duration?: number; hidden: boolean };
	constructor(message: string, duration?: number) {
		this.entry = { message, duration, hidden: false };
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
// App and plugin shells
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

export class App {
	vault = new Vault();
	secretStorage: SecretStorageFake | undefined = new SecretStorageFake();
	local = new Map<string, unknown>();
	loadLocalStorage(key: string): unknown {
		return this.local.has(key) ? this.local.get(key) : null;
	}
	saveLocalStorage(key: string, value: unknown): void {
		this.local.set(key, value);
	}
}

export class Plugin {
	app: App;
	constructor(app: App = new App()) {
		this.app = app;
	}
}

export class PluginSettingTab {
	app: App;
	plugin: unknown;
	containerEl: HTMLElement = document.createElement("div");
	constructor(app: App, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
	}
}

export class Modal {
	app: App;
	contentEl: HTMLElement = document.createElement("div");
	constructor(app: App) {
		this.app = app;
	}
	open(): void {}
	close(): void {}
}

export class Setting {
	constructor(public containerEl: HTMLElement) {}
}

export class ButtonComponent {}

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
		headers: reply.headers ?? {},
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
	network.reset();
}
