// Why it matters: these predicates are the release guard. A wrong "ok" here lets a beta version
// onto main (delisting), or a stable release go out without its asset files.
import { describe, expect, it } from "vitest";
import {
	checkCommittedManifestStable,
	checkManifestFields,
	checkMinAppVersion,
	checkStoreListing,
	checkTagMatchesManifest,
	checkToolchain,
	checkVersionSync,
	checkVersionsJson,
	compareCore,
	filesMissingNormalizePath,
	findNodeOnlyImports,
	isBetaTag,
	isStable,
	parseSemver,
} from "../../scripts/lib/releaseChecks.mjs";

const manifest = () => ({
	id: "garmin-health-sync",
	name: "Garmin Health Sync",
	version: "0.11.0",
	minAppVersion: "1.13.0",
	description: "Sync Garmin Connect health data into your Daily Notes as frontmatter properties.",
	author: "fcandi",
	authorUrl: "https://github.com/fcandi",
	isDesktopOnly: false,
});

describe("semver helpers", () => {
	it("parses stable and prerelease versions and rejects the rest", () => {
		expect(parseSemver("0.11.1-beta.2")).toEqual({ major: 0, minor: 11, patch: 1, pre: "beta.2" });
		expect(parseSemver("1.2.3")?.pre).toBeNull();
		expect(parseSemver("1.2")).toBeNull();
	});

	it("compares the numeric core, not the suffix", () => {
		expect(compareCore("0.9.10", "0.9.9")).toBe(1);
		expect(compareCore("0.10.0", "0.9.11")).toBe(1);
		expect(compareCore("0.11.0", "0.11.0-beta.1")).toBe(0);
		expect(compareCore("0.9.0", "1.0.0")).toBe(-1);
		expect(() => compareCore("x", "1.0.0")).toThrow(/not semver/);
		expect(() => compareCore("1.0.0", "y")).toThrow(/not semver/);
	});

	it("tells stable from beta", () => {
		expect(isStable("0.11.1")).toBe(true);
		expect(isStable("0.11.1-beta.1")).toBe(false);
		expect(isBetaTag("0.11.1-beta.12")).toBe(true);
		expect(isBetaTag("0.11.1-rc.1")).toBe(false);
	});
});

describe("checkToolchain", () => {
	it("accepts node 24+ with npm 11.10+", () => {
		expect(checkToolchain("v24.1.0", "11.10.0")).toEqual([]);
		expect(checkToolchain("v26.10.0", "11.19.1")).toEqual([]);
		expect(checkToolchain("v24.0.0", "12.0.0")).toEqual([]);
	});

	it("rejects older node and older npm with a fix in the message", () => {
		expect(checkToolchain("v22.12.0", "11.10.0")[0]).toMatch(/older than 24/);
		expect(checkToolchain("v24.0.0", "10.9.0")[0]).toMatch(/npm@11/);
		expect(checkToolchain("v24.0.0", "11.9.9")[0]).toMatch(/older than 11\.10/);
		expect(checkToolchain("nonsense", "nonsense")).toHaveLength(2);
	});
});

describe("checkManifestFields", () => {
	it("accepts the real manifest shape", () => {
		expect(checkManifestFields(manifest())).toEqual([]);
	});

	it.each([
		["a missing field", { version: "" }, /version is missing/],
		["a long description", { description: `${"a".repeat(250)}.` }, /251 chars/],
		["no final period", { description: "No period" }, /end with a period/],
		["boilerplate", { description: "This is a plugin for things." }, /This is a plugin/],
		["emoji", { description: "Heart ❤️." }, /emoji/],
		["a non-kebab id", { id: "Garmin_Sync" }, /kebab-case/],
		["obsidian in the id", { id: "my-obsidian-sync" }, /obsidian/],
		["an id ending in plugin", { id: "garmin-sync-plugin" }, /end with "plugin"/],
		["a non-boolean isDesktopOnly", { isDesktopOnly: "no" }, /boolean/],
		["a non-http authorUrl", { authorUrl: "ftp://x" }, /http\(s\)/],
	])("flags %s", (_label, patch, re) => {
		expect(checkManifestFields({ ...manifest(), ...patch }).join(";")).toMatch(re);
	});

	it("allows an absent authorUrl", () => {
		const m: Record<string, unknown> = manifest();
		delete m.authorUrl;
		expect(checkManifestFields(m)).toEqual([]);
	});
});

describe("checkVersionSync", () => {
	const lock = (v: string) => ({ version: v, packages: { "": { version: v } } });
	it("passes when manifest, package.json and lock agree", () => {
		expect(checkVersionSync({ version: "0.11.0" }, { version: "0.11.0" }, lock("0.11.0"))).toEqual([]);
		expect(checkVersionSync({ version: "0.11.0" }, { version: "0.11.0" }, null)).toEqual([]);
	});
	it("reports each disagreement", () => {
		expect(checkVersionSync({ version: "0.11.1" }, { version: "0.11.0" }, lock("0.11.0"))).toHaveLength(1);
		expect(checkVersionSync({ version: "0.11.0" }, { version: "0.11.0" }, lock("0.10.0"))).toHaveLength(2);
		expect(checkVersionSync({ version: "0.11.0" }, { version: "0.11.0" }, { version: "0.11.0", packages: {} })).toHaveLength(1);
	});
});

