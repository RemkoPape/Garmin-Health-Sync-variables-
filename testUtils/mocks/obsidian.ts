// In-memory stand-in for the `obsidian` package, which ships only type definitions.
// Skeleton for 0.11.1 PR A: enough surface for modules to import. The vault, requestUrl
// router and golden-value checks (plan §1.5/§1.5b) grow with the test PRs that need them.
import moment from "moment";
import { parse, stringify } from "yaml";

export { moment };

export const Platform = { isMobile: false, isDesktop: true, isIosApp: false, isAndroidApp: false };

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
}

export class App {}

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

export interface RequestUrlResponse {
	status: number;
	headers: Record<string, string>;
	text: string;
	json: unknown;
}

export function requestUrl(): never {
	throw new Error("requestUrl: unrouted request (the test must register a route)");
}
