# Lookout - plan note

Sensor-only script, no process control. Mirrors the already-proven poller
logic in `suite-design/overnight-watchdog.ps1` (credential read + oauth/usage
GET) but standalone, with both ALERT and PAUSE thresholds and self-clearing
signals.

- `lookout.ps1` runs one infinite loop: read token -> GET usage -> write
  `state/usage.json` -> log one line -> create/remove `state/ALERT` and
  `state/PAUSE` based on `five_hour_pct` vs thresholds -> sleep `PollSeconds`.
- On request failure: keep last `usage.json`, log `error <reason>`, do not
  touch signal files, sleep the full interval (no retry hammering - endpoint
  is undocumented/rate-limited).
- Signals contain the usage JSON at the moment they were raised, so a reader
  can see the pct/resets_at that triggered them without re-reading usage.json.
- `state/` is runtime-only -> gitignored.

Self-review before commit:
- ASCII only (no smart quotes/em-dashes) - checked by re-reading the file.
- PS 5.1 compatible: no `??`, no ternary, no classes; uses `ConvertTo-Json`/
  `ConvertFrom-Json`/`Invoke-RestMethod` which are all 5.1-native.
- Threshold checks use `-ge` against `AlertAt`/`PauseAt` (percent, same scale
  the API returns, matching the existing watchdog's `$pct -ge $pauseAtPercent`).
- Removal path: signal removed as soon as pct drops back under its threshold,
  independent of the other signal (ALERT and PAUSE clear independently).
- No other files touched besides this directory and the root `.gitignore`.
