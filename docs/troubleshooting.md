# Troubleshooting

## Signing in

- **Garmin blocks or limits the sign-in.** Garmin may limit repeated attempts from one device; the plugin then shows a countdown before you can try again. Use **Sign in via browser** instead: sign in on Garmin's page, copy the page text that contains `ST-…` and paste it into the plugin. See [Signing in in the README](../README.md#signing-in).
- **"Session expired" or the sign-in notice comes back.** The long-lived token was rejected. Sign in again from the notice or the settings. A single endpoint that answers 401 or 403 while the others work does *not* log you out: the day is stored without that value.
- **A phone that was suspended.** Auto-sync catches up when you come back to the app, and a request that never answered counts as failed after 25 seconds and is retried at the next sync.
- **Report a problem:** **Copy diagnostics** in the settings (see [settings.md](settings.md#connection)) contains no password, tokens or health values. After a sync it also holds the structure of each Garmin answer (field names and types), which is what is needed when a metric is missing or looks wrong for your watch.

## A metric is missing or starts late

- **The watch does not produce it** (a feature your model lacks, or a new watch): the metric is not written for those days, there is no error. HRV, for example, begins on the day your new watch recorded it. Cards then show "Unlocks after 5 days" or "Early estimate" instead of a number; see [the principles in panel-cards.md](panel-cards.md#principles).
- **A day has some metrics but not others.** If one request of a day fails (an error or a timeout), the day is stored as it is but not marked complete, so the next [backfill](history.md#backfill) fetches it again.
- **The metric is off.** Additional metrics are off by default; see [metrics.md](metrics.md).
- **A number you typed yourself** (`steps: "8000"`) is read as the number; text such as `62 ms` is not.

## The side panel

- **The panel is empty or a card shows "no reading".** The panel reads your daily notes (and the [history notes](history.md)); check that the **Daily notes path** and **Daily note format** match your notes (see [settings.md](settings.md#notes-and-properties)), that the metrics the card needs are on (every card's switch says which, and [panel-cards.md](panel-cards.md) lists them) and that the day has been synced.
- **The panel is empty on a second device (a desktop that got the notes by Obsidian Sync).** The panel never needs a Garmin sign-in: it only reads the notes. What a second device may lack is the plugin's own settings (Obsidian Sync does not sync community plugin settings unless you switch that on): **Side panel** is off by default, and the daily note folder is empty until you set it or it is read from the Daily Notes or Periodic Notes plugin. With no folder set, a note named by date anywhere in the vault counts as a daily note (from beta 92); set the folder and format under **Settings → Garmin Health Sync** when your notes are named differently.
- **A second device sets itself up from the notes (fresh install only).** When the plugin has no saved settings and a daily note has at least three Garmin properties (blank properties of a template do not count), the plugin switches on the metrics it finds, takes the `ohs_` prefix and miles or pounds from the notes, reads the lifestyle log when habits are there, and switches the side panel on; a notice says so. It never switches a metric off, never runs again once settings are saved, and the Habits card names the habits from their keys until a sign-in brings Garmin's own names.
- **The panel says "No daily notes found with the name format …".** None of your notes is named like the **Daily note format** (and sits in the **Daily note folder**, when one is set) under **Settings → Garmin Health Sync**. Notes in the vault root with another format (`DD.MM.YYYY`, `YYYYMMDD`) are followed from the Daily Notes or Periodic Notes plugin when the format setting is untouched; otherwise type the format there. The panel shows this one line instead of a card of "no reading" after another.
- **The panel says "Found N daily notes … but none holds Garmin properties".** The notes are found, but none has a property such as `steps` or `hrv` (with or without the `ohs_` prefix) that the panel can read: open a note in the Properties view, or sync. **Copy diagnostics** ends with a `notes:` line that shows what the panel sees (the settings that pick the notes, how many daily notes it found, which of our own properties the newest one holds; no note name and no value), which tells whether the notes, the folder and format or the properties are the problem.
- **A card says "Unlocks after N days".** It needs that many days of the metric before it compares you with your own usual range.
- **The readiness score is missing.** It needs HRV, resting heart rate and last night's sleep for the day and at least 5 days on which HRV and resting heart rate were both measured. Until then Garmin's own readiness is shown when your watch provides it. See [the Today card](panel-cards.md#today).
- **A light bulb has no "What your data suggests".** A statement appears only when your own data points to something; see [panel-insights.md](panel-insights.md).
- **The panel keeps showing a day.** Opening a daily note moves it to that day; any other note leaves it. At midnight it moves on when it shows today.

## Habits (lifestyle log)

- **The Habits card is empty.** The lifestyle log is off by default: switch on **Lifestyle log (habits)** under **Additional metrics** and sync. The card lists habits with an entry in the last 30 days; a habit Garmin no longer lists (deleted or replaced in the app) is hidden from the day after its last one.
- **A habit has no bars.** A yes or no habit needs 8 days with it and 8 days logged as "no"; a counted habit needs 14 logged days with at least 3 different amounts. A day without an entry is never counted as "no": log a "no" on the days you skip a habit. A grey bar means the difference is not clear yet.
- **A habit shows twice, or its history stopped.** The key of a habit is made from its name when the plugin first sees it and then kept by Garmin's id, so a rename in the app or another account language keeps it. A habit that was seen only before this was added gets a new key when its name changed; the old key stays in your notes.
- **A value you removed in Garmin Connect is still in the note.** A sync writes what is logged; it does not delete a property that an earlier sync wrote.
- **Days from before you switched it on.** Run a backfill: the days are fetched again for the new metric.

## Notes and files

- **"Frontmatter could not be read".** The note's properties block is damaged (a duplicate key, a line that is not valid YAML). The plugin leaves it alone, writes a backup to `_garmin-health-sync/backups` (the last five are kept) and tells you. Fix the block and sync again.
- **Another plugin creates the daily note** (Templater, Calendar, an external sync): set **Days without a daily note** to **Skip the day**; the auto-sync then waits for the note. See [Auto-sync in the README](../README.md#auto-sync).
- **Comments and formatting in your properties.** New values are appended after your last property and a changed value is replaced on its own line; the rest of the block stays as you wrote it. A list or multi-line value that has to change (the `trainings` list) rewrites the block.

## Backfill

- **A backfill stopped.** It resumes about ten seconds after the next start from where it stopped. Failures are retried after 30 and 60 seconds, repeated failures pause the run for 5 to 30 minutes, and after five pauses it stops; run **Backfill health data** again to continue. Details: [history.md](history.md#backfill).
- **I clicked the progress notice away.** Run **Show the progress of the running backfill** or click the status bar item.

See also: [settings](settings.md), [metrics](metrics.md), [panel cards](panel-cards.md), [the README](../README.md).
