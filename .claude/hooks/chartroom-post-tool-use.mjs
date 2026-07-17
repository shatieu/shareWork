#!/usr/bin/env node
// chartroom:managed-post-tool-use-hook (do not edit by hand -- managed by `chartroom
// install-agent-hook`; re-run that command to refresh this file after a chartroom upgrade).
//
// ============================================================================================
// HONESTY NOTE -- read before assuming this hook's detection logic is empirically verified.
// ============================================================================================
// Chart Room phase 5's plan (suite-design/overnight/plans/05-cr-phase5-plan.md §1.4/§9 risk #1)
// assumed this hook would be registered on Claude Code's `PostToolUse` event and would need to
// detect a *failed* Read by string-matching against `tool_response` (assumed to be a plain error
// string even on failure, per an illustrative docs example, "Error: file not found").
//
// The Developer stage's mandatory first step (per the plan's own instructions) was to verify this
// empirically. This session could NOT trigger a real live Claude Code Read failure to capture a
// real hook stdin payload (no ability to drive a live session from within this subagent). Instead,
// `code.claude.com/docs/en/hooks` was fetched live and read directly, which surfaced a MORE
// IMPORTANT correction than a wrong error-string guess would have been:
//
//   `PostToolUse` fires only AFTER A TOOL CALL SUCCEEDS. A distinct event, `PostToolUseFailure`,
//   fires "after a tool call fails" -- confirmed as its own row in the docs' hook-events table.
//
// This means the plan's literal design (matcher on `PostToolUse`, detect failure via a
// `tool_response` string allowlist) would have NEVER FIRED for an actual failed Read -- `PostToolUse`
// simply isn't dispatched for a failed tool call at all. This script is therefore registered on
// `PostToolUseFailure` instead (see the settings.json entry `install-agent-hook.ts` writes) -- a
// deliberate, reasoned deviation from the plan's literal event name, not an oversight.
//
// **What is still NOT empirically confirmed** (the fetched docs page does not document this):
// the exact field name(s)/shape carrying the failure's error text on a `PostToolUseFailure` event.
// The common stdin fields (`tool_name`, `tool_input`, `cwd`, etc.) are confirmed; a field literally
// named `tool_response`, `tool_error`, `error`, or `error_message` carrying the failure text is
// NOT confirmed by the docs page fetched this session. This script defensively checks several
// plausible field names (see `extractErrorText` below) but degrades gracefully -- if no
// recognizable error-text field is found at all, it still proceeds (since `PostToolUseFailure`'s
// own firing already means "this Read failed", per the confirmed table row above), relying on whether
// `chartroom resolve` actually finds something different from what was asked as the real signal of
// usefulness (see the `result.path !== candidate` check below), not on a speculative string match.
//
// If a future Claude Code docs read (or a real triggered failure) reveals a different field name or
// behavior, update `extractErrorText`'s candidate list and this comment -- do not silently assume
// this has been proven correct just because it hasn't been observed to misfire.
// ============================================================================================

import { execFile } from 'node:child_process';
import { basename, isAbsolute, relative, sep } from 'node:path';

function normalizeSlashes(p) {
  return p.split(sep).join('/');
}

// Duplicated, in full, from `packages/chartroom/src/hook-candidate.ts::deriveResolveCandidate`
// (kept in sync by hand -- this script is standalone/dependency-free by design, plan §4 step 1, so
// it cannot `import` the compiled package). Covered independently by
// `test/hooks/deriveResolveCandidate.test.ts` against the TypeScript original.
function deriveResolveCandidate(filePath, repoRoot) {
  if (!isAbsolute(filePath)) {
    return normalizeSlashes(filePath);
  }
  const rel = relative(repoRoot, filePath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return basename(filePath);
  }
  return normalizeSlashes(rel);
}

/** Best-effort extraction of *some* human-readable failure text, across several plausible field
 * names -- purely informational (never gates whether we attempt a resolve; see the honesty note
 * above for why). Returns '' if nothing recognizable is found. */
function extractErrorText(input) {
  const candidates = [input.tool_response, input.tool_error, input.error, input.error_message, input.error?.message];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
  }
  return '';
}

/** A small negative allowlist: if the (best-effort, unconfirmed-shape) error text clearly names a
 * failure mode that has nothing to do with a moved/renamed/deleted path -- permission errors, a
 * directory where a file was expected -- attempting a resolve would just be noise, so skip it. This
 * is deliberately a small, conservative *exclusion* list, not a required-match *inclusion* list --
 * see the honesty note above for why the plan's original inclusion-list design doesn't fit a
 * failure-only event the same way it would have fit a mixed success/failure event. */
