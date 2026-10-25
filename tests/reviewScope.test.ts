// Why it matters: the community-directory review bot lints every tracked .ts/.js/.css file except
// a fixed list of names (docs, e2e-tests, testUtils, *.test.*, *.spec.*). A helper accidentally
// placed in tests/ without ".test." in its name, or any new top-level code folder, would be
// scanned and could earn the plugin a warnings badge again. Tests live in tests/*.test.ts, all
// helpers in testUtils/.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8", cwd: import.meta.dirname })
	.split("\n")
	.filter(Boolean);

const SKIPPED_DIRS = ["docs/", "e2e-tests/", "testUtils/"];
const isScanned = (f: string): boolean =>
	/\.(ts|mts|js|mjs|cjs|css)$/.test(f) &&
	!SKIPPED_DIRS.some((d) => f.startsWith(d)) &&
	!/\.(test|spec)\./.test(f);

describe("review-bot scan scope", () => {
	const scanned = tracked.filter(isScanned);

	it("only scans src/, scripts/, .claude/hooks/ and the known root files", () => {
		const rootFiles = new Set([
			"esbuild.config.mjs",
			"eslint.config.mts",
			"knip.jsonc",
			"stamp-prerelease.mjs",
			"styles.css",
			"version-bump.mjs",
			"vitest.config.mts",
		]);
		const stray = scanned.filter(
			(f) =>
				!f.startsWith("src/") &&
				!f.startsWith("scripts/") &&
				!f.startsWith(".claude/hooks/") &&
				!rootFiles.has(f),
		);
		expect(stray).toEqual([]);
	});

	it("keeps every file in tests/ named *.test.ts", () => {
		const notTests = tracked.filter((f) => f.startsWith("tests/") && !/\.test\.ts$/.test(f));
		expect(notTests).toEqual([]);
	});
});
