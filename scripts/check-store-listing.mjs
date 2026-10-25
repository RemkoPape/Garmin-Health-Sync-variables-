#!/usr/bin/env node
// CI gate: main's manifest.json must always name a version that already has a published,
// non-prerelease GitHub release (see scripts/lib/releaseChecks.mjs, checkStoreListing).
//
//   node scripts/check-store-listing.mjs [--base <git-ref>]
//
// With --base, the check only applies when the version differs from the base ref's manifest
// (a PR that bumps the version). Without it, it always applies (push to main). Needs `gh`
// with GH_TOKEN. On a release PR this is red until the stable tag has published, by design.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { checkStoreListing } from "./lib/releaseChecks.mjs";

const argv = process.argv.slice(2);
const baseIdx = argv.indexOf("--base");
const base = baseIdx === -1 ? null : argv[baseIdx + 1];

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(readFileSync("versions.json", "utf8"));

if (base) {
	const shown = spawnSync("git", ["show", `${base}:manifest.json`], { encoding: "utf8" });
	if (shown.status !== 0) {
		console.error(`cannot read manifest.json at ${base}: ${shown.stderr.trim()}`);
		process.exit(1);
	}
	const baseVersion = JSON.parse(shown.stdout).version;
	if (baseVersion === manifest.version) {
		console.log(`manifest version unchanged (${manifest.version}); nothing to check`);
		process.exit(0);
	}
	console.log(`manifest version changes ${baseVersion} -> ${manifest.version}`);
}

const view = spawnSync(
	"gh",
	["release", "view", manifest.version, "--json", "isPrerelease,isDraft,assets"],
	{ encoding: "utf8" },
);
let release = null;
if (view.status === 0) release = JSON.parse(view.stdout);
else if (!/not found/i.test(view.stderr)) {
	console.error(`gh release view failed: ${view.stderr.trim()}`);
	process.exit(1);
}

const problems = checkStoreListing(manifest.version, versions, release);
if (problems.length) {
	for (const p of problems) console.error(`FAIL ${p}`);
	process.exit(1);
}
console.log(`ok: ${manifest.version} is a published stable release with all three assets`);
