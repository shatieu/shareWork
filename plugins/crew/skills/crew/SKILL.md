---
id: crew-orchestration
name: crew
description: The Ship's crew-orchestration procedure -- how the first-officer (or any main session) reads the scrutiny preset, assembles the navigator/shipwright/inspector/devils-advocate pipeline, runs the plan gate, satisfies the paranoid stop gate, and dispatches with report contracts. Load before assembling a crew for any multi-step coding task in a ship-crew project.
---

# Crew orchestration

You orchestrate; the crew builds. This procedure was field-tested across a multi-package
autonomous marathon -- each rule below paid for itself. The Captain is the human; their
spoken word outranks every settings file.

## 1. Know your preset

The SessionStart hook injected a `[Ship crew]` briefing with the resolved preset. If it's
missing, read `ship.scrutiny` from `.claude/settings.local.json`, then `.claude/settings.json`
(local wins; default `standard`; custom presets under `ship.crewPresets`).

| Preset | Pipeline & gates |
|---|---|
| `solo` | Work directly, no crew. Ledger/changelog capture stays automatic -- never disable it. |
| `standard` | navigator → shipwright → inspector. No plan gate -- trust the crew; the inspector is the check. |
| `rigorous` | navigator → devils-advocate (attacks the plan) → **plan gate** → shipwright → inspector. |
| `paranoid` | rigorous, plus you cannot finish without an inspector PASS marker (Stop-hook enforced). |

A verbal override ("go rigorous on this one") replaces the preset for this session only.

## 2. Assemble and dispatch

- **Dispatch format** -- five lines, zero ambiguity: role; the task; files/spec it touches;
  the acceptance you expect; the report contract line ("final message ≤30 lines, verdict
  first, evidence to <file>"). Fix recurring confusion by improving the role definitions,
  not by writing longer dispatches.
- **Missing agent type?** Plugin agents can lag the harness's available-types list
  (definitions hot-load only on refresh). Never block: dispatch a general-purpose agent
  whose first line is "Read the ship-crew plugin's `agents/<role>.md` and adopt it as your
  complete role definition", then the normal dispatch.
- **Parallelism:** only for non-overlapping files/questions. Never two implementers in the
  same files; never implement while something you depend on is still being reviewed.
- **Shared working tree:** subagents share your checkout. Foreign branches/commits are
  inspected via `git show`/`git log -p`/`git diff` only -- an agent that checks out another
  branch strands everyone. Commit small and often; commits are crash insurance.

## 3. The exchange -- temporary crew knowledge (token discipline)

Tokens are spent almost entirely on agents re-reading what another agent already
learned, and on transcripts growing round over round (measured 2026-07-09: ~1M
subagent tokens for two packages, most of it re-discovery and re-verification).
The exchange is the fix: **`.ship-crew/exchange/<package>/`** holds short-lived
handoff files -- current while the package is open, deleted when it closes.

- **navigator findings** go to `exchange/<package>/findings.md` with a file:line
  pointer for every fact; the dispatch points builders/inspectors AT that file
  instead of inlining or letting them re-map the codebase. Builders read the
  named line ranges, not whole files.
- **contracts** (API shapes two parallel builders must meet) live there too --
  one file both sides read beats two prompts drifting apart.
- **lifecycle:** the FO distills whatever deserves to outlive the package into
  the durable places (plan file, reports/, changelog fragment, a skill) and then
  deletes the package's exchange directory at close. Exchange files are working
  memory, not records -- an exchange file that survives its package is a bug.
  `.ship-crew/` is gitignored; deletion here is product behavior, not repo loss.

Dispatch-cost rules learned the same day:
- **Never resume a finished agent for a small recheck** -- a resume replays its
  entire transcript as input (measured: 89k tokens to re-verify a 15-line fix).
  Verify small fixes yourself, or send a fresh, tightly-scoped dispatch.
- **Inspection depth follows the preset.** `standard`: the inspector runs the
  acceptance line + the changed package's own suite, spot-checks the 2-3
  riskiest diffs, trusts builder-run gates for the rest; name at most 1-2 risks
  in the dispatch. Full gate re-runs and multi-risk adversarial attacks are
  `rigorous`/`paranoid` behavior -- do not dispatch them at `standard`.
- **Tier models by role:** mechanical reconnaissance (Explore-style scans,
  inventory sweeps) runs on a small/fast model via the dispatch's model
  override; builder and inspector roles keep the session model.

## 4. Run the pipeline

1. **navigator** -- send the exact questions the plan needs answered (codebase facts,
   library/API verification). Findings land in the package's exchange file
   (file:line per fact); unverified facts stay flagged, never assumed.
2. **Plan** -- write the plan down (a file beats a message). Scope, file-level changes,
   test plan, how acceptance will be demonstrated, risks.
3. **devils-advocate** (rigorous+) -- give it the plan. `FATAL` → replan before anything
   else; ranked objections → fold the cheap mitigations in, note the rest.
4. **Plan gate** (rigorous+) -- present the plan to the Captain and get explicit approval
   BEFORE any implementation code. Silence is not approval. Park what only the Captain can
   decide; build to the seam rather than guessing.
5. **shipwright** -- dispatch per plan section; non-overlapping files if parallel. Plan
   deviations must come back visible, never improvised silently.
6. **inspector** -- independent: never the agent that built it, and never you reviewing
   your own implementation. It runs the acceptance itself, at the depth §3 sets for the
   preset; binary PASS/FAIL. On FAIL: fix (shipwright), then re-inspect via a FRESH
   dispatch scoped to the finding -- never by resuming the finished inspector (§3). Under
   paranoid, pass the session id in the dispatch so its PASS marker
   (`.ship-crew/inspector-pass.json`) carries it.
7. **Integrate and report** -- outcome first, evidence-backed, risks and open questions
   named plainly. "Done" without something that ran is not done.

## 5. The paranoid stop gate

Under `paranoid`, a Stop hook blocks the session's finish until
`.ship-crew/inspector-pass.json` exists with this session's id and `"verdict": "PASS"`.
Only the inspector writes that file, only on a real PASS. Do not write it yourself, do not
coach the inspector into writing it early -- satisfy the gate by getting the work to
actually pass. (The gate allows the second stop attempt through as a loop-safety valve;
treat that as an audit-trail failure, not a loophole.) Recommend gitignoring `.ship-crew/`.

## 6. The quartermaster

For long-horizon questions -- cross-week progress, "what shipped?", drift between plan and
reality -- dispatch the quartermaster rather than reconstructing from your own context. It
reads the ledger and changelog over MCP (registration commands are in the plugin README;
if its tools are missing it will say so rather than guess).
