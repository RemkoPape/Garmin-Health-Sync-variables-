// Why it matters: the release workflow is the last thing between a mistake and a delisted plugin,
// and it is only exercised by a real tag. Someone "simplifying" it later gets a red test instead of
// a delisting. Matching is done on comment-stripped text, so prose cannot satisfy a guard.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkReleaseWorkflow, stripYamlComments } from "../scripts/lib/releaseChecks.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string): string => readFileSync(path.join(root, p), "utf8");
const release = read(".github/workflows/release.yml");
const ci = stripYamlComments(read(".github/workflows/ci.yml"));
const attest = stripYamlComments(read(".github/workflows/attest-release-assets.yml"));

describe("release.yml", () => {
	it("keeps every guard", () => {
		expect(checkReleaseWorkflow(release)).toEqual([]);
	});

	it("runs lint, typecheck, build and coverage before check-release, in that order", () => {
		const code = stripYamlComments(release);
		const order = ["npm run lint", "npm run typecheck:tests", "npm run build", "npm run test:cov", "check-release"].map((s) =>
			code.indexOf(s),
		);
		expect(order.every((i) => i >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
	});

	it("stamps betas before anything is built", () => {
		const code = stripYamlComments(release);
		expect(code.indexOf("stamp-prerelease.mjs")).toBeGreaterThan(code.indexOf("npm ci"));
		expect(code.indexOf("stamp-prerelease.mjs")).toBeLessThan(code.indexOf("npm run build"));
	});

	it("only triggers on stable and -beta.N tags", () => {
		const code = stripYamlComments(release);
		expect(code).toContain('"[0-9]+.[0-9]+.[0-9]+"');
		expect(code).toContain('"[0-9]+.[0-9]+.[0-9]+-beta.[0-9]+"');
	});

	it("cannot be satisfied by a comment (a deleted step that is still mentioned in prose fails)", () => {
		const gutted = release.replace(/- name: Validate release artifacts[\s\S]*?(?=\n {6}- name: Attest)/, "# Validate release artifacts: -s main.js -s styles.css -s manifest.json\n");
		expect(checkReleaseWorkflow(gutted)).toContain(
			"no artifact validation step (non-empty main.js, manifest.json, styles.css)",
		);
	});

	it("pins every action to a full commit SHA", () => {
		for (const file of [".github/workflows/release.yml", ".github/workflows/ci.yml", ".github/workflows/attest-release-assets.yml"]) {
			const uses = [...stripYamlComments(read(file)).matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
			expect(uses.length, file).toBeGreaterThan(0);
			for (const u of uses) expect(u, `${file}: ${u}`).toMatch(/@[0-9a-f]{40}$/);
		}
	});
});

describe("ci.yml", () => {
	it("keeps the job names that branch protection requires", () => {
		for (const name of ["validate:", "next-node:", "timezones:", "name: timezones (${{ matrix.tz }})", "store-listing:"]) {
			expect(ci, name).toContain(name);
		}
		for (const tz of ["America/Los_Angeles", "Pacific/Auckland", "Europe/Vienna"]) expect(ci).toContain(tz);
	});

	it("runs the whole gate in validate", () => {
		for (const step of [
			"npm run build",
			"npm run lint",
			"npm run typecheck:tests",
			"npm run test:cov",
			"npm run check:dead-code",
			"npm run check-release",
			"npm run lint:cloud-parity",
			"git diff --check",
		]) {
			expect(ci, step).toContain(step);
		}
	});

	it("keeps the Node 26 look-ahead non-blocking", () => {
		expect(ci).toMatch(/next-node:[\s\S]*?continue-on-error:\s*true/);
	});

	it("never cancels runs on main", () => {
		expect(ci).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
	});
});

describe("Node version", () => {
	it("is 24 in .nvmrc, and workflows that cannot read .nvmrc use the same major", () => {
		const major = read(".nvmrc").trim();
		expect(major).toBe("24");
		expect(attest).toContain(`node-version: ${major}`);
		expect(stripYamlComments(release)).toContain("node-version-file: .nvmrc");
	});

	it("has no engines field (the scorecard rebuild must not complain)", () => {
		expect(JSON.parse(read("package.json"))).not.toHaveProperty("engines");
	});
});