const NOT_A_PATH_PROBLEM = [/permission denied/i, /eacces/i, /eisdir/i, /is a directory/i, /too large/i];

function looksLikeAnUnrelatedFailure(errorText) {
  return errorText.length > 0 && NOT_A_PATH_PROBLEM.some((re) => re.test(errorText));
}

function readStdin() {
  return new Promise((resolvePromise) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolvePromise(data));
    process.stdin.on('error', () => resolvePromise(data));
  });
}

/** `CHARTROOM_BIN` lets tests/CI point this at a locally-built `dist/cli.js` (e.g.
 * `"node C:/path/to/dist/cli.js"`) instead of relying on `npx`/PATH resolution -- the real-world
 * default (no env var set) is `npx --yes chartroom`, deliberately not a hardcoded absolute path
 * (plan §1.4's own reasoning: unlike phase 1's pre-commit hook, this is a rare-firing hook where a
 * subprocess's PATH/npx resolution latency is immaterial, and not needing to know an absolute
 * dist-path makes this script portable across however chartroom itself is installed). */
function resolveBinaryInvocation() {
  const override = process.env.CHARTROOM_BIN;
  if (override && override.trim().length > 0) {
    const parts = override.trim().split(/\s+/);
    return { cmd: parts[0], baseArgs: parts.slice(1) };
  }
  return { cmd: 'npx', baseArgs: ['--yes', 'chartroom'] };
}

function runResolve(candidate, cwd) {
  return new Promise((resolvePromise) => {
    const { cmd, baseArgs } = resolveBinaryInvocation();
    execFile(cmd, [...baseArgs, 'resolve', candidate, '--json'], { cwd, timeout: 5000 }, (error, stdout) => {
      // Graceful degradation, every step (plan §4 step 3): chartroom not installed/not on
      // PATH/not a chartroom-managed repo -- a truly silent no-op, never a hook-internal error
      // surfaced to the user/agent.
      if (error) {
        resolvePromise(undefined);
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch {
        resolvePromise(undefined);
      }
    });
  });
}

function emitAdditionalContext(text) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUseFailure',
        additionalContext: text,
      },
    }),
  );
}

async function main() {
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    process.exit(0);
    return;
  }

  if (input.tool_name !== 'Read') {
    process.exit(0);
    return;
  }
  const filePath = input.tool_input && input.tool_input.file_path;
  if (typeof filePath !== 'string' || !filePath.toLowerCase().endsWith('.md')) {
    process.exit(0);
    return;
  }

  const errorText = extractErrorText(input);
  if (looksLikeAnUnrelatedFailure(errorText)) {
    process.exit(0);
    return;
  }

  const cwd = typeof input.cwd === 'string' && input.cwd.length > 0 ? input.cwd : process.cwd();
  const candidate = deriveResolveCandidate(filePath, cwd);

  const result = await runResolve(candidate, cwd);
  if (!result) {
    process.exit(0);
    return;
  }

  if (result.matchType === 'tombstone') {
    emitAdditionalContext(
      `chart-room: '${candidate}' was deleted (id '${result.id}', last at '${result.lastPath}', ` +
        `deleted ${result.deletedAt}). It will not come back at this path -- look for its replacement ` +
        `or ask a human, rather than re-trying the same path.`,
    );
  } else if (
    (result.matchType === 'id' || result.matchType === 'path' || result.matchType === 'filename' || result.matchType === 'fuzzy') &&
    typeof result.path === 'string' &&
    result.path !== candidate
  ) {
    const guessNote = result.matchType === 'fuzzy' ? ' (best-effort guess, not certain -- verify before relying on it)' : '';
    emitAdditionalContext(
      `chart-room: '${candidate}' may have moved. \`chartroom resolve\` found it at '${result.path}'` +
        `${result.id ? ` (id: ${result.id})` : ''}${guessNote}. Try reading that path instead of asking ` +
        `a human where the file went.`,
    );
  }
  // else: not-found, or resolved to the same path we already tried to Read -- nothing useful to
  // add, stay silent (plan §4 step 3's "never worse than doing nothing" posture).

  process.exit(0);
}

main().catch(() => process.exit(0));
