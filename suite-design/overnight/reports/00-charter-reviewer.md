# Reviewer report — 00-charter (dry-run, retrospective)

**Subject:** commit `45f6f32` on `ship-wave1` — "fix(chartroom-ui): preserve original bytes for
reordered blocks in round-trip engine"
**Mode:** retrospective review of a past commit. No plan file exists; judged against the commit
message's own claims and the tracked follow-up entry it closes in
`suite-design/overnight/DECISIONS-NEEDED.md`. Read-only on the current tree (branch `ship-wave1`,
dirty working tree with later, unrelated work).

## Verdict

**PASS.**

## What the commit claims

1. Bug: `lcsMatch` is order-preserving by construction, so a genuine two-block swap could match at
   most one of the swapped blocks; the other fell through to "new content" and got Milkdown's
   re-serialized text instead of its own original bytes — a spurious diff whenever canonical form
   diverged from authored form.
2. Fix: `matchReorderedBlocks` as a second pass in `reconstructFile` — pair still-unmatched current
   blocks with still-unmatched originals sharing the same canonical key; splice original bytes back
   at the new position. Duplicate ties broken by strict positional order.
3. Tests: 9 new (swap, reorder+insert, duplicate no-op, duplicate+reorder, 5 pure-function unit
   tests); `roundTrip.test.ts` 43 -> 52; chartroom-ui suite 144/144 at commit time; acceptance
   script's stale `43/43` console string updated to `52/52`.
4. Bookkeeping: DECISIONS-NEEDED.md follow-up entry updated to record the fix.

## What I executed

- `git show 45f6f32 --stat` and full diff — 4 files: `packages/chartroom-ui/src/editor/roundTrip.ts`
  (+74), `packages/chartroom-ui/test/editor/roundTrip.test.ts` (+182),
  `packages/chartroom/acceptance/editor-round-trip.mjs` (1-line console string),
  `suite-design/overnight/DECISIONS-NEEDED.md` (+1 "Fixed:" line). Scope is tight; no creep.
- Read the full current `packages/chartroom-ui/src/editor/roundTrip.ts` to review the fix in
  context (lines 265-292 `matchReorderedBlocks`, lines 302-388 `reconstructFile`).
- `pnpm test` in `packages/chartroom-ui` — **17 files, 149/149 tests passed** (exit 0, 8.69s).
  `test/editor/roundTrip.test.ts` reports exactly **52 tests, all passing**. 149 vs the commit's
  claimed 144 is fully explained by the current tree: untracked `test/editor/_spike.test.ts`
  contributes 5 tests added after this commit (149 - 5 = 144). Not a discrepancy.
- `node acceptance/editor-round-trip.mjs` in `packages/chartroom` — ALL ASSERTIONS PASSED, and it
  prints the updated `52/52` reference, confirming the string fix is live and accurate.
- Verified the "9 new tests" claim: `git show 45f6f32 -- ...roundTrip.test.ts | grep "^+.*it("`
  yields 9 genuine `it()` blocks (a 10th grep hit was a `.split(` false positive) — 4 integration
  (swap, reorder+insert, duplicate no-op, duplicate+reorder) + 5 unit tests against
  `matchReorderedBlocks`. Matches the message exactly.

## Correctness analysis (adversarial reading)

- **Injective matching, no byte loss/duplication:** LCS pairs are distinct on both sides;
  `matchReorderedBlocks` builds `unmatchedOrigByKey` only from LCS-unmatched originals and consumes
  each candidate exactly once via `shift()`. So `matchedForCurrent` maps each current index to at
  most one original, and no original index is used twice. No block's bytes can be spliced twice or
  silently dropped by the new pass.
- **Never overrides LCS:** reorder pairs only cover current indices LCS left unmatched
  (`matchedCur.has(ci)` guard), so an edited-in-place block (key mismatch) still correctly gets
  fresh serialized text, and an LCS-matched block is untouched. The "layered on top, never
  overriding" claim in the code comment holds.
- **Gap handling:** reorder pairs are deliberately NOT added to the `anchors` list feeding the
  same-length-region gap heuristic (which requires strictly-increasing pairs — an LCS invariant),
  but they ARE seeded into `impliedOrigIdxForCurrent` via the `matchedForCurrent` copy at line 337.
  Hand-traced `H A B -> H B A`: both gaps adjacent to the swapped pair fall back to `DEFAULT_GAP`,
  exactly as documented. Hand-traced an adjacent-pair move `A B C D -> C D A B`: the gap *inside*
  each still-adjacent moved pair is preserved from the original (implied indices consecutive),
  which is strictly better than the fallback and correct. `impliedOrigIdxForCurrent` influences
  only whitespace-gap choice, never block content, so even a pathological implied-index collision
  could at worst pick a plausible-but-different whitespace gap — not corruption.
- **Duplicate tie-break safety claim holds:** a pairing requires exact key equality, so two
  candidates for the same slot are canonically interchangeable; positional order is deterministic.
  Edge case where two blocks with *different original bytes* share a canonical key (e.g. `+ one`
  vs `* one` lists): a swap could splice each other's bytes — rendered output identical, byte-level
  ambiguity inherent to key-based matching and explicitly acknowledged in the doc comment. Not a
  regression; acceptable per the commit's own framing.
- **Opaque blocks:** keys are exact raw text on both sides, so a reordered opaque block pairs
  correctly and gets its identical raw bytes — safe by construction.
- **Commit message accuracy:** every checkable claim verified true (test counts, file scope,
  acceptance-script string, DECISIONS-NEEDED entry present at lines ~87 of the file). The claimed
  chartroom 177/177 was not re-run (out of dispatch scope; that package's tree has unrelated later
  modifications), but the commit did not touch chartroom source — only a console string in one
  acceptance script, which I executed successfully.

## Minor non-blocking observations

1. No test reorders an **opaque** block (HTML/directive). Safe by construction (raw-text keys), but
   a one-fixture test would pin it.
2. The documented `DEFAULT_GAP` fallback around reordered blocks is asserted only implicitly; a
   fixture with unusual original spacing (e.g. 3 blank lines) around a swapped block would pin the
   documented degrade-to-one-blank-line behavior explicitly.
3. Comment-to-code ratio in the fix is very high (~40 lines of comment for ~28 lines of code);
   accurate, but dense.

None of these block a PASS for a hardening fix of this scope.
