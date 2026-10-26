// Why it matters: a feature that adds or rewords an English text but forgets a language ships a window or
// setting that is half English for German, Chinese, Japanese, Spanish or French users. Nothing else catches
// it: the parity test only checks that the keys exist, not that they were looked at again. This gate fails the
// pull request instead.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LOCALES, changedKeys, checkI18nSync, declaredUnchanged, parseLocale } from "../../scripts/lib/i18nSyncChecks.mjs";
import { stripYamlComments } from "../../scripts/lib/releaseChecks.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const file = (...pairs: [string, string][]): string => `export const x = {\n${pairs.map(([k, v]) => `\t${k}: ${JSON.stringify(v)},`).join("\n")}\n};\n`;
const all = (text: string): Record<string, string> => Object.fromEntries(LOCALES.map((l) => [l, text]));

describe("parseLocale and changedKeys", () => {
	it("reads key: value lines and ignores everything else", () => {
		const map = parseLocale(`export const en = {\n\t// comment\n\ta: "A",\n\n\tb: "B, with comma",\n};\n`);
		expect([...map]).toEqual([["a", '"A"'], ["b", '"B, with comma"']]);
		expect(parseLocale(undefined).size).toBe(0);
	});

	it("reports added, reworded and removed keys, not untouched ones", () => {
		const before = file(["same", "s"], ["reworded", "old"], ["gone", "g"]);
		const after = file(["same", "s"], ["reworded", "new"], ["added", "a"]);
		expect([...changedKeys(before, after)].sort()).toEqual(["added", "gone", "reworded"]);
		expect(changedKeys(before, before).size).toBe(0);
	});
});

describe("checkI18nSync", () => {
	const base = file(["a", "A"], ["b", "B"]);

	it("passes when nothing changed", () => {
		expect(checkI18nSync(all(base), all(base))).toEqual([]);
	});

	it("passes when every language got the new text", () => {
		const head = file(["a", "A"], ["b", "B"], ["c", "C"]);
		expect(checkI18nSync(all(base), all(head))).toEqual([]);
	});

	it("fails and names the languages that were forgotten", () => {
		const head = { ...all(base), en: file(["a", "A"], ["b", "B2"]), de: file(["a", "A"], ["b", "B-de"]), fr: file(["a", "A"], ["b", "B-fr"]) };
		expect(checkI18nSync(all(base), head)).toEqual(["b: changed in en but not in zh, ja, es"]);
	});

	it("fails for a removed or rewritten key too", () => {
		const head = { ...all(base), en: file(["a", "A"]) };
		expect(checkI18nSync(all(base), head)).toEqual(["b: changed in en but not in de, zh, ja, es, fr"]);
	});

	it("allows fixing one translation on its own", () => {
		const head = { ...all(base), de: file(["a", "A"], ["b", "B-fixed"]) };
		expect(checkI18nSync(all(base), head)).toEqual([]);
	});

	it("accepts a key declared as needing no retranslation, and only that key", () => {
		const head = { ...all(base), en: file(["a", "A2"], ["b", "B2"]) };
		expect(checkI18nSync(all(base), head, new Set(["a"]))).toEqual(["b: changed in en but not in de, zh, ja, es, fr"]);
	});

	it("treats a new language file at the base as empty", () => {
		const head = all(base);
		const old = { ...head, fr: "" };
		expect(checkI18nSync(old, head)).toEqual([]);
	});
});

describe("declaredUnchanged", () => {
	it("collects keys from I18n-Unchanged lines of any commit message", () => {
		const log = "Fix a typo\n\nI18n-Unchanged: noticeA, noticeB\n\nOther commit\ni18n-unchanged: commandC noticeA\nUnrelated: noticeZ\n";
		expect([...declaredUnchanged(log)].sort()).toEqual(["commandC", "noticeA", "noticeB"]);
		expect(declaredUnchanged(undefined).size).toBe(0);
	});
});

