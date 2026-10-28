// Renders the documentation screenshots (docs/screenshots/*.png) from the real side panel code and the real
// styles.css, with synthetic data, in headless Chromium at 2x. No pixels are captured by hand and nothing is
// drawn on top: a scene that stops matching its selectors fails the run.
//
//   npm run screenshots                  render every scene into docs/screenshots
//   npm run screenshots -- panel-today   only the named scenes
//   npm run check:screenshots            render into a temp folder, touch nothing, exit 1 on a problem
//
// Steps: (1) vitest renders each scene with the panel's own code into an HTML file (testUtils/screenshots), (2) this
// script wraps it in Obsidian's default theme variables and the real styles.css, (3) Chromium reports the page
// height, (4) Chromium takes the screenshot at exactly that height. See .claude/skills/docs-screenshots/SKILL.md.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const only = args.filter((a) => !a.startsWith("--"));
const OUT_DIR = path.join(root, "docs", "screenshots");

/** Obsidian's default theme: the variables styles.css reads, light and dark. Values follow the published default theme. */
const THEME = {
	common: `--font-ui-smaller:12px;--font-ui-small:13px;--font-ui-medium:15px;--font-ui-large:20px;--font-ui-larger:24px;--font-smaller:13px;
--font-normal:400;--font-semibold:600;--font-bold:700;--line-height-normal:1.5;--radius-s:4px;--radius-m:8px;
--size-2-1:2px;--size-2-2:4px;--size-2-3:6px;--size-4-1:4px;--size-4-2:8px;--size-4-3:12px;--size-4-4:16px;--size-4-5:20px;--size-4-6:24px;
--font-monospace:ui-monospace,Menlo,monospace;--interactive-accent:hsl(258,88%,66%);--text-on-accent:#fff;--icon-m:18px;`,
	light: `--background-primary:#fff;--background-secondary:#f6f6f6;--background-modifier-border:#e0e0e0;--background-modifier-hover:rgba(0,0,0,0.075);
--text-normal:#222;--text-muted:#5c5c5c;--text-faint:#ababab;--text-accent:hsl(258,88%,62%);
--color-red:#e93147;--color-orange:#ec7500;--color-yellow:#e0ac00;--color-green:#08b94e;--color-cyan:#00bfbc;--text-success:#08b94e;
--shadow-s:0 1px 2px rgba(0,0,0,.028),0 3.4px 6.7px rgba(0,0,0,.042),0 15px 30px rgba(0,0,0,.07);`,
	dark: `--background-primary:#1e1e1e;--background-secondary:#262626;--background-modifier-border:#363636;--background-modifier-hover:rgba(255,255,255,0.075);
--text-normal:#dadada;--text-muted:#b3b3b3;--text-faint:#666;--text-accent:hsl(258,88%,72%);
--color-red:#fb464c;--color-orange:#e9973f;--color-yellow:#e0de71;--color-green:#44cf6e;--color-cyan:#53dfdd;--text-success:#44cf6e;
--shadow-s:0 1px 2px rgba(0,0,0,.2),0 3.4px 6.7px rgba(0,0,0,.3),0 15px 30px rgba(0,0,0,.4);`,
};

/** Obsidian draws its icons with Lucide; the few the panel uses are inlined (lucide.dev, ISC licence). */
const ICONS = {
	lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
	"chevron-left": '<path d="m15 18-6-6 6-6"/>',
	"chevron-right": '<path d="m9 18 6-6-6-6"/>',
	calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
	"refresh-cw": '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
	pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
	"grip-vertical": '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
	check: '<path d="M20 6 9 17l-5-5"/>',
	copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
};

const BASE_CSS = `
html{background:var(--background-primary)}
body{margin:0;color:var(--text-normal);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;font-size:var(--font-ui-medium);line-height:var(--line-height-normal);-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit}
.clickable-icon{display:inline-flex;align-items:center;justify-content:center;padding:var(--size-4-2);border:0;background:transparent;border-radius:var(--radius-s);cursor:pointer;color:var(--text-muted)}
.svg-icon{width:var(--icon-m);height:var(--icon-m);stroke-width:2px;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round}
.view-content{padding:var(--size-4-3)}
.modal{box-sizing:border-box;margin:var(--size-4-4);padding:var(--size-4-6);background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:var(--radius-m);box-shadow:var(--shadow-s)}
.modal h2,.modal h3{margin:0 0 var(--size-4-2);line-height:1.3}.modal h2{font-size:var(--font-ui-large)}.modal h3{font-size:var(--font-ui-medium)}
.modal ul{padding-left:var(--size-4-6)}.modal li{margin-bottom:var(--size-4-3)}
.ghs-whats-new-body{max-height:none!important}
.setting-item{display:flex;align-items:center;justify-content:space-between;gap:var(--size-4-4)}
.setting-item-name{font-size:var(--font-ui-medium)}
.dropdown{font:inherit;font-size:var(--font-ui-small);padding:var(--size-2-3) var(--size-4-4) var(--size-2-3) var(--size-4-3);border:1px solid var(--background-modifier-border);border-radius:var(--radius-s);background:var(--background-secondary);color:var(--text-normal)}
.checkbox-container{position:relative;width:40px;height:22px;border-radius:11px;background:var(--background-modifier-border)}
.checkbox-container::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff}
.checkbox-container.is-enabled{background:var(--interactive-accent)}.checkbox-container.is-enabled::after{left:21px}

`;

