// Why it matters: the docs are a set of pages that point at each other and at the README. A link to a page that was
// renamed or to a heading that was reworded is a dead end for the reader, and nothing else notices.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const files = execFileSync("git", ["ls-files", "README*.md", "docs/*.md", "NOTICE.md"], { encoding: "utf8", cwd: root }).split("\n").filter(Boolean);
const read = (file: string): string => readFileSync(join(root, file), "utf8");

/** GitHub's anchor of a heading: lower case, formatting and punctuation dropped, spaces turned into hyphens. */
function slug(heading: string): string {
	return heading
		.replace(/`/g, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s_-]/gu, "")
		.replace(/\s/g, "-");
}
const anchorsOf = (file: string): Set<string> => new Set(read(file).split("\n").filter((l) => /^#{1,6} /.test(l)).map((l) => slug(l.replace(/^#+ /, ""))));

const targets = (file: string): { target: string; kind: string }[] => {
	const text = read(file);
	const links = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => ({ target: m[1]!, kind: "link" }));
	const images = [...text.matchAll(/<img src="([^"]+)"/g)].map((m) => ({ target: m[1]!, kind: "image" }));
	return [...links, ...images].filter((l) => !/^(https?:|mailto:)/.test(l.target));
};

describe("links between the README files and the docs", () => {
	it("finds the pages", () => {
		for (const page of ["README.md", "docs/README.md", "docs/settings.md", "docs/metrics.md", "docs/troubleshooting.md", "docs/panel-cards.md", "docs/panel-insights.md", "docs/history.md", "NOTICE.md"]) expect(files).toContain(page);
	});

	it.each(files)("%s: every relative link, image and heading anchor resolves", (file) => {
		for (const { target, kind } of targets(file)) {
			const [path = "", anchor] = target.split("#");
			const resolved = path === "" ? file : normalize(join(dirname(file), path));
			expect(existsSync(join(root, resolved)), `${file}: ${kind} ${target}`).toBe(true);
			if (anchor !== undefined && resolved.endsWith(".md")) expect(anchorsOf(resolved).has(anchor), `${file}: ${target}`).toBe(true);
		}
	});

	it("links every docs page from the docs index and the English README", () => {
		const pages = files.filter((f) => f.startsWith("docs/") && f !== "docs/README.md").map((f) => f.slice(5));
		const index = read("docs/README.md");
		for (const page of pages) expect(index, page).toContain(`(${page})`);
		const readme = read("README.md");
		for (const page of pages.filter((p) => p !== "release-process.md")) expect(readme, page).toContain(`docs/${page}`);
	});

	it("links every other docs page from each docs page, so a reader is never at a dead end", () => {
		for (const file of files.filter((f) => f.startsWith("docs/") && f !== "docs/README.md" && f !== "docs/release-process.md")) {
			expect(read(file), file).toMatch(/See also:/);
		}
	});
});
