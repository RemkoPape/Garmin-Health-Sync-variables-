# Garmin history notes

The side panel reads the daily notes. A day without a note (or a note without a value) can be filled from the **history notes**: one small markdown note per month, so the data survives on every device that syncs the vault.

## Where and what

- Folder `Garmin history` inside the daily notes folder (at the vault root when no daily notes folder is set). There is no path setting. The notes are found by name (`Garmin history YYYY-MM.md`) anywhere in the vault, so moving the folder breaks nothing.
- Why markdown and not one JSON file: every sync tool carries markdown (Obsidian Sync does not sync `.json` unless "Sync all other types" is on), and one note per month keeps two devices from rewriting one big file.
- One line per day inside a fenced block: `2026-10-27 {"hrv":42,"sleep_duration":"6h 24min","steps":9100,"trainings":[...],"_m":["hrv","steps"]}`.
  - The values are the keys the sync writes into a daily note, without the `ohs_` prefix and always in metric units.
  - `trainings` is always kept, whatever the daily note setting says.
  - `_m` lists the metrics that were requested when the day was fetched (so a later backfill can tell which days lack a metric). Days copied from notes have none.
- The keys are sorted, so the same data always gives the same text. Lines that cannot be read (conflict markers, a line damaged by hand) are ignored, a date that appears twice is merged, and a sync conflict copy of a month is merged on read.

## When it is written

The setting **Days without a daily note** decides:

| Choice | A day without a note | A day with a note |
|---|---|---|
| Create the note (default) | the note is created, no history notes | the note is updated |
| Keep in history files | stored in the history, no note is created | the note is updated **and** the day is stored in the history |
| Skip the day | not fetched (auto-sync waits for the note) | the note is updated |

An older "create daily note when missing" switch is turned into this choice once: on becomes "Create the note", off becomes "Skip the day". With "Skip the day" a manual backfill now also fetches only days that have a note.

The command **Import history from daily notes** copies the Garmin values of the existing daily notes into the history without any Garmin request.

## How the panel uses it

`DayIndex` takes a value from the daily note first and falls back to the history record for the same day (key by key). Weeks count as having data when they have a note or a record. The months of the last 400 days before the shown day are read when the panel is drawn and again when a history note changes.

### The long view

With at least 60 days of values in the last year, the box under the light bulb of the HRV, resting heart rate, SpO2, breathing, sleep, steps and VO2 max cards adds a line with the year (days with data, average, lowest, highest) and, when each of the last 90 days and the 90 days before have at least 20 values, the average of both. These are plain figures from the data, not interpretations, so they have no text in `docs/panel-insights.md`. The usual range of a card still comes from the last 30 days only, because a new watch measures HRV and resting heart rate differently from an old one and a year-long baseline would mix the two.

## Building the history back in time

The command **Build Garmin history** fetches the days from yesterday back to the date you choose (default five years) into the history notes.

- Newest day first, so stopping early still leaves the most useful days. Days already in the history are skipped, so a stopped or failed run continues where it left off; nothing else is stored to resume.
- Only the metrics you have enabled are fetched, one request group per metric group and day, spaced by the same delay as the backfill (about 3 s a day with the default metrics, about 10 s with all of them). The dialog shows the estimate before it starts.
- A day without any data is remembered as empty once it is older than three days, so it is not asked for again. The run ends at the start of your data: after data was found, 120 days in a row without any.
- A day that fails is retried after 30 s and 60 s. Three failed days in a row pause the run for 5 minutes, then 10, 20 and 30; after five pauses without a success it stops. A request for a new sign-in stops it at once. Whatever was fetched is saved in every case.
- A running build shows a notice at the top with the day, the days done, the time left and a **Stop** button, and on a desktop a percentage in the status bar. The auto-sync waits while it runs; fetches never overlap.
- A daily note that exists for a fetched day is updated too (never created).
