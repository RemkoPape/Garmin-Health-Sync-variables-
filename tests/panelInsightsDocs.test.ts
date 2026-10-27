// Why it matters: every interpretation the panel can show is a health-related statement. Each one must be
// documented (when it fires, what it rests on, a link to the study) and translated, or it must not ship.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INSIGHTS } from "../src/panel/insights/registry";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";
import { es } from "../src/i18n/es";
import { fr } from "../src/i18n/fr";
import { ja } from "../src/i18n/ja";
import { zh } from "../src/i18n/zh";

const docs = readFileSync(new URL("../docs/panel-insights.md", import.meta.url), "utf8");
const [, interpretations = ""] = docs.split("\n## Interpretations\n");
const sections = new Map<string, string>();
for (const part of interpretations.split(/^### /m).slice(1)) {
	const [id, ...rest] = part.split("\n");
	sections.set(id!.trim(), rest.join("\n"));
}

describe("docs/panel-insights.md", () => {
	it("has a section for every interpretation and no section for one that does not exist", () => {
		expect([...sections.keys()].sort()).toEqual(Object.keys(INSIGHTS).sort());
	});

	it.each(Object.keys(INSIGHTS))("%s says which card, when it fires, what it rests on and cites a study or says none", (id) => {
		const body = sections.get(id)!;
		expect(body).toMatch(/^- \*\*Card:\*\* \S/m);
		expect(body).toMatch(/^- \*\*Trigger:\*\* \S/m);
		expect(body).toMatch(/^- \*\*Basis:\*\* \S/m);
		const refs = /^- \*\*References:\*\* (.+)$/m.exec(body)?.[1] ?? "";
		expect(refs.startsWith("none") || /\]\(https:\/\/\S+\)/.test(refs)).toBe(true);
	});

	it("names the card the code registers the interpretation for", () => {
		for (const [id, meta] of Object.entries(INSIGHTS)) expect(sections.get(id)).toContain(`**Card:** ${meta.card}`);
	});

	it("quotes the English text that ships", () => {
		for (const id of Object.keys(INSIGHTS)) {
			const shipped = (en as Record<string, string>)[`insight_${id}`]!;
			expect(sections.get(id)).toContain(`**Text (English):** ${shipped}`);
		}
	});

	it("only links to https pages and lists every reference it cites in the reference list", () => {
		const list = docs.split("## References")[1]!.split("## Interpretations")[0]!;
		const known = new Set([...list.matchAll(/^- \*\*(\w+)\*\*:/gm)].map((m) => m[1]));
		for (const m of interpretations.matchAll(/\[(\w+)\]\((https?:\/\/[^)]+)\)/g)) {
			expect(m[2]!.startsWith("https://")).toBe(true);
			expect(known.has(m[1]!)).toBe(true);
		}
		for (const m of list.matchAll(/\]\((https?:\/\/[^)]+)\)/g)) expect(m[1]!.startsWith("https://")).toBe(true);
	});
});

describe("interpretation texts", () => {
	const languages: Record<string, Record<string, string>> = { en, de, es, fr, ja, zh };

	it.each(Object.keys(languages))("%s has a text for every interpretation", (lang) => {
		for (const id of Object.keys(INSIGHTS)) expect(languages[lang]![`insight_${id}`], `${lang} insight_${id}`).toBeTruthy();
	});

	it("has the heading and the note in every language", () => {
		for (const lang of Object.values(languages)) {
			expect(lang["panelInsightTitle"]).toBeTruthy();
			expect(lang["panelInsightNote"]).toBeTruthy();
		}
	});

	it("never gives generic lifestyle advice that applies to everyone", () => {
		for (const id of Object.keys(INSIGHTS)) expect((en as Record<string, string>)[`insight_${id}`]).not.toMatch(/alcohol|caffeine|drink more water|hydrat/i);
	});
});
