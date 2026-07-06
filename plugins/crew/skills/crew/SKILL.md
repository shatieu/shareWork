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

## 3. Run the pipeline

1. **navigator** -- send the exact questions the plan needs answered (codebase facts,
   library/API verification). Unverified facts stay flagged, never assumed.
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
   your own implementation. It runs acceptance + gates itself; binary PASS/FAIL. On FAIL:
   fix (shipwright), then re-inspect. Under paranoid, pass the session id in the dispatch
   so its PASS marker (`.ship-crew/inspector-pass.json`) carries it.
7. **Integrate and report** -- outcome first, evidence-backed, risks and open questions
   named plainly. "Done" without something that ran is not done.

## 4. The paranoid stop gate

Under `paranoid`, a Stop hook blocks the session's finish until
`.ship-crew/inspector-pass.json` exists with this session's id and `"verdict": "PASS"`.
Only the inspector writes that file, only on a real PASS. Do not write it yourself, do not
coach the inspector into writing it early -- satisfy the gate by getting the work to
actually pass. (The gate allows the second stop attempt through as a loop-safety valve;
treat that as an audit-trail failure, not a loophole.) Recommend gitignoring `.ship-crew/`.

## 5. The quartermaster

For long-horizon questions -- cross-week progress, "what shipped?", drift between plan and
reality -- dispatch the quartermaster rather than reconstructing from your own context. It
reads the ledger and changelog over MCP (registration commands are in the plugin README;
if its tools are missing it will say so rather than guess).
