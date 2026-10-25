# Release process

## The invariant

The Obsidian community directory reads `manifest.json` **on `main`** to decide which version to advertise, then downloads the assets of the GitHub release with exactly that tag. Only full (non-prerelease) releases count. BRAT reads `manifest.json` **from the release assets** and takes the highest semver, prereleases included.

> **`main`'s `manifest.json` always names a version that already has a published, non-prerelease GitHub release with `main.js`, `manifest.json` and `styles.css`.**

A `-beta.N` manifest on `main` got the plugin delisted on 2026-09-18. Every guard below exists to make a way of breaking that invariant fail mechanically.

## Guards

| Guard | Where | Stops |
|---|---|---|
| Beta version is stamped into the working tree in CI, never committed | `stamp-prerelease.mjs` (logic in `scripts/lib/stamp.mjs`) | a beta on `main`; a beta below the stable version |
| Beta tags must be on `main`, stable tags on `main` or a `release/*` branch | `release.yml` | unreviewed code being published |
| Lint, typecheck, build, tests with coverage, `check-release --strict`, artifact validation, all before publishing | `release.yml` | a broken or empty `main.js` / `styles.css` |
| `store-listing` required check | `ci.yml`, `scripts/check-store-listing.mjs` | merging a version bump before its release exists |
| `check-release` (local, CI, release) | `scripts/check-release.mjs` | version drift, `minAppVersion` changes, unsorted `versions.json`, vulnerable runtime deps, an inconsistent dependency tree |
| `releaseGuards.test.ts` | `tests/` | someone simplifying the workflows later |
| Claude Code hook | `.claude/hooks/pre-tag-check.mjs` | tagging past a failing check, pushing every local tag at once, manual release commands |
| Static `concurrency: release`, no cancel | `release.yml` | two tags racing |

## Beta flow

1. Merge the PR into `main` (merge commit). `main`'s manifest stays on the current stable version.
2. `npm run check-release -- --with-build` and `npm run lint:cloud-parity` clean.
3. Add a `## X.Y.Z-beta.N` section to `CHANGELOG.md` (the release notes are taken from it).
4. Tag `main` and push that one tag by name. `release.yml` stamps, tests and publishes a prerelease.
5. Verify with `gh release view`, compare the sha256 of the asset `main.js` with a local build of the tagged commit.
6. A published beta number is never reused; a fix gets the next number.

## Stable flow

Only on an explicit go-ahead, after the last beta ran at least 3 days on phone and desktop. See `.claude/skills/release-stable/SKILL.md`: a `release/X.Y.Z` branch bumps the version, the **branch head** is tagged, `release.yml` publishes, `store-listing` is re-run and turns green, and only then the PR is merged with a merge commit (never squash: the tagged commit must stay reachable from `main`).

## Dependencies

Dev-only, exact-pinned, at least 14 days old (`.npmrc` `min-release-age`, Dependabot cooldown). `@codemirror/state|view` are pinned to obsidian's exact peer versions and `moment` is obsidian's own copy. esbuild is the only dependency whose output lands in `main.js`, so it moves on a release of its own. Install scripts are denied (`allowScripts`). Known unfixed dev-only advisory: `happy-dom` 20.x (fixed in 21.0.4, adopted once it is 14 days old); the tests load no untrusted content.
