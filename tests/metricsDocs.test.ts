// Why it matters: docs/metrics.md is the one place that lists every property written to a note. A metric that
// ships without its row, or a row for one that is gone, tells the user the wrong thing about their own notes.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { METRICS } from "../src/metrics";
import { PANEL_CARDS } from "../src/panel/cards";

const docs = readFileSync(new URL("../docs/metrics.md", import.meta.url), "utf8");
const rows = new Map<string, string[]>();
for (const line of docs.split("\n")) {
	const cells = line.split("|").map((c) => c.trim());
	const key = /^`([a-z_0-9]+)`$/.exec(cells[1] ?? "")?.[1];
	if (key) rows.set(key, cells.slice(1, -1));
}

describe("docs/metrics.md", () => {
	it("has a row for every metric and none for a metric that does not exist, in the order of the code", () => {
		expect([...rows.keys()]).toEqual(METRICS.map((m) => m.key));
	});

	it.each(METRICS.map((m) => [m.key, m.defaultEnabled] as const))("%s says whether it is on by default", (key, on) => {
		expect(rows.get(key)![3]).toBe(on ? "on" : "off");
	});

	it("links, for every metric a card needs, that card's section", () => {
		for (const card of PANEL_CARDS) {
			for (const key of [...card.metrics, ...(card.extra ?? [])]) {
				expect(rows.get(key)![5], `${key} → ${card.id}`).toContain(`(panel-cards.md#${card.id})`);
			}
		}
	});

	it("counts the metrics the README claims", () => {
		const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
		const claimed = Number(/\*\*(\d+)\+ metrics\*\*/.exec(readme)?.[1]);
		expect(METRICS.length).toBeGreaterThanOrEqual(claimed);
	});
});
