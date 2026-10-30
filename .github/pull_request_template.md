## What and why

<!-- One or two sentences. Link the issue: Closes #N -->

## Checklist

- [ ] Tests added or updated; `npm run test:cov` still 100 %
- [ ] `npm run build`, `npm run lint`, `npm run typecheck:tests` and `npm run check:dead-code` clean
- [ ] CHANGELOG line under the version's `### Fixed` / `### Internal`
- [ ] No new global that older iOS WebViews lack (no `structuredClone`, `.at()`, `Object.hasOwn`, `replaceAll`)
- [ ] Release plan: beta tag on `main` after merge; manifest, package and versions untouched