describe("checkVersionsJson", () => {
	const good = { "0.9.9": "1.5.4", "0.9.10": "1.5.4", "0.10.0": "1.13.0", "0.11.0": "1.13.0" };
	it("accepts stable, ascending keys that list the stable version", () => {
		expect(checkVersionsJson(good, "0.11.0")).toEqual([]);
	});
	it("does not require a beta to be listed", () => {
		expect(checkVersionsJson(good, "0.11.1-beta.1")).toEqual([]);
	});
	it("requires a stable version to be listed", () => {
		expect(checkVersionsJson(good, "0.11.1")).toEqual(["versions.json has no entry for 0.11.1"]);
	});
	it("rejects prerelease keys and non-semver keys", () => {
		expect(checkVersionsJson({ ...good, "0.11.1-beta.1": "1.13.0" }, "0.11.0")[0]).toMatch(/prerelease/);
		expect(checkVersionsJson({ ...good, junk: "1" }, "0.11.0")[0]).toMatch(/not semver/);
	});
	it("rejects unsorted keys", () => {
		expect(checkVersionsJson({ "0.9.10": "1", "0.9.9": "1" }, "0.9.10")[0]).toMatch(/not sorted/);
		expect(checkVersionsJson({ "0.10.0": "1", "0.9.9": "1" }, "0.10.0")[0]).toMatch(/not sorted/);
	});
});

describe("tag and committed-state checks", () => {
	it("accepts a tag equal to the manifest version", () => {
		expect(checkTagMatchesManifest("0.11.1-beta.1", "0.11.1-beta.1")).toEqual([]);
	});
	it("hints at stamping when a beta tag meets an unstamped tree", () => {
		expect(checkTagMatchesManifest("0.11.1-beta.1", "0.11.0")[0]).toMatch(/stamp-prerelease/);
	});
	it("does not hint for a plain mismatch", () => {
		expect(checkTagMatchesManifest("0.11.1", "0.11.0")[0]).not.toMatch(/stamp-prerelease/);
	});
	it("requires the committed manifest to be stable", () => {
		expect(checkCommittedManifestStable("0.11.0")).toEqual([]);
		expect(checkCommittedManifestStable("0.11.1-beta.1")[0]).toMatch(/prerelease/);
	});
});

describe("checkMinAppVersion", () => {
	it("passes when unchanged, unknown, or explicitly allowed", () => {
		expect(checkMinAppVersion("1.13.0", "1.13.0", false)).toEqual([]);
		expect(checkMinAppVersion("1.13.0", null, false)).toEqual([]);
		expect(checkMinAppVersion("1.14.0", "1.13.0", true)).toEqual([]);
	});
	it("fails on an unannounced change", () => {
		expect(checkMinAppVersion("1.14.0", "1.13.0", false)[0]).toMatch(/--allow-min-app-change/);
	});
});

describe("source scans", () => {
	it("finds node-only imports", () => {
		const files = [
			{ path: "a.ts", text: 'import fs from "node:fs";\nimport x from "obsidian";' },
			{ path: "b.ts", text: 'const e = require("electron");' },
			{ path: "c.ts", text: 'import { a } from "./local";' },
		];
		expect(findNodeOnlyImports(files)).toEqual(['a.ts: import "node:fs"', 'b.ts: import "electron"']);
	});

	it("finds adapter use without normalizePath", () => {
		const files = [
			{ path: "bad.ts", text: "await app.vault.adapter.read(p);" },
			{ path: "ok.ts", text: "await app.vault.adapter.read(normalizePath(p));" },
			{ path: "none.ts", text: "const x = 1;" },
		];
		expect(filesMissingNormalizePath(files)).toEqual(["bad.ts"]);
	});
});

describe("checkStoreListing", () => {
	const versions = { "0.11.0": "1.13.0" };
	const release = (patch = {}) => ({
		isPrerelease: false,
		isDraft: false,
		assets: [{ name: "styles.css" }, { name: "main.js" }, { name: "manifest.json" }],
		...patch,
	});

	it("passes for a published stable release with exactly the three assets", () => {
		expect(checkStoreListing("0.11.0", versions, release())).toEqual([]);
	});
	it("fails when the release does not exist", () => {
		expect(checkStoreListing("0.11.0", versions, null)).toEqual(["no GitHub release 0.11.0 exists yet"]);
	});
	it("fails for a prerelease or a draft", () => {
		expect(checkStoreListing("0.11.0", versions, release({ isPrerelease: true }))[0]).toMatch(/prerelease/);
		expect(checkStoreListing("0.11.0", versions, release({ isDraft: true }))[0]).toMatch(/draft/);
	});
	it("fails when an asset is missing or extra", () => {
		expect(checkStoreListing("0.11.0", versions, release({ assets: [{ name: "main.js" }] }))[0]).toMatch(/assets are/);
		expect(checkStoreListing("0.11.0", versions, release({ assets: undefined }))[0]).toMatch(/assets are \[\]/);
		const extra = [...release().assets, { name: "x.zip" }];
		expect(checkStoreListing("0.11.0", versions, release({ assets: extra }))[0]).toMatch(/assets are/);
	});
	it("fails for a beta version on main and for a missing versions.json entry", () => {
		expect(checkStoreListing("0.11.1-beta.1", versions, release()).join(";")).toMatch(/not a stable version/);
		expect(checkStoreListing("0.11.1", versions, release()).join(";")).toMatch(/no entry for 0.11.1/);
	});
});
