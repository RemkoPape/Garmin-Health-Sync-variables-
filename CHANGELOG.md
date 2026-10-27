# Changelog

## 0.12.0-beta.18

### Added

- **Stress and recovery minutes** are back as two optional metrics, **Stress duration (min)** (`stress_high`, time in medium and high stress) and **Recovery duration (min)** (`recovery_high`, time at rest), read from the daily summary (issue #31). They are extended metrics, off by default. With both on, the Stress card shows a split bar of stressed against recovering time with both amounts, and when more of the day was stressed the light bulb suggests slow breathing. The field names (`mediumStressDuration`, `highStressDuration`, `restStressDuration`, in seconds) follow Garmin's daily summary but could not be checked against a real response here: after a sync, check that the values look plausible, otherwise send the output of **Copy sync diagnostics**.

### Changed

- The light bulb button is smaller, also on a phone (the touch target stays 44 px).

## 0.12.0-beta.17

### Changed

- The button that opens the interpretation and the explanation on each card is now a light bulb instead of an (i).

## 0.12.0-beta.16

### Changed

- **Cards show numbers; advice lives under (i).** The fixed tips on the cards are gone: the sleep stages tip ("Tonight … no alcohol"), the load balance suggestions ("Hold steady", "Ease off"), the cardio fitness tips and the body "on track / check hydration" lines, plus "take the stairs" on floors and "keep the remaining days easy" on weekly load. What they said is covered by the data-based interpretation under (i), which also gets one new text for the maintain zone of the load balance. The trend lines stay on the cards.
- Targets and quantities share one row style: a muted label and a neutral value on the right (sleep now reads "Tonight — Aim for 7 h" in the same style as the steps, floors and intensity rows). Green is reserved for something reached (zone done, goal reached) and amber for a warning, so "61 min left" no longer looks like good news.
- The resting heart rate explanation no longer lists alcohol among the possible causes.

## 0.12.0-beta.15

### Fixed

- The health panel now shows data that arrived while it was hidden as soon as it is visible again. Before, a sync that wrote today's note while the panel was hidden (for example a closed drawer on a phone) was only shown after switching to another sidebar tab and back; now opening the sidebar, resizing it or any layout change renders it.

## 0.12.0-beta.14

### Added

- **What your data suggests**, under the (i) of every card that can say something (HRV, resting heart rate, SpO₂, breathing, sleep, sleep stages, body battery, stress, steps, intensity minutes, cardio fitness, body, load balance, weekly load and sessions). It opens first, in a framed box with an accent headline, above the general explanation (which stays plain text). It says why the value is where it is and, if it is off, what the data points to as the lever, or, if it is good and the data allows a guess, what probably made it good. Examples: a short night with a bedtime 1 h 17 min later than usual ("your usual bedtime would have given you about 1 h 17 min more"), little REM after an earlier alarm than usual (REM concentrates in the last hours of the night), little deep sleep after a day with fewer steps than usual, a low HRV after a spike in training load, sleep debt, stress or together with a raised resting heart rate, a falling cardio fitness after fewer training minutes.
- Each line has a coloured edge (orange: something to look at, green: going well), at most 3 lines per card, and the box ends with a note that this is not a diagnosis. When no rule finds a cause the text says nothing else in your data explains it instead of inventing one.
- No generic advice: nothing like "no alcohol before bed" or "drink more water". A tip only appears when your own numbers point to it.
- Every interpretation is documented in `docs/panel-insights.md`: when exactly it fires, what it rests on and a link to the study it is based on (or why there is none). A test fails when a text is added without its documentation or translation.

## 0.12.0-beta.13

### Changed

- Every card switch under **Settings → Garmin Health Sync → Side panel** now says what the card needs and when it unlocks (for example "Needs HRV. Your usual range appears from 5 days of data and is reliable from 21."), lists by name the required metrics that are still off ("Turn on in the metric settings: …") and, separately, the metrics that only add detail ("Adds more detail when turned on: Bedtime, Wake-up time"). The list follows your language and unit system and updates when you toggle a metric.

## 0.12.0-beta.12

### Changed

- The **Birth year** (in **Settings → Garmin Health Sync → Side panel**) now makes more of the panel age-aware, and shows the estimated maximum heart rate right in the setting.
  - **Load balance and Weekly load** take how hard a session was from its heart rate zone, so intensity weights and segment colours work from the very first session instead of after 10 sessions with a heart rate.
  - **Intensity minutes**: for someone under 18 the weekly goal starts at 420 minutes (60 a day, the recommendation for children and teenagers) instead of 150; the goal still moves up when you regularly do more.
  - **Sleep**: the need is 8 hours for ages 14 to 17 and 9 hours for ages 10 to 13 (7 hours for adults, and without a birth year), and the debt, the tip for tonight, the 7 hour line and the dashed box in the timeline follow it.
- Other cards (HRV, resting heart rate, SpO₂, breathing, body battery, stress, steps) keep using your own history only, because personal baselines are better than age averages.

## 0.12.0-beta.11

### Added

- **Heart rate zones in Sessions.** A new setting **Birth year** under **Settings → Garmin Health Sync → Side panel** (only the year, optional; anything that is not a believable year is ignored). With it the plugin estimates your maximum heart rate (Tanaka: 208 − 0.7 × age) and every session shows its zone: the border colour, a "Zone 1 to 5" label (or "Below zone 1") and a five-part zone bar with the current zone highlighted. Zones are 50, 60, 70, 80 and 90 percent of the estimated maximum, and they come from the session's *average* heart rate, so a session with intervals can sit in a lower zone than its hardest minutes. Without a birth year the border keeps showing how hard the session was compared with your last 90 sessions, and the card suggests adding the year.

## 0.12.0-beta.10

### Added

- **Fitness and body** section with two cards.
  - **Cardio fitness (VO₂ max)**: the latest value of each of the last 12 weeks as bars, the change over those 12 weeks (from the slope; under 0.3 counts as steady) and a short suggestion. It needs 3 weeks with a value and a value from the last 28 days.
  - **Body**: your weight as the mean of the last 7 days, the last 28 days of readings as dots, the change per week and your body fat. Colours stay neutral because without a goal no direction is good or bad; a change faster than 1 percent of your weight a week is flagged. It needs 3 weight readings in the last 14 days and reads pounds from notes written with imperial units.

### Changed

- **Intensity minutes**: the weekly goal is still 150 minutes at least, but if you regularly do more it moves to a little above your own average of the previous weeks (10 percent above, in steps of 5 minutes, with no upper limit; for example about 380 for someone who averages 345). The card says when the goal was personalised.

## 0.12.0-beta.9

### Added

- **Sleep timeline.** Two new optional metrics, **Bedtime** (`sleep_start`) and **Wake-up time** (`sleep_end`), written as `HH:MM` (extended metrics, off by default; turn them on and backfill to fill earlier nights). With them on, the Sleep card draws one column per night on a clock: a faint bar from bedtime to getting up, a solid bar for the time asleep and a dashed box that is 7 hours long from bedtime, so a solid bar that stops above the box is a night with too little sleep. Underneath it shows your average bedtime and wake-up time and how much they vary (±minutes). Without the times the card keeps its bars of sleep duration against the 7 hour line.
- **Weekly distance** for running and cycling in the Weekly load card: this week's kilometres (miles with imperial units) against the average of your previous weeks and a cap 10 percent above it, with what is left to the cap.

### Changed

- **Body battery** now shows two clearly labelled bars on the same 0 to 100 scale: where your daily peaks of the last 30 days fell (with a tick at the average) and today's lowest to highest value.

## 0.12.0-beta.8

### Added

- **Training** section in the health panel, built from the activities in your daily notes (either the per-type lines like `running: 5 km · 46min · Ø142 bpm` or the machine-readable `trainings` list, per note, also mixed). Breathwork and meditation count as recovery and are left out of the load.
  - **Load balance**: your last 7 days against your weekly average of the last 28 days, each session weighted by how hard it was for you, on a five-zone bar (detrain, maintain, build, strain, overreach) with a suggestion. Garmin's own training status is shown as a small label only.
  - **Weekly load**: this week's minutes as a bar of sessions coloured by intensity, with your average of the previous weeks and a cap 10 percent above it, and how many minutes are left to the cap.
  - **Sessions**: the day's sessions with minutes, distance, heart rate, calories and the workout location; the border colour shows how hard a session was compared with your last 90 sessions (needs 10 sessions with a heart rate), recovery sessions are dashed.
- Load balance and weekly load need at least one previous week with notes and say "Based on N of 4 weeks" until four weeks are available.

### Fixed

- Intensity colours, zone labels and ticks no longer overlap.

## 0.12.0-beta.7

### Added

- A small **trend line** at the bottom of most cards: 14 tiny bars for the last two weeks and a sentence such as "↑ +3 ms vs the week before". It compares the last 7 days with the 7 days before and needs at least 4 days with a value in each week; a change under 2 percent counts as steady. It is deliberately neutral in colour, because up is not always good. Sleep stages and intensity minutes have none (a composition and a weekly plan).
- A switch per card under **Settings → Garmin Health Sync → Side panel**. Cards are on by default; a card whose metric is not synced says so in the settings. Switching a card off also removes its section header when it was the last one in the section.

### Fixed

- "No reading" no longer overflows the half-width SpO₂ and breathing cards.

## 0.12.0-beta.6

### Added

- **SpO₂** and **Breathing** cards side by side under Recovery, each with a compact colour scale and a status word (in range, low, high). SpO₂ is flagged below your usual range and always below 90 percent (amber under 94); breathing is flagged both ways, and 1.5 breaths a minute above your usual always counts.
- **Sleep stages** card: the night's mix of deep, REM, light and awake time as a bar, one row per stage with your usual amount as a tick and the deviation in minutes, and a tip for tonight when deep or REM is clearly low or awake time clearly high. It needs the four sleep stage metrics enabled in the sync settings.
- **Energy and stress** section: **Body battery** (the day's lowest to highest value on a 0 to 100 track, your usual peak, and the overnight recharge against your usual) and **Stress** (Garmin's four bands with your level and a marker for your 7-day average). The stress minutes split bar follows once the sync writes those values.

### Changed

- Values keep their sensible number of decimals (whole numbers for HRV, heart rate and SpO₂; one decimal for breathing). Small labels like "usual" and "low" are shown in lowercase.

## 0.12.0-beta.5

### Added

- **Movement** section in the health panel with three cards. **Steps**: your zone is your average of the last 7 days up to 10 percent above it, with a bar, the steps and walking minutes still missing, and distance, active and total calories (active calories with the difference to your usual). **Intensity minutes**: a bar per day Monday to Sunday against the weekly goal of 150 minutes, with the daily amount needed over the days still to come. **Floors**: blocks for the day with your zone outlined, and how many floors are left to reach it. Steps and floors need 5 of the last 7 days with data.

### Fixed

- The (i) button no longer overlaps the text and charts below it on a phone, and there is more room between the range labels and the note under a bar.

## 0.12.0-beta.4

### Changed

- Panel visuals follow the original concept more closely. HRV and resting heart rate show a colour scale (green in your usual range, orange then red further out; for resting heart rate only upwards) with a dot at the value and the edges of your usual range marked with their numbers. The value is bigger with a small muted unit.
- The Sleep card now has a bar per night for the last 7 nights against a dashed 7 hour line, with weekday initials; the sleep score sits next to the value.
- Cards are grouped under **Recovery** and **Sleep** headers.

## 0.12.0-beta.3

### Added

- **Sleep** card in the health panel: last night's sleep, your sleep debt over the last 7 nights against 7 hours, and a tip for tonight (7 hours plus a quarter of the debt, at most one extra hour, in 15 minute steps). It needs 5 nights with data; with fewer than 7 it says how many nights the debt is based on. The sleep score is shown when it is in the note.

### Changed

- Cards are more compact (the value sits in the title row) and the colour bar and dot are thicker.

## 0.12.0-beta.2

### Added

- **Resting heart rate** card in the health panel. It compares the day with your average of the 30 days before it, like the HRV card, and only a value above your usual is flagged (amber from one standard deviation or 3 bpm above, red from two or 5 bpm); a lower resting heart rate is never a warning.

### Changed

- The HRV card shows your usual range from 5 days of data instead of 21, with a warning that the range is an early estimate and likely inaccurate until 21 days are available. Below 5 days the card still says how many days are missing.

## 0.12.0-beta.1

### Added

- First preview of the **health panel**, a read-only panel in the right sidebar. It is off by default: turn it on under **Settings → Garmin Health Sync → Side panel**, then open it with the command **Open health panel** or the ribbon icon. It follows the daily note you have open (otherwise today) and has ‹ › buttons to step through days. It only reads your daily notes and never changes them; nothing is fetched from Garmin.
- The first card is **HRV**: the day's value against your own average of the 30 days before it, with an (i) explanation. The personal range unlocks once 21 of those days have a reading. More cards follow in later betas.
- All panel texts are in the six supported languages.

### Internal

- Day index built lazily from Obsidian's metadata cache, with a 300 ms debounce after note changes; the panel does no work while hidden.
- `localDateString` moved to `src/dates.ts`; the date-from-note logic moved from `main.ts` to `daily-note.ts`.

## 0.11.2

### Added

- A "what's new" window after an update, in all six languages. It shows once per device, not on a new install, and can be closed any normal way. The command **Show what's new** opens it again. There is no setting for it. This first one also recalls that 0.11.0 brought mobile compatibility, says that 0.11.1 and 0.11.2 focus on stability and groundwork for future features, and mentions the planned side panel with data visualisation (a one-off for this release).

### Fixed

- Activities with empty-string start coordinates are no longer read as the point (0, 0), so no pointless place lookup is sent (#25).
- Body Battery minimum and maximum no longer break on an absurdly large response (#29).
- The 30 second timeout of a data request is cleared as soon as the request has finished instead of lingering (#26; the timeout still does not feed the sign-in backoff).
- An internal sign-in error message is in English like the rest of the log (#28).

### Changed

- The README links the releases page of this repository (it pointed at the original repository) and credits the original author, fcandi, in all languages.

### Internal

- New CI check `check:i18n-sync`: a pull request that adds, rewords or removes an English text must do the same in the five other language files (an English-only typo fix declares itself with an `I18n-Unchanged: <key>` line in a commit message).
- ESLint 10 (the 9 line is end-of-life; rule counts unchanged at 174 configured, 141 enabled, 38 `obsidianmd/*`, 43 `@typescript-eslint/*`). `@eslint/js` stays on 9 because eslint-plugin-obsidianmd peers it.
- Dev tooling updated (obsidian 1.14.4 with its exact `@codemirror` peers, TypeScript 5.9, typescript-eslint 8.71, happy-dom 20.14.6 security fix, knip, jiti, tslib, globals 17) and GitHub Actions moved to checkout 7, setup-node 7, upload-artifact 7.0.2.

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
