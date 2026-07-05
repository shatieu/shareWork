import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Marker written into the installed hook script file (mirrors `install-hook.ts`'s own
 * `HOOK_MARKER` convention, plan §1.4/§4/§9.4 precedent) -- lets a re-run of `install-agent-hook`
 * tell "this is our own script" (safe to refresh) apart from some unrelated pre-existing file at
 * the same path (refuse to clobber). */
const HOOK_MARKER = 'chartroom:managed-post-tool-use-hook';
const HOOK_SCRIPT_RELATIVE_PATH = '.claude/hooks/chartroom-post-tool-use.mjs';
/** Registered on `PostToolUseFailure`, not the plan's originally-assumed `PostToolUse` -- see the
 * hook script's own header comment and this package's phase-5 report for why (Claude Code's docs,
 * fetched live this session, confirm `PostToolUse` fires only after a tool call *succeeds*; a
 * distinct `PostToolUseFailure` event fires "after a tool call fails" -- a load-bearing correction
 * to the plan's assumption, not a style choice). */
const MARKER_IN_COMMAND = 'chartroom-post-tool-use.mjs';

export type InstallAgentHookResult =
  | { status: 'installed' }
  | { status: 'already-present' }
  | { status: 'refused'; scriptPath: string };

function hookTemplatePath(): string {
  // This module compiles to dist/install-agent-hook.js; the template ships at the package root's
  // own hook-template/ dir (declared in package.json "files"), one level up from dist/ -- resolved
  // relative to this file's own URL, same robustness reasoning as `install-hook.ts`'s
  // `writeShim`, regardless of where the target repo lives or how chartroom itself was installed.
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return join(thisDir, '..', 'hook-template', 'chartroom-post-tool-use.mjs');
}

interface HookEntry {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string }>;
}

interface SettingsJson {
  hooks?: {
    PostToolUseFailure?: HookEntry[];
    [otherEvent: string]: HookEntry[] | undefined;
  };
  [key: string]: unknown;
}

function readSettings(settingsPath: string): SettingsJson {
  if (!existsSync(settingsPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as SettingsJson) : {};
  } catch {
    // Malformed existing settings.json -- do not attempt to guess-repair it; treat as empty so we
    // at least don't crash, but this means a malformed file's *other* keys would be lost on write.
    // Flagged in the CLI command's own printed output (see commands/install-agent-hook.ts).
    return {};
  }
}

/**
 * Merges a `PostToolUseFailure`/`Read` entry into `settings.json` (creating the file/`hooks` key if
 * absent). Never removes or overwrites an existing, differently-authored `PostToolUseFailure` entry
 * for a different matcher, or any other event's entries -- only appends our own entry if it isn't
 * already present (plan §4 step 5's "never clobber, always merge/append" discipline, applied to a
 * JSON config file instead of `install-hook.ts`'s shell script).
 */
function mergeSettingsJson(settingsPath: string): 'installed' | 'already-present' {
  const settings = readSettings(settingsPath);
  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks.PostToolUseFailure)) settings.hooks.PostToolUseFailure = [];

  const entries = settings.hooks.PostToolUseFailure;
  const alreadyPresent = entries.some(
    (entry) =>
      entry.matcher === 'Read' &&
      Array.isArray(entry.hooks) &&
      entry.hooks.some((h) => typeof h.command === 'string' && h.command.includes(MARKER_IN_COMMAND)),
  );

  if (!alreadyPresent) {
    entries.push({
      matcher: 'Read',
      hooks: [{ type: 'command', command: `node "\${CLAUDE_PROJECT_DIR}/${HOOK_SCRIPT_RELATIVE_PATH}"` }],
    });
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return alreadyPresent ? 'already-present' : 'installed';
}

/**
 * Writes/merges `.claude/settings.json`'s `PostToolUseFailure` entry plus the hook script file
 * (plan §1.4/§4/§7). Refuses to overwrite a differently-authored file already at
 * `.claude/hooks/chartroom-post-tool-use.mjs` (same "refuse to clobber, print instructions"
 * discipline as `install-hook.ts`'s git-hook-collision handling) -- in that case, `settings.json` is
 * left untouched too (nothing to point the entry at).
 */
export function installAgentHook(repoRoot: string): InstallAgentHookResult {
  const scriptPath = join(repoRoot, HOOK_SCRIPT_RELATIVE_PATH);
  const scriptDir = dirname(scriptPath);

  if (existsSync(scriptPath)) {
    const existing = readFileSync(scriptPath, 'utf8');
    if (!existing.includes(HOOK_MARKER)) {
      return { status: 'refused', scriptPath };
    }
  } else if (!existsSync(scriptDir)) {
    mkdirSync(scriptDir, { recursive: true });
  }

  const template = readFileSync(hookTemplatePath(), 'utf8');
  writeFileSync(scriptPath, template, 'utf8');

  const settingsPath = join(repoRoot, '.claude', 'settings.json');
  const settingsDir = dirname(settingsPath);
  if (!existsSync(settingsDir)) mkdirSync(settingsDir, { recursive: true });

  const mergeResult = mergeSettingsJson(settingsPath);
  return mergeResult === 'already-present' ? { status: 'already-present' } : { status: 'installed' };
}
