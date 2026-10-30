// A scriptable stand-in for Electron's BrowserWindow, installed through window.require("electron").
// Handlers registered by the code under test are recorded so a test can fire any event.
type Handler = (...args: unknown[]) => void;

export class FakeBrowserWindow {
	static instances: FakeBrowserWindow[] = [];
	static options: object[] = [];
	/** What executeJavaScript resolves to, by call; defaults to "". Receives the code. */
	static js: (code: string) => unknown | Promise<unknown> = () => "";
	/** Set false to simulate a runtime without a settable window-open handler / webRequest. */
	static hasWebRequest = true;
	static throwOnWebRequest = false;
	static throwOnWindowOpenHandler = false;
	static throwOnSetUserAgent = false;
	static loadUrlRejects = false;
	static throwOnClear = false;
	static insertCssRejects = false;
	static reset(): void {
		FakeBrowserWindow.instances = [];
		FakeBrowserWindow.options = [];
		FakeBrowserWindow.js = () => "";
		FakeBrowserWindow.hasWebRequest = true;
		FakeBrowserWindow.throwOnWebRequest = false;
		FakeBrowserWindow.throwOnWindowOpenHandler = false;
		FakeBrowserWindow.throwOnSetUserAgent = false;
		FakeBrowserWindow.loadUrlRejects = false;
		FakeBrowserWindow.throwOnClear = false;
		FakeBrowserWindow.insertCssRejects = false;
	}

	readonly handlers: Record<string, Handler[]> = {};
	readonly windowHandlers: Record<string, Handler[]> = {};
	destroyed = false;
	hidden = false;
	shown = false;
	loadedUrl = "";
	loadOptions: unknown;
	userAgent = "";
	insertedCss: string[] = [];
	executed: string[] = [];
	windowOpenHandler: ((d: { url?: string }) => { action: string }) | null = null;
	redirectListener: ((d: { url: string; redirectURL: string; statusCode: number }) => void) | null = null;
	completedListener: ((d: { url: string; statusCode: number; method: string }) => void) | null = null;
	webRequestCleared = 0;
	closeCalls = 0;

	readonly webContents: Record<string, unknown>;

	constructor(options: object) {
		FakeBrowserWindow.instances.push(this);
		FakeBrowserWindow.options.push(options);
		const self = this;
		const session = {
			webRequest: {
				onBeforeRedirect: (filter: unknown, listener?: FakeBrowserWindow["redirectListener"]) => {
					if (FakeBrowserWindow.throwOnWebRequest) throw new Error("remote proxy");
					if (filter === null) {
						if (FakeBrowserWindow.throwOnClear) throw new Error("session already gone");
						self.webRequestCleared++;
					}
					self.redirectListener = listener ?? null;
				},
				onCompleted: (filter: unknown, listener?: FakeBrowserWindow["completedListener"]) => {
					if (filter === null) self.webRequestCleared++;
					self.completedListener = listener ?? null;
				},
			},
		};
		this.webContents = {
			executeJavaScript: (code: string) => {
				self.executed.push(code);
				try {
					return Promise.resolve(FakeBrowserWindow.js(code));
				} catch (e) {
					return Promise.reject(e); // like Electron: a destroyed window rejects, it does not throw
				}
			},
			getURL: () => self.loadedUrl,
			insertCSS: (css: string) => {
				self.insertedCss.push(css);
				return FakeBrowserWindow.insertCssRejects ? Promise.reject(new Error("destroyed")) : Promise.resolve("key");
			},
			setUserAgent: (ua: string) => {
				if (FakeBrowserWindow.throwOnSetUserAgent) throw new Error("no setUserAgent");
				self.userAgent = ua;
			},
			on: (event: string, handler: Handler) => {
				(self.handlers[event] ??= []).push(handler);
			},
			setWindowOpenHandler: (handler: FakeBrowserWindow["windowOpenHandler"]) => {
				if (FakeBrowserWindow.throwOnWindowOpenHandler) throw new Error("remote cannot set handler");
				self.windowOpenHandler = handler;
			},
		};
		Object.defineProperty(this.webContents, "session", {
			get: () => (FakeBrowserWindow.hasWebRequest ? session : { webRequest: undefined }),
		});
	}

	loadURL(url: string, options?: unknown): Promise<void> {
		this.loadedUrl = url;
		this.loadOptions = options;
		return FakeBrowserWindow.loadUrlRejects ? Promise.reject(new Error("ERR_ABORTED")) : Promise.resolve();
	}
	on(event: string, handler: Handler): void {
		(this.windowHandlers[event] ??= []).push(handler);
	}
	hide(): void {
		this.hidden = true;
	}
	show(): void {
		this.shown = true;
	}
	isDestroyed(): boolean {
		return this.destroyed;
	}
	close(): void {
		this.closeCalls++;
		if (this.destroyed) return;
		this.destroyed = true;
		for (const h of this.windowHandlers["closed"] ?? []) h();
	}

	/** Fire a webContents event (e.g. "will-navigate", "page-title-updated", "did-stop-loading"). */
	emit(event: string, ...args: unknown[]): void {
		for (const h of this.handlers[event] ?? []) h(...args);
	}
	/** Simulate the user closing the window with the X button. */
	userClose(): void {
		this.destroyed = true;
		for (const h of this.windowHandlers["closed"] ?? []) h();
	}
}

/** Install the fake as window.require("electron"); `remote` mimics the @electron/remote wrapper shape. */
export function installElectron(shape: "plain" | "remote" = "plain"): void {
	const electron = shape === "remote" ? { remote: { BrowserWindow: FakeBrowserWindow } } : { BrowserWindow: FakeBrowserWindow };
	(window as unknown as { require: (m: string) => unknown }).require = (m: string): unknown => {
		if (m === "electron") return electron;
		throw new Error(`unexpected require(${m})`);
	};
}
