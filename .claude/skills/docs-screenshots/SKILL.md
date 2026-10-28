---
name: docs-screenshots
description: Create or refresh the screenshots of the side panel for README and the docs. Use when a panel card or its look changed, when a card or metric was added, before a release whose README or what's new mentions the panel, or when asked for screenshots.
---

# Documentation screenshots

Images in `docs/screenshots/` are **rendered from the real plugin code, never captured by hand**. Synthetic data, the panel's own render code, the real `styles.css`, Obsidian's default theme variables, headless Chromium at 2x, one width (460 px) for every image. (Rules from the playbook: `obsidian-plugin-playbook/DOCS-AND-SCREENSHOTS.md`.)

## How it works
1. `testUtils/screenshots/synthetic.ts` generates 170 days of one fictional person from a fixed seed: drifting HRV and resting heart rate tied to training load, a weekly rhythm with skipped days and a lighter week every fourth, a cold, weekend sleep, missing weigh-ins and water logs, and a story in the last days (heavy block, short night, dry day) so the cards have something to explain. **Never use real data.** Avoid patterns that show at once in the trend bars (alternating values, ramps, copies of one day).
2. `testUtils/screenshots/scenes.ts` is the scene table: id, file, theme, language, the day (`daysBack` from the end of the series), the cards shown, the card whose light bulb is open (the panel opens one at a time) and selectors that must match.
3. `testUtils/screenshots/capture.shots.ts` (run by vitest with the same Obsidian mock as the tests, config `testUtils/screenshots/vitest.config.mts`) opens the real `HealthPanelView` per scene and writes its HTML.
4. `scripts/render-screenshots.mjs` wraps that HTML in the theme variables and `styles.css`, asks Chromium for the page height, and screenshots at exactly that height. It finds the browser from `$CHROME_HEADLESS_SHELL`, then Playwright's cache (`ms-playwright/chromium_headless_shell-*`), then `which chromium`; no npm dependency. It fails when a scene selector stops matching, a card shows "no reading", an icon is missing, or `styles.css` reads an Obsidian variable the screenshot theme lacks.

## Steps
1. Make the UI or data change. A new card: add it to a scene (or a new scene) in `scenes.ts` and give the synthetic series the metrics it needs.
2. `npm run screenshots` (all scenes) or `npm run screenshots -- panel-today panel-hydration` (named ones). `npm run check:screenshots` renders into a temp folder and touches nothing; run it before a PR.
3. **Open every PNG with the Read tool and look at it.** The check cannot see wrong content: odd values (a "poor" readiness on a good-day scene, an orange "low" tag), clipped text, a card that is empty, a day that sits in the story block by accident. If the data looks wrong, change the series or `daysBack`, not the image.
4. Cross-check README: the gallery sits under "Health side panel" in all six READMEs (`README*.md`); a new image needs an `<img>` with alt text in each language.
5. Commit script, scenes, data and images together in the feature PR.
6. Before a stable release show the images to Daniel and wait for approval.

## Not done here
- The what's new window is plain text (no images). To show a picture there, link a raw GitHub URL of a released image; that is a network request and a design decision, not part of this script.
- Obsidian's own chrome (tabs, sidebar frame) is not drawn; the images are the panel only.
