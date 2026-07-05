---
id: report-01-housekeeping-dogfood-developer
---

# Developer report — package 01-housekeeping-dogfood

## REMEDIATION (review FAIL → fixed)

**Date:** 2026-07-05. **Branch:** `ship-wave1-dogfood`. **Dispatch:** remediation of
reviewer FAIL (see `01-housekeeping-reviewer.md` §5, option 1 chosen by the dispatch).

### What was done

1. **`suite-design/overnight/render-progress.mjs` made frontmatter-preserving.**
   Before writing, it now reads the existing `PROGRESS.md` (if any) and captures a
   leading YAML frontmatter block via
   `/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n?/`, then emits it verbatim before the
   generated body (with a separator newline only if the captured block lacks the
   trailing blank line). If the file is absent or has no frontmatter, nothing is
   emitted — no frontmatter is invented. Change is ~12 lines: `existsSync` import,
   `readExistingFrontmatter()`, and the final `writeFileSync` now writing
   `frontmatter + separator + body`.

2. **Restored the stripped id on `suite-design/overnight/PROGRESS.md`.**
   Re-added the exact 4-line block that `f5d331f` originally injected (verified via
   `git show f5d331f -- suite-design/overnight/PROGRESS.md`):
   `---` / `id: mission-progress` / `---` / blank line.

3. **Regeneration survival confirmed.** Ran `node suite-design/overnight/render-progress.mjs`
   twice:
   - First run: frontmatter preserved at top of output; body legitimately picked up
     the FO's updated #1 note from the already-committed `progress.json`
     ("review FAIL … Remediation queued …" replacing "implemented, 8 commits …").
   - Second run: `git diff --exit-code suite-design/overnight/PROGRESS.md` → no diff.
     Renderer is idempotent and frontmatter-stable.

### Gate evidence (branch head, repo root)

| Gate | Result |
|---|---|
| `node packages/chartroom/dist/cli.js check` | exit 0 — "clean -- no broken links, missing ids, or duplicate ids found." |
| `node packages/chartroom/acceptance/dogfood-sharework.mjs` | exit 0 — steps 1–3 OK, "ALL ASSERTIONS PASSED" (step 1: check clean + 8 changelog entries id-keyed; step 2: git mv self-heal; step 3: changelog renders via daemon routes) |
| Renderer idempotency | re-run produces zero diff |

### Commits

- `d246a8c` `fix(marathon): preserve frontmatter in progress renderer, restore PROGRESS.md id`
  (2 files: `render-progress.mjs`, `PROGRESS.md`; +19/−3)

### Deviations / notes

- The PROGRESS.md diff includes one regenerated body line (the #1 package note) because
  HEAD's PROGRESS.md was stale relative to the committed `progress.json`; this is the
  renderer doing its job, not hand-editing.
- Pre-existing working-tree dirt (`watchdog.log`, untracked `usage.json`, reviewer
  report, team-tasks/* etc.) left untouched and unstaged.
- No files deleted, no merges, no pushes, no new dependencies.
- This report file did not exist before (prior package report was the team-lead's);
  created it with this REMEDIATION section and a chart-room id so `chartroom check`
  stays clean once indexed.
