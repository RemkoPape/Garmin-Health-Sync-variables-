// Why it matters: docs/panel-cards.md is where a user reads what a card shows, how it helps a daily decision, how
// it is worked out and drawn. A card that ships without its section, or a section for a card that is gone, is
// documentation that misleads, so the page must follow the registry.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PANEL_CARDS } from "../src/panel/cards";
import { INSIGHTS } from "../src/panel/insights/registry";

const docs = readFileSync(new URL("../docs/panel-cards.md", import.meta.url), "utf8");
const [, cards = ""] = docs.split("\n## The cards\n");
const sections = new Map<string, string>();
for (const part of cards.split(/^### /m).slice(1)) {
	const [id, ...rest] = part.split("\n");
	sections.set(id!.trim(), rest.join("\n"));
}

describe("docs/panel-cards.md", () => {
	it("has a section for every card of the panel, in panel order, and none for a card that does not exist", () => {
		expect([...sections.keys()]).toEqual(PANEL_CARDS.map((c) => c.id));
	});

	it.each(PANEL_CARDS.map((c) => c.id))("%s says what it shows, which decision it supports, how it is calculated and drawn, what it needs and its light bulb", (id) => {
		const body = sections.get(id)!;
		for (const label of ["What it shows", "Decision it supports", "How it is calculated", "How it is drawn", "Needs", "Light bulb"]) {
			expect(body, `${id}: ${label}`).toMatch(new RegExp(`^- \\*\\*${label}:\\*\\* \\S`, "m"));
		}
	});

	it.each(PANEL_CARDS.filter((c) => c.metrics.length > 0).map((c) => [c.id, c.metrics, c.extra ?? []] as const))("%s names the metrics the registry says it needs", (id, metrics, extra) => {
		const needs = /^- \*\*Needs:\*\* (.+)$/m.exec(sections.get(id)!)?.[1] ?? "";
		for (const key of [...metrics, ...extra]) expect(needs, `${id}: ${key}`).toContain(`\`${key}\``);
	});

	it("links every interpretation family of the card to a prefix that exists in the registry", () => {
		for (const [id, body] of sections) {
			const bulb = /^- \*\*Light bulb:\*\* (.+)$/m.exec(body)?.[1] ?? "";
			for (const prefix of [...bulb.matchAll(/`([a-z0-9_]+)\*`/g)].map((m) => m[1]!)) {
				expect(Object.keys(INSIGHTS).some((key) => key.startsWith(prefix)), `${id}: ${prefix}*`).toBe(true);
			}
		}
	});
});