describe("wiring", () => {
	it("lists exactly the language files of src/i18n", () => {
		const files = readdirSync(path.join(root, "src/i18n")).filter((f) => f.endsWith(".ts") && f !== "t.ts").map((f) => f.slice(0, -3));
		expect([...LOCALES].sort()).toEqual(files.sort());
	});

	it("runs in CI on pull requests, from the pull request's base commit", () => {
		const ci = stripYamlComments(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"));
		expect(ci).toContain("npm run check:i18n-sync");
		expect(ci).toContain("github.event.pull_request.base.sha");
		expect(ci).toMatch(/if: github\.event_name == 'pull_request'/);
		expect(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts["check:i18n-sync"]).toBe("node scripts/check-i18n-sync.mjs");
	});
});

describe("the command", () => {
	const script = path.join(root, "scripts/check-i18n-sync.mjs");
	/** A throwaway repository with the six language files, one commit as the base. */
	function repo(): { run: (...a: string[]) => string; write: (locale: string, text: string) => void; commit: (msg: string) => void; base: string } {
		const dir = mkdtempSync(path.join(tmpdir(), "i18n-sync-"));
		const run = (...a: string[]): string => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
		run("init", "-q");
		run("config", "user.email", "t@example.com");
		run("config", "user.name", "t");
		run("config", "commit.gpgsign", "false");
		mkdirSync(path.join(dir, "src/i18n"), { recursive: true });
		mkdirSync(path.join(dir, "scripts/lib"), { recursive: true });
		for (const f of ["scripts/check-i18n-sync.mjs", "scripts/lib/i18nSyncChecks.mjs"]) writeFileSync(path.join(dir, f), readFileSync(path.join(root, f)));
		const write = (locale: string, text: string): void => writeFileSync(path.join(dir, `src/i18n/${locale}.ts`), text);
		for (const l of LOCALES) write(l, file(["a", "A"]));
		const commit = (msg: string): void => { run("add", "-A"); run("commit", "-q", "--allow-empty", "-m", msg); };
		commit("base");
		return { run, write, commit, base: run("rev-parse", "HEAD").trim() };
	}
	const exec = (dir: string, ...args: string[]): { code: number; out: string } => {
		try {
			return { code: 0, out: execFileSync("node", [path.join(dir, "scripts/check-i18n-sync.mjs"), ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
		} catch (e) {
			const err = e as { status: number; stderr: string };
			return { code: err.status, out: err.stderr };
		}
	};
	const cwd = (r: ReturnType<typeof repo>): string => r.run("rev-parse", "--show-toplevel").trim();

	it("passes on an unchanged branch, fails on a lone English change, passes when declared or complete", () => {
		const r = repo();
		const dir = cwd(r);
		expect(exec(dir, "--base", r.base).code).toBe(0);

		r.write("en", file(["a", "A2"]));
		r.commit("reword in English only");
		const failed = exec(dir, "--base", r.base);
		expect(failed.code).toBe(1);
		expect(failed.out).toContain("a: changed in en but not in de, zh, ja, es, fr");
		expect(failed.out).toContain("I18n-Unchanged");

		r.write("en", file(["a", "A2"]));
		r.commit("Typo\n\nI18n-Unchanged: a");
		expect(exec(dir, "--base", r.base).code).toBe(0);
	});

	it("passes when all languages follow, also in separate commits of the same branch", () => {
		const r = repo();
		const dir = cwd(r);
		r.write("en", file(["a", "A2"]));
		r.commit("English");
		for (const l of LOCALES.filter((x) => x !== "en")) r.write(l, file(["a", `A2-${l}`]));
		r.commit("Translations");
		expect(exec(dir, "--base", r.base).code).toBe(0);
	});

	it("explains the usage without --base", () => {
		const r = repo();
		const res = exec(cwd(r));
		expect(res.code).toBe(2);
		expect(res.out).toContain("usage");
	});

	it("treats a language file that did not exist at the base as empty", () => {
		const r = repo();
		const dir = cwd(r);
		r.run("rm", "-q", "src/i18n/fr.ts");
		r.commit("drop fr");
		const base = r.run("rev-parse", "HEAD").trim();
		r.write("fr", file(["a", "A"]));
		r.write("en", file(["a", "A"], ["z", "Z"]));
		for (const l of LOCALES.filter((x) => x !== "en")) r.write(l, file(["a", "A"], ["z", `Z-${l}`]));
		r.commit("new fr + everything");
		expect(exec(dir, "--base", base).code).toBe(0);
	});
});
