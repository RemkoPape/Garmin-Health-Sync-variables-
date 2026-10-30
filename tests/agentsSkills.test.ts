// Why it matters: release procedures live in project skills and AGENTS.md routes to them. These
// checks keep the two from drifting apart, so a release never runs from half-remembered steps.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const skillsDir = path.join(root, ".claude/skills");
const agents = readFileSync(path.join(root, "AGENTS.md"), "utf8");
const skills = readdirSync(skillsDir).filter((name) => existsSync(path.join(skillsDir, name, "SKILL.md")));

function frontmatter(name: string): Record<string, string> {
	const text = readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
	const block = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
	return Object.fromEntries(
		block.split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]),
	);
}

describe("AGENTS.md skill index", () => {
	it("has the two release skills and the screenshots skill", () => {
		expect(skills.sort()).toEqual(["docs-screenshots", "release-beta", "release-stable"]);
	});

	it.each(skills)("%s has a matching name and a description that says when to use it", (name) => {
		const fm = frontmatter(name);
		expect(fm.name).toBe(name);
		expect(fm.description).toMatch(/\bUse\b/);
	});

	it.each(skills)("%s is listed in the AGENTS.md table", (name) => {
		expect(agents).toContain(`| \`${name}\` |`);
	});

	it("names no skill that does not exist", () => {
		const listed = [...agents.matchAll(/\| `([a-z-]+)` \|/g)].map((m) => m[1]);
		expect(listed.sort()).toEqual([...skills].sort());
	});

	it("says Node 24 and no longer allows betas from PR heads", () => {
		expect(agents).toContain("Node.js 24");
		expect(agents).not.toMatch(/tagged commit does not have to be on `main`/);
		expect(agents).not.toContain("Andi");
	});
});
