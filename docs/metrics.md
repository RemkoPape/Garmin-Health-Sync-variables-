# Metrics: what is written to your daily notes

Every metric is a frontmatter property of the daily note (and, with **Days without a daily note** set to **Keep in history files**, a field of the day in the [history notes](history.md)). Switch them on under **Settings → Garmin Health Sync**: the six standard metrics are on by default, the rest sit under **Additional metrics**. Only the metrics you switch on are requested from Garmin, one request group per row of the table's *Group* column, so switching off a whole group makes a sync faster (see [Backfill in history.md](history.md#backfill) for the pace).

With **Property prefix** on, every key is written with the prefix `ohs_` (`ohs_steps`). With **Unit system** set to imperial, `distance_km` is written as `distance_mi` and `weight_kg` as `weight_lbs` (the [history notes](history.md) always keep kilometres and kilograms). Workouts are written as their own keys, see [Activities in the README](../README.md#activities).

A metric a watch does not produce is simply not written for that day: an empty answer is a day without that value, never an error. If you changed watches, the metric starts on the day the new watch has it; see [Troubleshooting](troubleshooting.md#a-metric-is-missing-or-starts-late).

| Key | Shows | Format | Default | Group | Used by cards |
|---|---|---|---|---|---|
| `steps` | Steps of the day | number | on | daily summary | [steps](panel-cards.md#steps) |
| `sleep_duration` | Time asleep | text, `7h 43min` | on | sleep | [sleep](panel-cards.md#sleep), [today](panel-cards.md#today) |
| `sleep_score` | Garmin's sleep score | 0 to 100 | on | sleep | [sleep](panel-cards.md#sleep) |
| `resting_hr` | Resting heart rate | bpm | on | daily summary | [resting_hr](panel-cards.md#resting_hr), [today](panel-cards.md#today) |
| `hrv` | Heart rate variability of last night | ms | on | HRV | [hrv](panel-cards.md#hrv), [today](panel-cards.md#today) |
| `stress` | Average stress level | 0 to 100 | on | daily summary | [stress](panel-cards.md#stress), [today](panel-cards.md#today) |
| `body_battery` | Body battery *charged* over the day (mostly the overnight recharge), not the current level | number | off | body battery | [battery](panel-cards.md#battery) |
| `body_battery_min` | Lowest body battery of the day | 0 to 100 | off | body battery | [battery](panel-cards.md#battery) |
| `body_battery_max` | Highest body battery of the day (the peak) | 0 to 100 | off | body battery | [battery](panel-cards.md#battery), [today](panel-cards.md#today) |
| `spo2` | Blood oxygen, average of the night | % | off | SpO2 | [spo2](panel-cards.md#spo2), [today](panel-cards.md#today) |
| `respiration_rate` | Breathing rate | per minute | off | respiration | [respiration_rate](panel-cards.md#respiration_rate), [today](panel-cards.md#today) |
| `hydration_ml` | Water you logged | ml | off | hydration | [hydration](panel-cards.md#hydration), [hrv](panel-cards.md#hrv), [resting_hr](panel-cards.md#resting_hr) |
| `hydration_goal_ml` | Your water goal for the day | ml | off | hydration | [hydration](panel-cards.md#hydration) |
| `calories_total` | Total calories | kcal | off | daily summary | [steps](panel-cards.md#steps) |
| `calories_active` | Active calories | kcal | off | daily summary | [steps](panel-cards.md#steps) |
| `distance_km` | Distance of the day | km (mi in imperial) | off | daily summary | [steps](panel-cards.md#steps) |
| `floors` | Floors climbed | number | off | daily summary | [floors](panel-cards.md#floors) |
| `intensity_min` | Intensity minutes (vigorous counts twice) | minutes | off | daily summary | [intensity](panel-cards.md#intensity) |
| `sleep_deep` | Deep sleep | text, `1h 30min` | off | sleep | [stages](panel-cards.md#stages) |
| `sleep_light` | Light sleep | text | off | sleep | [stages](panel-cards.md#stages) |
| `sleep_rem` | REM sleep | text | off | sleep | [stages](panel-cards.md#stages) |
| `sleep_awake` | Awake time during the night | text | off | sleep | [stages](panel-cards.md#stages) |
| `sleep_start` | Bedtime (local clock) | text, `23:15` | off | sleep | [sleep](panel-cards.md#sleep) |
| `sleep_end` | Wake-up time (local clock) | text, `06:40` | off | sleep | [sleep](panel-cards.md#sleep) |
| `vo2_max` | Garmin's cardio fitness estimate | ml/kg/min | off | training status | [vo2](panel-cards.md#vo2) |
| `training_readiness` | Garmin's own readiness | 0 to 100 | off | training readiness | [today](panel-cards.md#today) |
| `training_status` | Garmin's training status | text, `PRODUCTIVE_2` | off | training status | [load](panel-cards.md#load) |
| `weight_kg` | Weight (kg in the note and the history; lbs in imperial notes) | kg | off | weight | [body](panel-cards.md#body) |
| `body_fat_pct` | Body fat | % | off | weight | [body](panel-cards.md#body) |
| `lifestyle_log` | The switch of the lifestyle log: the habits you log in Garmin Connect (see below) | none itself | off | lifestyle log | none yet |
| `stress_high` | Minutes of medium and high stress | minutes | off | daily summary | [stress](panel-cards.md#stress) |
| `recovery_high` | Minutes of rest (stress 0 to 25) | minutes | off | daily summary | [stress](panel-cards.md#stress) |

The Load, Weekly load and Sessions cards use the workouts, which are always synced and need no switch. The machine-readable `trainings` list is a separate setting (**Machine-readable trainings**, see [settings.md](settings.md#notes-and-properties)).

See also: [what each card does with them](panel-cards.md), [the settings](settings.md), [the history notes](history.md), [the README](../README.md).

## Lifestyle log (habits)

With **Lifestyle log (habits)** on, the habits you log in Garmin Connect are read (one more request per day). After the first sync they are listed under **Additional metrics**, each with its own switch, off until you choose it. Only a habit you switch on is written to the daily note, as `lifestyle_<name>` (`lifestyle_late_caffeine`), and kept in the [history notes](history.md). A yes or no habit is `1` or `0`; a counted habit (cups, drinks) is the amount. A habit you did not touch that day is not written at all, so an empty day is never read as "no". The names of the habits are kept in the plugin settings. A habit you rename in Garmin Connect gets a new key.

The structure of Garmin's answer is not documented; **Copy diagnostics** shows it (field names and types, never values), so a report tells what Garmin really sends.
