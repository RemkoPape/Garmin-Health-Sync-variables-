# Changelog

## 0.11.2-beta.3

### Fixed

- The close icon of the "what's new" window now works like **Got it** instead of being hidden. Escape, a click next to the window and the Android back gesture still do nothing, so the window cannot vanish by accident.

### Internal

- Dev tooling: ESLint 10.12.0 and `@eslint/js` 9.39.5 (Dependabot group, #45).

## 0.11.2-beta.2

### Changed

- The "what's new" window of this release now also recalls that 0.11.0 brought mobile compatibility, says that 0.11.1 and 0.11.2 focus on stability and groundwork, and mentions the planned side panel with data visualisation. This recap and outlook are a one-off for this release.

### Internal

- ESLint 10 (the 9 line is end-of-life). Lint rule set unchanged: 174 configured, 141 enabled, 38 `obsidianmd/*`, 43 `@typescript-eslint/*` before and after, empty stderr. `@eslint/js` stays on 9 because eslint-plugin-obsidianmd peers it.

## 0.11.2-beta.1

### Fixed

- Activities with empty-string start coordinates are no longer read as the point (0, 0), so no pointless place lookup is sent (#25).
- Body Battery minimum and maximum no longer break on an absurdly large response (#29).
- The 30 second timeout of a data request is cleared as soon as the request has finished instead of lingering (#26, the timeout still does not feed the sign-in backoff).
- An internal sign-in error message is in English like the rest of the log (#28).

### Added

- A "what's new" window after an update, in all six languages. It closes only with its **Got it** button, shows once per device, and not on a new install. The command **Show what's new** opens it again. There is no setting for it.

### Changed

- The README links the releases page of this repository (it pointed at the original repository) and credits the original author, fcandi, in all languages.

### Internal

- Dev tooling updated (obsidian 1.14.4 with its exact `@codemirror` peers, TypeScript 5.9, typescript-eslint 8.71, happy-dom 20.14.6 security fix, knip, jiti, tslib, globals 17) and GitHub Actions moved to checkout 7, setup-node 7, upload-artifact 7.0.2. The built `main.js` is byte-identical.

## 0.11.1

### Fixed

- Notes are written atomically: if you keep typing in an open daily note while it syncs, what you typed is kept (before, the sync could overwrite it with the version it had read a moment earlier).
- If the plugin fails to load, the real reason is shown in a notice (on iPhone Obsidian's own message says nothing), and a failing settings save at startup no longer stops the plugin from loading.
- Failures in background work (auto-sync, backfill, the sign-in button in the notice) are logged instead of being left as unhandled errors, which a phone can report as a plugin load failure.
- The "open in browser" button of the manual sign-in dialog opens the page in the window the dialog is in, also in a pop-out window.
- **Sync current note** now syncs the day of the note you have open also when your daily note name contains more than year, month and day (for example `2026-10-21 Wed` or `21 Oct 2026`). Before, it wrote yesterday's data into that note. Opening such a note also triggers the automatic sync again.
- Sleep and sleep phase durations no longer show "60min" (7h 59m 45s was written as "7h 60min"; it is now "8h 0min").
- Backfill now waits between days after a failed day too, so a single rate-limit error no longer makes the next days fail as well. Its dialog pre-fills today's and last week's date in your local time (it used UTC, so after midnight or in the evening it was off by a day).
- The copy-link button in the manual sign-in dialog no longer fails silently when the clipboard is blocked; it tells you.
- The "frontmatter is broken" notice is now shown in your language instead of always in German.
- Notes that start with a byte order mark (BOM) before the properties are recognised; a second properties block is no longer added above the mark.
- Workout locations keep Vietnamese and other Latin names whole ("Hà Nội" was written as "Hà").
- A value Garmin sends in an unexpected form (for example text where a number is expected) is no longer written into your note as "NaN"; it is skipped.
- Intensity minutes are counted when Garmin sends vigorous minutes but no moderate value.
- Settings no longer share their toggles and sync times with the built-in defaults (a latent bug that made behaviour depend on what ran before).

### Changed

- Removed the "Stress duration" and "Recovery duration" switches: they never wrote anything. They will return once they work (#31).

### Internal

- Test tooling (vitest with coverage, a mock of the Obsidian API), a dead-code check, CI on every pull request and on `main`, and stricter release guards: releases only from tags on `main` (stable also from a `release/*` branch), tests and coverage before any release is published, and a check that the version the store advertises always has a published stable release. The whole source is at 100 % coverage and CI fails below that.
- `styles.css` is linted like Obsidian's review does (no `!important`, no partially supported CSS features), in CI, in the release workflow and in the release check. Lint fails on warnings, and the release check refuses a plugin id that ends in "plugin".
- Removed code nothing called (an unused sign-in option, a heart rate helper, a state check, unreachable branches). The Garmin provider's nine request groups share one helper.
- Known limitations are tracked as issues #23 (closing marker with trailing space), #24 (token answer without access token), #25 (empty coordinates), #26 to #29.

## 0.11.0

### Added

- Mobile support (iOS and Android). The plugin now signs in with your Garmin email and password (plus a verification code if your account uses two-step verification) on every platform, without a browser. If Garmin blocks or rate-limits that attempt, a countdown shows when you can retry and a guided browser sign-in (sign in on Garmin's page, paste the one-time ticket back) is offered as a backup on every platform. A copyable diagnostics log (no password or tokens) helps with bug reports.
- New **Copy diagnostics** button in the settings: copies a short log of the last sync (per data type: HTTP status, response type and size, timing, error type) for bug reports. It contains no tokens, account data or health values.
- The sync log in **Copy diagnostics** now also shows, per data type, how many fields Garmin returned and which day it answered for, a short list of response headers (names, plus cache hints and cookie names, never cookie values), and how many fields each mapper filled. On mobile, when a sync finds no data, it also asks Garmin for the daily summary a few more times with one request detail changed each time and logs how the answers differ. This helps find platform-specific causes of empty results. It still contains no tokens, account data or health values.
- The sign-in and verification-code buttons now show "Please wait…" and are disabled while the request runs.

### Changed

- A sync that fails (token refresh, profile lookup, network error, timeout, or every request failing) now shows the sync error notice instead of "No health data available". The "no data" notice is kept for days Garmin really has no data for. If only some data types fail, the sync continues and the failures appear in the diagnostics.
- Garmin sign-in tokens are now stored in Obsidian's secret storage instead of `data.json`, so they are no longer synced to other devices or committed with the vault. Existing desktop sessions are moved over automatically on first start, with no new login. Each device signs in separately. Once a device has migrated, the synced `data.json` no longer holds the tokens, so devices still running an older plugin version are signed out.

### Fixed

- Running **Sync current note** (or Backfill for a single day) a second time for the same date repeated the first answer until Obsidian was restarted, so today's steps and other values stayed stale. Every sync now asks Garmin again.
- Backfill now keeps its result on screen for 10 seconds, reports how many days failed, hides the "Starting backfill..." notice when done, and tells you when sign-in is required instead of stopping silently.

## 0.10.4

### Added

- New optional metrics `body_battery_min` and `body_battery_max`: the lowest and highest body battery level of the day, taken from Garmin's level time series. This is what the Garmin app shows in its history. Off by default like the other extended metrics. (#10)

### Changed

- Diagnostics for empty mapper results (#8): when an endpoint returns data but the mapper produces nothing, the console now lists the top-level key names of the response (names only, no values). This makes an unexpected payload shape visible directly in a bug report.

- `body_battery` now reads only Garmin's `charged` field, the sum of all body battery gains over the day. The previous fallbacks to other fields (`bodyBatteryMostRecentValue`, `chargedValue`, ...) mixed a level with a daily sum and are gone: if `charged` is missing, the value is simply not written. The readme (all languages) now explains what the value means. (#10)

## 0.10.3

### Added

- New setting **Create daily note when missing**, on by default, which keeps the previous behaviour. Switched off, the background auto-sync stops creating daily notes on its own: it waits until a real daily note for that day exists and only then writes the health data into it. This is for setups where another tool owns note creation, such as a template plugin, the Calendar plugin, or notes arriving from another device through a sync plugin.
  - A waiting day costs no Garmin request and gets no cooldown. It syncs as soon as the note has content, whether the note is created with its content, filled in a second step by a template, or arrives through a vault sync.
  - Empty placeholder notes, for example the 0-byte file a click in the Calendar plugin creates, do not count as existing yet.
  - Manual **Sync current note** and **Backfill** are unaffected and still create notes, since they are explicit user actions.

### Fixed

- Daily notes whose filename format contains `/` (for example `YYYY/YYYY-MM-DD`, a common setting in the core Daily Notes plugin that this plugin adopts automatically) were written to the right subfolder but no longer recognised as daily notes: auto-sync did not trigger when opening them, and **Sync current note** silently fell back to yesterday's date instead of the date of the open note. The date is now recovered from the note path relative to the configured folder instead of from the filename alone. Formats without `/` keep matching at any depth below the configured folder, so existing setups are unaffected.
- The filename format now also understands moment's literal escapes, so a format like `YYYY-MM-DD [Workout]` is recognised as well. Repeated tokens must agree, so `YYYY/YYYY-MM-DD` no longer matches a note filed under the wrong year.

### Documentation

- The readme (all languages) documents how folder, filename format and date-based subfolders interact, including examples, and describes the new setting.

## 0.10.3-beta.3

### Fixed

- **Create daily note when missing** (off): the sync now also resumes when a note that was created empty later gets its content. Previously only the note's creation was watched, and an empty note is deliberately not accepted as existing — so the exact setups this setting is for (the Calendar plugin creating a placeholder, Templater filling it afterwards, a note arriving through vault sync in two steps) kept waiting until the next Obsidian start. The follow-up sync fires once per waiting day; editing an already synced note does not trigger anything.

### Internal

- The vault event handler for the wait-for-note mode no longer walks the vault. It compares paths instead of searching for the expected note, so unrelated file activity anywhere in the vault costs nothing.

## 0.10.3-beta.2

### Added

- New setting **Create daily note when missing** (on by default, which matches the previous behaviour). When switched off, the background auto-sync no longer creates daily notes on its own: it waits until a real daily note for that day exists and only then writes the health data into it. This is for setups where another tool owns note creation — a template plugin, the Calendar plugin, or notes arriving from another device via a sync plugin — and the plugin should not race it.
  - While waiting, the missing day costs no Garmin request and gets no cooldown; it is picked up the moment the note appears. Creating the note triggers the sync immediately, including notes that arrive through a vault sync from another device.
  - Empty placeholder notes (for example the 0-byte file a click in the Calendar plugin creates) do not count as existing yet — the sync keeps waiting until the note has content.
  - Manual **Sync current note** and **Backfill** are unaffected and still create notes, since they are explicit user actions.

## 0.10.3-beta.1

### Fixed

- Daily notes whose filename format contains `/` (e.g. `YYYY/YYYY-MM-DD`, a common setting in the core Daily Notes plugin that this plugin adopts automatically) were written to the right subfolder but no longer recognised as daily notes: auto-sync did not trigger when opening them, and **Sync current note** silently fell back to yesterday's date instead of the open note's date. The date is now recovered from the note path relative to the configured folder instead of from the filename alone. Formats without `/` keep matching at any depth below the configured folder, so existing setups are unaffected.
- The filename format now also understands moment's literal escapes, so a format like `YYYY-MM-DD [Workout]` is recognised as well. Repeated tokens must agree (`YYYY/YYYY-MM-DD` no longer matches a note filed under the wrong year).

### Documentation

- The readme (all languages) documents how folder, filename format and date-based subfolders interact, including examples.

## 0.10.2

### Internal

- Resolve the remaining review warnings, which came from type declarations the review environment does not install: the `moment` calls and the Electron `require` are now typed locally (no behavior change), and the TypeScript `lib` gained `DOM.Iterable`. Lint is verified clean even in a simulated review environment without the `moment` and `@types/node` packages.

## 0.10.1

### Internal

- Resolve all type-safety warnings from the community-directory review: the TypeScript `lib` setting now matches the APIs the code actually uses (`Object.entries`, `padStart`, named regex groups), which removes every `no-unsafe-*` finding; the session-expired notice uses Obsidian's `createEl` helpers instead of `document.createElement`; two redundant type assertions dropped. The local lint config now mirrors the review bot's type-aware rules so this class of finding is caught before release. No functional changes.

## 0.10.0

### Changed

- The settings tab now uses Obsidian's declarative settings API (`getSettingDefinitions()`), resolving the community-directory review warning about the deprecated imperative `display()` approach. Settings are unchanged in content; extended metrics moved from an inline collapsible section to a navigable sub-page, and plugin settings now appear in Obsidian's settings search.
- **Requires Obsidian 1.13.0 or newer.** Users on older Obsidian versions stay on 0.9.11.

## 0.9.11

### Internal

- Resolve a community-directory review finding: the manual-login ticket field now uses a translatable, sentence-case placeholder instead of a hardcoded one, removing a disallowed lint-rule exception. No change to how the login works.

## 0.9.10

A reliability release focused on the Garmin login.

### Added

- **Sign in via browser** — a guided login that completes the sign-in in your normal web browser and hands the result back to the plugin. Start it from the plugin settings, or let the plugin open it for you automatically when the in-app login window can't finish. After you sign in, **Sign in from clipboard** completes the login in one click — no copy-pasting of tokens.

### Fixed

- The Garmin login is much more robust (issue #6). The in-app login window now identifies as a normal desktop browser, keeps the sign-in in its own session, and reads the login ticket directly from the network — so it completes on setups where it previously stalled or jumped to an external browser. Where the embedded window still can't finish, the guided browser login takes over instead of failing.
- If the public OAuth key endpoint is blocked on your network, the plugin falls back to bundled keys instead of failing the login.
- Empty API responses (for example heart-rate variability on a day with no reading) no longer raise an error during sync.

## 0.9.10-beta.7

### Fixed

- Login (issue #6): capture the SSO service ticket at the network layer, not just
  via DOM/navigation events. The login window's session now watches
  `webRequest.onBeforeRedirect`/`onCompleted` for the `302 → /sso/embed?ticket=ST-…`
  and reads the ticket straight from the redirect — so it is captured even when the
  embedded window fires no `did-navigate` and even if the follow-up navigation
  escapes to the system browser. The same hook logs each `/sso/signin` request's
  HTTP status, which pins down whether the sign-in stalls on a capture problem or a
  Cloudflare block. Registration is guarded so it can never disturb the existing
  capture paths.

### Changed

- The guided browser login is now a clearly offered path rather than a dead end:
  the "Sign in via browser" button has an explanatory tooltip, and when the in-app
  sign-in produces no ticket the plugin shows a short notice before opening the
  guided browser login instead of popping the dialog wordlessly.

## 0.9.10-beta.6

### Fixed

- Login (issue #6): on setups where the embedded sign-in never hands the ticket
  to the login window (it stalls on the form or escapes to the system browser),
  the plugin could only fail. The login window now presents a stock desktop-Chrome
  User-Agent (no `obsidian`/`Electron` markers) and uses its own persistent
  session, so Garmin treats it like the regular browser in which the manual login
  already works. And if no ticket is captured, the plugin now automatically opens
  the guided browser login instead of reporting a bare failure.

### Added

- Manual login: a "Sign in from clipboard" button that reads the `ST-…` ticket
  (or the full result-page address) straight from the clipboard, so completing
  the guided browser login is a single click — no manual pasting.

## 0.9.10-beta.5

### Fixed

- Login (issue #6): for accounts where Garmin delivers the sign-in ticket by
  opening the service URL in a *new* window, Obsidian forwarded that open to the
  system browser and the one-time ticket was lost. The login window now
  intercepts the new-window hand-off at the Electron main-process level
  (`setWindowOpenHandler`), reads the ticket straight from the URL, and keeps it
  inside the plugin — so the login completes even if a browser window still
  briefly appears.
- Tolerate empty API responses (e.g. heart-rate variability on a day with no
  reading): an empty `200` body no longer raises a JSON parse error mid-fetch.

## 0.9.10-beta.4

### Fixed

- Two more ways the embedded login could escape to the system browser on
  credential submit (issue #6): a programmatic `form.submit()` carrying a
  `target` (fires no submit event, so the previous listener never saw it) and a
  `<base target>` default browsing context. The login window now strips every
  `target` attribute proactively (including dynamically added ones) and patches
  `form.submit()` directly.

### Internal

- The login window now logs all navigation events and in-page interception
  diagnostics (`GHS_DIAG`, ticket-redacted, no query strings) to the developer
  console, so bug reports can name the exact escape vector.

## 0.9.10-beta.3

### Added

- Manual login fallback (issue #6): if the embedded Garmin login window never
  completes the sign-in — it silently stalls on the form for some accounts, or
  escapes to the system browser — you can now finish the login yourself. The new
  **Manual login** button in settings (or the "Log in with service ticket" command)
  opens the Garmin sign-in page in your browser; after signing in you paste the
  resulting `ticket=ST-…` address back into the plugin and the regular token
  exchange takes over. Verified end-to-end by an affected tester (7/7 days synced).

### Fixed

- Login no longer fails on networks where AWS S3 is blocked (issue #6): the public
  OAuth consumer keys were fetched exclusively from a third-party S3 bucket, making
  it a single point of failure even when Garmin itself was reachable. The plugin
  now falls back to bundled keys (identical, long-stable values) whenever that
  fetch fails.

## 0.9.10-beta.2

### Fixed

- Garmin login could fail with the sign-in window stuck on the Sign In screen while
  the ticket page opened in your external browser instead (issue #6). Garmin
  sometimes completes the login in a new window, which Obsidian forwards to the
  system browser — out of the plugin's reach. The plugin now keeps that final step
  inside its own login window, picks the ticket up from Garmin's in-page success
  event as an additional path, and captures (then closes) any popup that still
  slips through.

## 0.9.10-beta.1

### Fixed

- Garmin login could fail right after entering your credentials, leaving you on a
  page showing `{serviceUrl: …, serviceTicket: 'ST-…'}` (issue #6). Your sign-in had
  actually succeeded — the plugin just didn't recognise the login ticket in that
  form. Ticket detection is now broader and re-checks on in-page navigations, so the
  login completes reliably.

### Internal

- Login logs now include the plugin version and a redacted diagnostic breadcrumb to
  make bug reports easier to act on.

## 0.9.9

Maintenance release. No functional changes — internal cleanups to comply with the Obsidian plugin guidelines.

### If you're updating from before 0.9.8

Carried over from 0.9.8: the plugin now signs in to Garmin with official sign-in tokens instead of a browser session, so your connection stays alive far longer and refreshes itself in the background. **You'll need to log in to Garmin once** after updating — after that it just keeps going. (Full details in the 0.9.8 notes below.)

### Changed

- Raised the minimum required Obsidian version to 1.5.4. The plugin already relied on APIs introduced in that version (`Vault.createFolder`), so this only makes the existing requirement explicit.
- Internal: use `activeDocument` and `window.setTimeout` instead of the global `document` / `setTimeout` for popout-window compatibility.

## 0.9.8

This update changes how the plugin signs in to Garmin. Instead of a browser session that quietly expired after a couple of hours, it now uses Garmin's official sign-in tokens — so your connection stays alive far longer and keeps refreshing itself in the background.

### What changed for you

- **You stay connected much longer.** The old browser session expired after a few hours, which is what caused the recurring "auto-sync paused" messages. Now you sign in once and the plugin quietly renews the connection on its own.
- **A one-time sign-in.** Because the sign-in method changed, you'll need to log in to Garmin once after installing this update. After that it just keeps going.
- **Clearer messages.** If Garmin ever genuinely needs you to sign in again, the plugin shows a clear message with a "Log in again" button instead of silently pausing.
- **Fewer false alarms.** Temporary Garmin or network hiccups no longer pause auto-sync — the plugin waits and retries on its own.

### Privacy note

To keep you signed in, the plugin stores Garmin sign-in tokens locally in Obsidian's plugin data. It does not store your Garmin password. Use **Logout** in the plugin settings to clear them on this device.

## 0.9.7

This update makes Garmin auto-sync more reliable when Garmin sessions expire or need to be refreshed.

### Improved

- Auto-sync now checks first whether there is actually anything to sync before touching the Garmin session. This avoids unnecessary login/session checks while everything is still in cooldown.
- If Garmin requires a fresh login, auto-sync now pauses with a clear persistent message and a direct "Log in again" button.
- Auto-sync no longer opens a surprise Garmin login window in the background while you are just opening a daily note.
- Saved Garmin browser sessions are restored more reliably, so you should need to log in less often.

### Fixed

- Fixed cases where expired Garmin cookies could make the plugin think the session was still fresh.
- Fixed a race condition during login that could incorrectly report a login timeout.
- Reduced false auto-sync pauses when only some Garmin endpoints temporarily reject a request.

### Privacy note

Garmin session cookies may be stored locally in Obsidian's plugin data so the plugin can restore your session. The plugin does not store your Garmin password. Use **Logout** in the plugin settings to clear the saved Garmin session on this device.
