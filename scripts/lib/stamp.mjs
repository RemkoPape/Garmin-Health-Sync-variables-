// Pure core of stamp-prerelease.mjs, kept free of I/O so tests/scripts/stamp.test.ts can cover every guard.
import { compareCore, isStable } from "./releaseChecks.mjs";

const BETA = /^(\d+\.\d+\.\d+)-beta\.\d+$/;

/**
 * Compute the stamped copies of manifest, package.json and package-lock for a beta tag.
 * Throws an Error with a user-facing message on any invalid input. Inputs are not mutated.
 * versions.json is deliberately not part of this: it lists stable versions only.
 */
export function stampVersions({ manifest, pkg, lock }, rawTag) {
	const tag = String(rawTag ?? "");
	const m = BETA.exec(tag);
	if (!m) throw new Error(`not a beta tag: "${tag}" (expected x.y.z-beta.N)`);
	const base = m[1];
	const stable = manifest.version;
	// The committed manifest must be a plain stable version; a suffix means a beta was committed.
	if (!isStable(stable)) throw new Error(`committed manifest.json is already a prerelease ("${stable}")`);
	// A beta must target the NEXT version, otherwise BRAT ranks it below the stable release.
	if (compareCore(base, stable) <= 0) throw new Error(`${tag} is not newer than the current stable ${stable}`);

	const nextLock = { ...lock, version: tag };
	if (lock.packages?.[""]) nextLock.packages = { ...lock.packages, "": { ...lock.packages[""], version: tag } };
	return {
		stable,
		manifest: { ...manifest, version: tag },
		pkg: { ...pkg, version: tag },
		lock: nextLock,
	};
}