function findChrome() {
	const candidates = [];
	if (process.env.CHROME_HEADLESS_SHELL) candidates.push(process.env.CHROME_HEADLESS_SHELL);
	for (const cache of [path.join(homedir(), "Library", "Caches", "ms-playwright"), path.join(homedir(), ".cache", "ms-playwright"), "/opt/pw-browsers"]) {
		if (!existsSync(cache)) continue;
		for (const dir of readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse()) {
			const base = path.join(cache, dir);
			for (const sub of readdirSync(base)) candidates.push(path.join(base, sub, "chrome-headless-shell"));
		}
	}
	const found = candidates.find((c) => existsSync(c));
	if (found) return found;
	const which = spawnSync("which", ["chromium"], { encoding: "utf8" }).stdout.trim();
	if (which) return which;
	throw new Error("No headless Chromium found. Set CHROME_HEADLESS_SHELL or run `npx playwright install chromium-headless-shell`.");
}

function page(body, theme, width, css) {
	const icons = JSON.stringify(ICONS);
	return `<!doctype html><html class="theme-${theme}"><head><meta charset="utf-8"><style>:root{${THEME.common}${THEME[theme]}}${BASE_CSS}</style><style>${css}</style></head>
<body class="theme-${theme}"><div class="view-content" style="width:${width - 24}px">${body}</div>
<script>
const icons=${icons};
const missing=[];
for(const el of document.querySelectorAll("[data-icon]")){const d=el.getAttribute("data-icon");if(!icons[d]){missing.push(d);continue}
el.innerHTML='<svg class="svg-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">'+icons[d]+'</svg>'}
document.documentElement.setAttribute("data-content-height",String(Math.ceil(document.documentElement.getBoundingClientRect().height)));
if(missing.length)document.documentElement.setAttribute("data-error","no icon for "+missing.join(", "));
</script></body></html>`;
}

function chrome(exe, flags, file) {
	return spawnSync(exe, ["--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--force-device-scale-factor=2", "--virtual-time-budget=4000", ...flags, `file://${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const work = mkdtempSync(path.join(tmpdir(), "ghs-shots-"));
const problems = [];
try {
	// (1) the panel's own code renders each scene to HTML
	const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
	execFileSync(process.execPath, [vitest, "run", "--config", "testUtils/screenshots/vitest.config.mts"], { cwd: root, env: { ...process.env, SCREENSHOT_OUT: work }, stdio: "pipe" });
	const manifest = JSON.parse(readFileSync(path.join(work, "manifest.json"), "utf8"));
	const css = readFileSync(path.join(root, "styles.css"), "utf8");

	// every Obsidian variable styles.css reads must be provided here, or the image would silently use a fallback
	const provided = new Set([...(THEME.common + THEME.light + THEME.dark).matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]));
	const own = new Set([...css.matchAll(/(--ghs-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
	for (const m of css.matchAll(/var\((--[a-z0-9-]+)/g)) if (!provided.has(m[1]) && !own.has(m[1]) && !m[1].startsWith("--ghs-")) problems.push(`styles.css reads ${m[1]}, which the screenshot theme does not define`);

	const exe = findChrome();
	const target = check ? path.join(work, "out") : OUT_DIR;
	mkdirSync(target, { recursive: true });
	for (const scene of manifest) {
		if (only.length > 0 && !only.includes(scene.id)) continue;
		if (scene.error) {
			problems.push(scene.error);
			continue;
		}
		const html = path.join(work, `${scene.id}.page.html`);
		writeFileSync(html, page(readFileSync(path.join(work, `${scene.id}.html`), "utf8"), scene.theme, scene.width, css));
		// (3) the page publishes its height and any error synchronously, so a dump taken before the first frame has them
		const dom = chrome(exe, ["--dump-dom", `--window-size=${scene.width},800`], html).stdout;
		const error = /data-error="([^"]*)"/.exec(dom)?.[1];
		const height = Number(/data-content-height="(\d+)"/.exec(dom)?.[1]);
		if (error) problems.push(`${scene.id}: ${error}`);
		if (!(height > 100)) {
			problems.push(`${scene.id}: the page reported no height`);
			continue;
		}
		// (4) the screenshot is exactly as tall as the content: adding a card cannot clip the image
		const png = path.join(target, scene.file);
		chrome(exe, [`--screenshot=${png}`, `--window-size=${scene.width},${height}`], html);
		if (!existsSync(png)) problems.push(`${scene.id}: Chromium wrote no image`);
		else console.log(`${check ? "checked" : "wrote"} ${scene.file} (${scene.width} x ${height} px at 2x)`);
	}
} catch (error) {
	problems.push(String(error?.stderr ?? error?.message ?? error));
} finally {
	rmSync(work, { recursive: true, force: true });
}
if (problems.length > 0) {
	for (const p of problems) console.error(`screenshots: ${p}`);
	process.exit(1);
}
