// Pure predicates behind scripts/check-release.mjs. No I/O, so tests/scripts/releaseChecks.test.ts
// can exercise every branch; check-release.mjs itself runs its checks on import.
//
// The invariant these protect: main's manifest.json always names a version that already has a
// published, non-prerelease GitHub release with main.js, manifest.json and styles.css. The
// community directory reads main's manifest; BRAT reads the manifest from the release assets.

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Split "x.y.z[-pre]" into numbers, or null when it is not semver. */
export function parseSemver(v) {
	const m = SEMVER.exec(String(v));
	if (!m) return null;
	return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? null };
}

/** Compare the numeric x.y.z parts only (prerelease suffixes are not ordered here). */
export function compareCore(a, b) {
	const pa = parseSemver(a);
	const pb = parseSemver(b);
	if (!pa || !pb) throw new Error(`not semver: ${!pa ? a : b}`);
	for (const k of ["major", "minor", "patch"]) {
		if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
	}
	return 0;
}

export const isStable = (v) => parseSemver(v)?.pre === null;
export const isBetaTag = (v) => /^\d+\.\d+\.\d+-beta\.\d+$/.test(String(v));

/** Node >= 24 and npm >= 11.10 (min-release-age and allowScripts need it). Returns problems. */
export function checkToolchain(nodeVersion, npmVersion) {
	const problems = [];
	const node = /^v?(\d+)\./.exec(String(nodeVersion));
	if (!node || Number(node[1]) < 24) {
		problems.push(`node ${nodeVersion} is older than 24 (see .nvmrc); install Node 24`);
	}
	const npm = /^(\d+)\.(\d+)\./.exec(String(npmVersion));
	if (!npm || Number(npm[1]) < 11 || (Number(npm[1]) === 11 && Number(npm[2]) < 10)) {
		problems.push(`npm ${npmVersion} is older than 11.10; run npm install -g npm@11`);
	}
	return problems;
}

/** Manifest description / id / flag rules from the Obsidian guidelines. Returns problems. */
export function checkManifestFields(manifest) {
	const problems = [];
	for (const k of ["id", "name", "version", "minAppVersion", "description", "author"]) {
		if (typeof manifest[k] !== "string" || manifest[k].length === 0) problems.push(`${k} is missing or empty`);
	}
	const desc = manifest.description;
	if (typeof desc === "string") {
		if (desc.length > 250) problems.push(`description is ${desc.length} chars (max 250)`);
		if (!desc.endsWith(".")) problems.push("description must end with a period");
		if (/^this is a plugin\b/i.test(desc)) problems.push('description must not start with "This is a plugin"');
		if (/\p{Extended_Pictographic}/u.test(desc)) problems.push("description must not contain emoji");
	}
	if (typeof manifest.id === "string") {
		if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) problems.push("id must be lowercase kebab-case");
		if (/obsidian/i.test(manifest.id)) problems.push('id must not contain "obsidian"');
		if (/plugin$/.test(manifest.id)) problems.push('id must not end with "plugin"');
	}
	if (typeof manifest.isDesktopOnly !== "boolean") problems.push("isDesktopOnly must be a boolean");
	if (manifest.authorUrl != null && !/^https?:\/\//.test(String(manifest.authorUrl))) {
		problems.push("authorUrl must be an http(s) URL");
	}
	return problems;
}

/**
 * Version sync: manifest = package.json = lock root. `lock` may be null when unreadable.
 * Returns problems.
 */
export function checkVersionSync(manifest, pkg, lock) {
	const problems = [];
	if (manifest.version !== pkg.version) {
		problems.push(`manifest ${manifest.version} != package.json ${pkg.version}`);
	}
	if (lock) {
		if (lock.version !== pkg.version) problems.push(`package-lock version ${lock.version} != ${pkg.version}`);
		const root = lock.packages?.[""]?.version;
		if (root !== pkg.version) problems.push(`package-lock root version ${root} != ${pkg.version}`);
	}
	return problems;
}

/**
 * versions.json lists stable versions only, ascending, as plain x.y.z. A stable manifest
 * version (or tag) must be listed; a beta must not be. Returns problems.
 */
export function checkVersionsJson(versions, version) {
	const problems = [];
	const keys = Object.keys(versions);
	for (const k of keys) {
		const p = parseSemver(k);
		if (!p) problems.push(`versions.json key "${k}" is not semver`);
		else if (p.pre !== null) problems.push(`versions.json key "${k}" is a prerelease`);
	}
	if (problems.length === 0) {
		for (let i = 1; i < keys.length; i++) {
			if (compareCore(keys[i - 1], keys[i]) >= 0) {
				problems.push(`versions.json is not sorted ascending at "${keys[i]}"`);
				break;
			}
		}
	}
	if (isStable(version) && !(version in versions)) {
		problems.push(`versions.json has no entry for ${version}`);
	}
	return problems;
}

/**
 * The tag must equal the manifest version exactly. A beta tag against an unstamped tree gets
 * a hint, because that is the usual mistake.
 */
export function checkTagMatchesManifest(tag, manifestVersion) {
	if (tag === manifestVersion) return [];
	const unstamped = isBetaTag(tag) && isStable(manifestVersion);
	return [
		`manifest=${manifestVersion}, tag=${tag}` +
			(unstamped ? "; prerelease tag against an unstamped tree, run node stamp-prerelease.mjs first" : ""),
	];
}

/** Without a tag the committed manifest must be a plain stable version. */
export function checkCommittedManifestStable(manifestVersion) {
	return isStable(manifestVersion)
		? []
		: [`committed manifest.version "${manifestVersion}" is a prerelease; main must advertise the stable release`];
}

