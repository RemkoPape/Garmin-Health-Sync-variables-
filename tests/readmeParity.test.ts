// Why it matters: the six READMEs are what users in each language read first. A section, an image, a feature bullet
// or a credit that exists in English but not in a translation is information some users never get, and nothing
// else compares them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string): string => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const english = read("README.md");
const translations = ["de", "es", "fr", "ja", "zh"].map((l) => [l, read(`README.${l}.md`)] as const);

const headings = (text: string, mark: string): number => text.split("\n").filter((l) => l.startsWith(`${mark} `)).length;
const images = (text: string): string[] => [...text.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1]!);
/** The bullets of the Features section: the section after the Documentation list, before the next one. */
const features = (text: string): number => {
	const headingStarts = [...text.matchAll(/^## /gm)].map((m) => m.index!);
	const section = text.slice(headingStarts[1], headingStarts[2]);
	return section.split("\n").filter((l) => l.startsWith("- **")).length;
};

describe("the translated READMEs", () => {
	it.each(translations)("README.%s.md has the sections, feature bullets and images of the English one", (_lang, text) => {
		expect(headings(text, "##")).toBe(headings(english, "##"));
		expect(headings(text, "###")).toBe(headings(english, "###"));
		expect(features(text)).toBe(features(english));
		expect(images(text)).toEqual(images(english));
	});

	it.each([["README.md", english], ...translations.map(([l, t]) => [`README.${l}.md`, t] as const)])("%s states the purpose, links the card reference and credits the plugins the properties handling was inspired by", (_name, text) => {
		expect(text).toContain("docs/panel-cards.md");
		expect(text).toContain("NOTICE.md");
		expect(text).toContain("obsidian.md/plugins?id=fold-properties-by-default");
		expect(text).toContain("obsidian.md/plugins?id=extended-properties");
	});

	it("puts the three screenshots that matter first, before the technical sections", () => {
		const firstSection = english.indexOf("\n## ");
		const hero = images(english.slice(0, firstSection));
		expect(hero).toEqual(["docs/screenshots/panel-today.png", "docs/screenshots/panel-insights.png", "docs/screenshots/panel-today-dark.png"]);
	});
});
