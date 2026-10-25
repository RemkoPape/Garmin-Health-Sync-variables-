// Why it matters: the coverage gate is a ratchet that only goes up. These checks keep the parts of
// it that can be verified without running coverage from being loosened by accident, and keep the
// rule "unreachable code is deleted, never hidden from the report".
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const config = readFileSync(path.join(root, "vitest.config.mts"), "utf8");

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const p = path.join(dir, name);
		if (statSync(p).isDirectory()) return sourceFiles(p);
		return p.endsWith(".ts") ? [p] : [];
	});
}

describe("coverage gate", () => {
	it("fails CI below 100 on every metric", () => {
		const block = /thresholds:\s*\{([^}]*)\}/.exec(config)?.[1] ?? "";
		for (const metric of ["lines", "functions", "branches", "statements"]) {
			expect(block, metric).toMatch(new RegExp(`${metric}:\\s*100\\b`));
		}
	});

	it("has no coverage-ignore comments in the source: unreachable code is deleted, not hidden", () => {
		const offenders = sourceFiles(path.join(root, "src")).filter((f) =>
			/\/\*\s*(?:v8|c8|istanbul)\s+ignore/.test(readFileSync(f, "utf8")),
		);
		expect(offenders).toEqual([]);
	});

	it("excludes nothing from coverage but the declaration files", () => {
		const block = /exclude:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? "";
		const entries = block
			.split("\n")
			.map((l) => l.replace(/\/\/.*$/, "").trim())
			.filter(Boolean)
			.join("")
			.split(",")
			.map((e) => e.trim().replace(/^"|"$/g, ""))
			.filter(Boolean);
		expect(entries).toEqual(["src/**/*.d.ts"]);
	});

	it("measures only src/ and runs only tests/ (test helpers live outside both)", () => {
		expect(config).toContain('include: ["tests/**/*.test.ts"]');
		expect(config).toContain('include: ["src/**/*.ts"]');
	});
});
