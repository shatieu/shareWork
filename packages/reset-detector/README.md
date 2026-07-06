---
id: reset-detector
---

# reset-detector

The standalone usage-window reset detector (Trio_Specs §C) — the shared, pure core under
both the Lookout sensor and the guard harness in `packages/scheduler`. Every rule in here
was proven live on the 2026-07-05/06 overnight mission by the prototype in
`suite-design/lookout/` before being productized.

Zero runtime dependencies. All policy is pure and injectable (clock, fetch, token reader),
so every behavior is deterministically testable.

## What it provides

- **`createOauthUsageSource`** — cached reader over the undocumented
  `api.anthropic.com/api/oauth/usage` endpoint (`five_hour`/`seven_day` utilization +
  `resets_at`). Cache ≥ 5 min (the endpoint is aggressively rate-limited); on failure it
  serves the last good snapshot marked `stale: true` and never retries inside the
  interval — the prototype's "never hammer on failure" rule.
- **`parseLimitMessage` / `snapshotFromLimitMessage` / `parseStatuslineJson`** — tolerant
  best-effort extractors for the two secondary signals (CLI/transcript "resets at …"
  messages, statusline stdin JSON quota fields).
- **`fuseSignals`** — combines any of the three: freshest wins, near-ties break by source
  authority (oauth > statusline > limit-message), stale loses to fresh, and a
  `disagreement` flag fires when fresh signals point at different windows.
- **`windowKeyOf` / `sameWindow`** — jitter-proof usage-window identity: `resets_at`
  + 30 s, truncated to the UTC minute. The oauth endpoint jitters `resets_at` by
  sub-seconds between polls; exact-string dedup caused 5 resurrections in one window on
  2026-07-06 before this rounding fixed it.
- **`evaluateSignals`** — ALERT/PAUSE threshold evaluation as *levels* (signal files
  self-clear when the pct drops back under), with the pause-vs-spend mode switch
  (spend = keep working into paid extra usage; PAUSE suppressed, ALERT kept).
- **`decideGuardAction`** — the pure resurrection decision: sensor freshness (stale
  `usage.json` → relaunch sensor), token gate (`five_hour_pct < 20`), idle gate (30 min,
  paired with the session's ≤ 25-min alive-touch heartbeat so a living session can never
  look dead), once-per-window marker dedup on the rounded key, and a session-pinned
  resurrect command: always `--resume <sessionId>`, **never** `--continue`/`-c`
  (bare continue once appended mission turns into a foreign transcript), with
  `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` in the spawn env (print mode otherwise kills
  still-running background workers ~600 s after the final text).

## Non-goals

Process control. This library decides; it never spawns, kills, or resumes anything —
that is `packages/scheduler`'s job (and even there, the sensor half is signal-only).