/**
 * minAppVersion must not change unless explicitly allowed (an iOS App Store Obsidian that is
 * older than minAppVersion cannot install the plugin through BRAT). `latestStableMin` is the
 * minAppVersion of the latest stable release, or null when unknown.
 */
export function checkMinAppVersion(manifestMin, latestStableMin, allowChange) {
	if (latestStableMin === null || allowChange || manifestMin === latestStableMin) return [];
	return [
		`minAppVersion ${manifestMin} differs from the latest stable release (${latestStableMin}); ` +
			"pass --allow-min-app-change only if intended",
	];
}

/** Remove YAML comments (a # at line start or after whitespace). */
export function stripYamlComments(text) {
	return String(text)
		.split("\n")
		.map((l) => l.replace(/(^|\s)#.*$/, ""))
		.join("\n");
}

/** Split a workflow (comments already stripped) into its "- name:" / "- uses:" step blocks. */
export function workflowSteps(code) {
	const starts = [...code.matchAll(/^\s*-\s+(?:name|uses|run):/gm)].map((m) => m.index);
	return starts.map((from, i) => code.slice(from, i + 1 < starts.length ? starts[i + 1] : code.length));
}

/**
 * The release workflow must keep its guards. Matching is done on comment-stripped text and on
 * the actual step, so a comment (or a deleted step that is still mentioned in prose) cannot
 * satisfy it. Returns problems.
 */
export function checkReleaseWorkflow(text) {
	const code = stripYamlComments(text);
	const steps = workflowSteps(code);
	const problems = [];

	const attest = steps.find((b) => /^\s*-?\s*uses:\s*actions\/attest(-build-provenance)?@/m.test(b));
	if (!attest) problems.push("no actions/attest step");
	else {
		const missing = ["main.js", "manifest.json", "styles.css"].filter((f) => !attest.includes(f));
		if (missing.length) problems.push(`attest step does not list: ${missing.join(", ")}`);
	}
	if (!steps.some((b) => /stamp-prerelease\.mjs/.test(b) && /-beta\./.test(b))) {
		problems.push("no beta stamp step (stamp-prerelease.mjs for -beta. tags)");
	}
	if (!steps.some((b) => /merge-base --is-ancestor/.test(b) && /release\//.test(b))) {
		problems.push("no tag-location step (beta on main, stable on main or release/*)");
	}
	if (!steps.some((b) => /-s main\.js/.test(b) && /-s styles\.css/.test(b) && /-s manifest\.json/.test(b))) {
		problems.push("no artifact validation step (non-empty main.js, manifest.json, styles.css)");
	}
	if (!/npm run test:cov/.test(code)) problems.push("release does not run npm run test:cov");
	if (!/check-release[^\n]*--strict/.test(code)) problems.push("release does not run check-release --strict");
	if (!/concurrency:\s*\n\s*group:\s*release\s*\n\s*cancel-in-progress:\s*false/.test(code)) {
		problems.push("release concurrency must be group: release with cancel-in-progress: false");
	}
	if (!/--prerelease/.test(code) || !/--latest/.test(code)) {
		problems.push("release must pass --prerelease for betas and --latest for stable");
	}
	if (!/node-version-file:\s*\.nvmrc/.test(code)) problems.push("release must take Node from .nvmrc");
	return problems;
}

/** Node-only specifiers that crash on Obsidian mobile unless isDesktopOnly is true. */
export const NODE_ONLY_IMPORTS = [
	"fs",
	"node:fs",
	"path",
	"node:path",
	"child_process",
	"node:child_process",
	"os",
	"node:os",
	"electron",
];

/** Find node-only imports in `files` ([{path, text}]). */
export function findNodeOnlyImports(files) {
	const out = [];
	const re = /(?:from|require\s*\()\s*['"]([^'"]+)['"]/g;
	for (const f of files) {
		for (const m of f.text.matchAll(re)) {
			if (NODE_ONLY_IMPORTS.includes(m[1])) out.push(`${f.path}: import "${m[1]}"`);
		}
	}
	return out;
}

/** Files that touch vault.adapter.* without ever calling normalizePath(). */
export function filesMissingNormalizePath(files) {
	const adapterCall = /\badapter\.\s*(?:read|write|exists|mkdir|list|append|remove|rename)\b/;
	return files
		.filter((f) => adapterCall.test(f.text) && !/\bnormalizePath\s*\(/.test(f.text))
		.map((f) => f.path);
}

/**
 * Store-listing check: a version that main advertises must already be a published, non-prerelease
 * GitHub release with exactly main.js, manifest.json and styles.css. `release` is the parsed
 * `gh release view --json isPrerelease,isDraft,assets` output, or null when it does not exist.
 */
export function checkStoreListing(version, versions, release) {
	const problems = [];
	if (!isStable(version)) problems.push(`${version} is not a stable version`);
	problems.push(...checkVersionsJson(versions, version));
	if (!release) {
		problems.push(`no GitHub release ${version} exists yet`);
		return problems;
	}
	if (release.isPrerelease) problems.push(`release ${version} is a prerelease`);
	if (release.isDraft) problems.push(`release ${version} is a draft`);
	const names = (release.assets ?? []).map((a) => a.name).sort();
	const want = ["main.js", "manifest.json", "styles.css"];
	if (names.join() !== want.join()) problems.push(`release ${version} assets are [${names.join(", ")}], expected [${want.join(", ")}]`);
	return problems;
}
