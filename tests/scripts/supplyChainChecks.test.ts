// Why it matters: the 14-day dependency-age policy is only real while both controls exist
// (.npmrc and Dependabot cooldown) on an npm that honours them. check-release fails if either goes.
import { describe, expect, it } from "vitest";
import {
	checkDependabotCooldown,
	checkNpmrc,
	compareDotted,
	npmSupportsMinReleaseAge,
} from "../../scripts/lib/supplyChainChecks.mjs";

describe("npm version support", () => {
	it("compares dotted versions", () => {
		expect(compareDotted("11.10.0", "11.9.0")).toBe(1);
		expect(compareDotted("11.10.0", "11.10.0")).toBe(0);
		expect(compareDotted("10.9.0", "11.10.0")).toBe(-1);
		expect(compareDotted("11.10", "11.10.0")).toBe(0);
	});
	it("trusts the version, not `npm config get`", () => {
		expect(npmSupportsMinReleaseAge("11.10.0")).toBe(true);
		expect(npmSupportsMinReleaseAge("11.19.1")).toBe(true);
		expect(npmSupportsMinReleaseAge("11.9.0")).toBe(false);
		expect(npmSupportsMinReleaseAge("10.9.2")).toBe(false);
		expect(npmSupportsMinReleaseAge("")).toBe(false);
		expect(npmSupportsMinReleaseAge(undefined)).toBe(false);
	});
});

describe("checkNpmrc", () => {
	it("accepts 14 days or more", () => {
		expect(checkNpmrc("min-release-age=14\n")).toEqual({ ok: true, days: 14, problem: null });
		expect(checkNpmrc('tag-version-prefix=""\nmin-release-age = "30"\n').days).toBe(30);
	});
	it("rejects a missing file, a missing key, a short window and junk", () => {
		expect(checkNpmrc(null).problem).toMatch(/missing/);
		expect(checkNpmrc("tag-version-prefix=\n").problem).toMatch(/does not set/);
		expect(checkNpmrc("min-release-age=7").problem).toMatch(/minimum is 14/);
		expect(checkNpmrc("min-release-age=soon").problem).toMatch(/whole number/);
	});
	it("ignores a commented-out setting", () => {
		expect(checkNpmrc("# min-release-age=14\n").ok).toBe(false);
	});
});

describe("checkDependabotCooldown", () => {
	const yml = (npmDays: number, actionsDays: number) => `version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    cooldown:
      default-days: ${npmDays}
      semver-major-days: 30
  - package-ecosystem: github-actions
    directory: "/"
    cooldown:
      default-days: ${actionsDays}
`;
	it("accepts both ecosystems with a 14 day cooldown", () => {
		expect(checkDependabotCooldown(yml(14, 14))).toEqual({ ok: true, problems: [] });
	});
	it("reports a missing file, ecosystem, cooldown block, default-days and a short window", () => {
		expect(checkDependabotCooldown(null).problems[0]).toMatch(/missing/);
		expect(
			checkDependabotCooldown("version: 2\nupdates:\n  - package-ecosystem: npm\n    cooldown:\n      default-days: 14\n").problems,
		).toEqual(['no "github-actions" ecosystem in dependabot.yml']);
		expect(checkDependabotCooldown(yml(14, 14).replace(/ {4}cooldown:\n {6}default-days: 14\n$/, "")).problems[0]).toMatch(
			/no cooldown block/,
		);
		expect(checkDependabotCooldown(yml(14, 14).replace("default-days: 14\n      semver", "semver")).problems[0]).toMatch(
			/no default-days/,
		);
		expect(checkDependabotCooldown(yml(3, 14)).problems[0]).toMatch(/default-days is 3/);
	});
	it("ignores a commented-out cooldown", () => {
		const commented = yml(14, 14).replace("    cooldown:\n      default-days: 14\n      semver", "    # cooldown:\n      semver");
		expect(checkDependabotCooldown(commented).ok).toBe(false);
	});
});
