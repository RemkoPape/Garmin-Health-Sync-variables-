// Stamps a prerelease version (x.y.z-beta.N) into the WORKING TREE ONLY: manifest.json,
// package.json and package-lock.json. Run by the release workflow for beta tags; nothing is
// ever committed.
//
// Why: the community directory reads manifest.json on the default branch to decide the latest
// version and only matches it against full releases. A beta version there gets the plugin
// delisted (2026-09-18). BRAT, by contrast, reads manifest.json from the release ASSETS. So the
// committed manifest stays on the current stable version, and only the uploaded asset carries
// the beta version. versions.json is left alone: it lists stable versions only.
//
// Adapted from davadev's obsidian_chinese_comprehensible_input (MIT). The guards live in
// scripts/lib/stamp.mjs.
//
// Usage: node stamp-prerelease.mjs 0.11.1-beta.1

import { readFileSync, writeFileSync } from "fs";
import { stampVersions } from "./scripts/lib/stamp.mjs";

const read = (f) => JSON.parse(readFileSync(f, "utf8"));
const write = (f, v) => writeFileSync(f, `${JSON.stringify(v, null, "\t")}\n`);

try {
	const stamped = stampVersions(
		{ manifest: read("manifest.json"), pkg: read("package.json"), lock: read("package-lock.json") },
		process.argv[2],
	);
	write("manifest.json", stamped.manifest);
	write("package.json", stamped.pkg);
	write("package-lock.json", stamped.lock);
	console.log(
		`stamp-prerelease: working tree stamped ${stamped.stable} -> ${stamped.manifest.version} (committed manifest unchanged)`,
	);
} catch (e) {
	console.error(`stamp-prerelease: ${e.message}`);
	process.exit(1);
}
