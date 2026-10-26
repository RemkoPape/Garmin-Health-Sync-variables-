// Why it matters: the Obsidian review bot warns when the README links to another repository with the
// same name (it happened after the fork: fcandi/garmin-health-sync). The original author stays credited,
// but only through the profile link, never through a repository link.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const readmes = execFileSync("git", ["ls-files", "README*.md", "docs/*.md"], { encoding: "utf8", cwd: root })
	.split("\n")
	.filter(Boolean);

const githubLinks = (file: string): string[] =>
	readFileSync(join(root, file), "utf8").match(/https?:\/\/github\.com\/[^\s)"'>]*/g) ?? [];

describe("README links", () => {
	it("finds the README files", () => {
		expect(readmes).toContain("README.md");
		expect(readmes.length).toBeGreaterThanOrEqual(6);
	});

	it.each(readmes)("%s links only to this repository and the two profiles", (file) => {
		const allowed = /^https:\/\/github\.com\/(davadev(\/Garmin-Health-Sync(\/.*)?)?|fcandi)\/?$/;
		for (const link of githubLinks(file)) expect(link, `${file}: ${link}`).toMatch(allowed);
	});

	it.each(readmes.filter((f) => f.startsWith("README")))("%s credits the original author through the profile", (file) => {
		expect(githubLinks(file)).toContain("https://github.com/fcandi");
		expect(githubLinks(file)).toContain("https://github.com/davadev");
	});
});
