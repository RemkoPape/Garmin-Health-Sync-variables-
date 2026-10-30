# Notice

Garmin Health Sync is licensed under the 0-BSD licence (see `LICENSE`).

## Ideas from other plugins

The handling of properties in daily notes (the setting **Properties of daily notes**: folding the properties block when a note opens, hiding the properties the side panel shows) was inspired by two community plugins:

- **Fold Properties By Default** by Tommy Bergeron, MIT licence, copyright (c) 2025 Tommy Bergeron. It folds the properties block of every note when it opens.
- **Extended Properties** by electroluminescent, MIT licence, copyright (c) 2026 electroluminescent. It moves note properties into a configurable sidebar.

No source code of either plugin was copied. The behaviour is implemented separately in `src/note-properties.ts`: Obsidian's own **Toggle fold properties** command is run when a daily note opens (with retries, because Obsidian builds the properties block a moment later), and the rows the panel shows are marked and hidden by a class, which is re-applied when Obsidian rebuilds the rows. Because ideas and behaviour are not covered by copyright, the MIT notice requirement does not apply; the credit is given as thanks.

## Research

The interpretations under the light bulb of the side panel cite the studies they rest on in `docs/panel-insights.md`.
