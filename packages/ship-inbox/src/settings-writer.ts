import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The "always allow" native-rule writer (Ship_Spec §5 decision; plan 06 §1.1 -- the FO-named
 * risk surface of this package). Writes ONE permission rule into
 * `<projectDir>/.claude/settings.local.json` under `permissions.allow`.
 *
 * Non-negotiables, in the order they are enforced:
 *  1. Validate everything BEFORE touching any file (rule shape, project dir existence).
 *  2. A malformed existing file is REFUSED -- typed error, zero writes, no backup, no tmp file.
 *  3. Additive-only by construction AND by post-check: the merged document is verified to be
 *     exactly the original plus the one appended allow rule; any other difference aborts.
 *  4. JSON round-trip validation: the serialized text is re-parsed and re-verified against the
 *     ORIGINAL parsed object before anything is replaced.
 *  5. Timestamped backup of the original bytes is written beside the file before replacing it.
 *  6. Atomic replace: unique tmp file in the same directory, then rename over the target
 *     (rename replaces on win32 too -- MOVEFILE_REPLACE_EXISTING via libuv).
 *  7. Concurrent-modification retry: the current bytes are re-read immediately before the
 *     replace; if they differ from what this attempt merged from, the attempt is discarded and
 *     the merge re-runs from the NEW content (bounded retries), so a concurrent writer's rules
 *     are merged, never clobbered.
 *
 * Honest limits (documented, not hidden): the re-read+rename pair is not an OS-level lock --
 * a writer that lands in the microseconds between them can still lose; retries + additive
 * semantics make the window practically irrelevant for a local single-human tool. The file is
 * rewritten as 2-space-indented JSON (original formatting is not preserved). Backups accumulate
 * and are never deleted (repo-wide no-delete discipline).
 */

export type SettingsWriteErrorCode =
  | 'invalid-rule'
  | 'invalid-project-dir'
  | 'malformed-settings'
  | 'additive-violation'
  | 'concurrent-conflict';

export class SettingsWriteError extends Error {
  readonly code: SettingsWriteErrorCode;

  constructor(code: SettingsWriteErrorCode, message: string) {
    super(message);
    this.name = 'SettingsWriteError';
    this.code = code;
  }
}

export interface AlwaysAllowOptions {
  /** The project the permission request came from (the hook payload's `cwd`). */
  projectDir: string;
  /** A native Claude Code permission rule, e.g. `WebFetch`, `Bash(git push:*)`. Written
   * verbatim into `permissions.allow` -- Claude Code itself is the rule engine (Ship_Spec §5:
   * "Ship stores nothing. No custom rule engine."). */
  rule: string;
  now?: () => Date;
  /** Test seam: runs after an attempt's merge+validation and before its conflict re-check --
   * lets tests interleave a concurrent writer deterministically. */
  onBeforeReplace?: () => void;
  /** Bounded merge retries when a concurrent modification is detected (default 3). */
  maxAttempts?: number;
}

export interface AlwaysAllowResult {
  /** false = the rule was already present; nothing was written, no backup taken. */
  changed: boolean;
  settingsPath: string;
  /** Present only when an existing file was replaced (a fresh file needs no backup). */
  backupPath?: string;
  rule: string;
}

/** Native permission-rule shape: `Tool` or `Tool(specifier)`. Deliberately loose about the
 * specifier's interior (Claude Code owns that grammar) but strict about control characters and
 * overall length -- this string lands inside a JSON config that Claude Code parses on every
 * session start. */
const RULE_RE = /^[A-Za-z][A-Za-z0-9_ -]*(\(.*\))?$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/;
const MAX_RULE_LENGTH = 500;

interface SettingsShape {
  root: Record<string, unknown>;
  permissions: Record<string, unknown>;
  allow: string[];
}

function validateRule(rule: string): void {
  if (
    rule.length === 0 ||
    rule.length > MAX_RULE_LENGTH ||
    CONTROL_CHARS_RE.test(rule) ||
    !RULE_RE.test(rule)
  ) {
    throw new SettingsWriteError('invalid-rule', `not a plausible permission rule: ${JSON.stringify(rule)}`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses + shape-checks existing settings content. Anything unexpected is a REFUSAL, never a
 * coercion -- this file drives live permission enforcement; guessing is how rules get lost. */
function parseSettings(text: string, path: string): SettingsShape {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (err) {
    throw new SettingsWriteError('malformed-settings', `${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (!isPlainObject(root)) {
    throw new SettingsWriteError('malformed-settings', `${path}: top level is not an object`);
  }
  const permissions = root.permissions ?? {};
  if (!isPlainObject(permissions)) {
    throw new SettingsWriteError('malformed-settings', `${path}: "permissions" is not an object`);
  }
  const allow = permissions.allow ?? [];
  if (!Array.isArray(allow) || allow.some((entry) => typeof entry !== 'string')) {
    throw new SettingsWriteError(
      'malformed-settings',
      `${path}: "permissions.allow" is not an array of strings`,
    );
  }
  return { root, permissions, allow: allow as string[] };
}

/** The additive-only invariant (non-negotiable 3): `next` must be exactly `original` plus the
 * one appended allow rule. Every top-level key and every other permissions key must survive
 * byte-identically (JSON-compare); the allow array must be the original plus `[rule]`. */
function verifyAdditive(
  original: SettingsShape,
  next: Record<string, unknown>,
  rule: string,
  path: string,
): void {
  if (!isPlainObject(next)) {
    throw new SettingsWriteError('additive-violation', `${path}: merged result is not an object`);
  }
  const nextPermissions = next.permissions;
  if (!isPlainObject(nextPermissions)) {
    throw new SettingsWriteError('additive-violation', `${path}: merged "permissions" is not an object`);
  }
  const nextAllow = nextPermissions.allow;
  if (!Array.isArray(nextAllow)) {
    throw new SettingsWriteError('additive-violation', `${path}: merged "permissions.allow" is not an array`);
  }
  const expectedAllow = [...original.allow, rule];
  if (JSON.stringify(nextAllow) !== JSON.stringify(expectedAllow)) {
    throw new SettingsWriteError(
      'additive-violation',
      `${path}: merged allow list is not exactly original + [${rule}]`,
    );
  }
  for (const key of Object.keys(original.permissions)) {
    if (key === 'allow') continue;
    if (JSON.stringify(nextPermissions[key]) !== JSON.stringify(original.permissions[key])) {
      throw new SettingsWriteError('additive-violation', `${path}: "permissions.${key}" changed`);
    }
  }
  for (const key of Object.keys(nextPermissions)) {
    if (key === 'allow') continue;
    if (!(key in original.permissions)) {
      throw new SettingsWriteError('additive-violation', `${path}: "permissions.${key}" appeared`);
    }
  }
  for (const key of Object.keys(original.root)) {
    if (key === 'permissions') continue;
    if (JSON.stringify(next[key]) !== JSON.stringify(original.root[key])) {
      throw new SettingsWriteError('additive-violation', `${path}: top-level "${key}" changed`);
    }
  }
  for (const key of Object.keys(next)) {
    if (key === 'permissions') continue;
    if (!(key in original.root)) {
      throw new SettingsWriteError('additive-violation', `${path}: top-level "${key}" appeared`);
    }
  }
}

function compactStamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, '');
}

/** A backup path that never overwrites an existing backup (same-millisecond writes get a
 * `-1`, `-2`, ... suffix). Backups are never deleted. */
function freshBackupPath(settingsPath: string, stamp: string): string {
  const base = `${settingsPath}.bak-${stamp}`;
  if (!existsSync(base)) return base;
  for (let n = 1; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!existsSync(candidate)) return candidate;
  }
}

export function settingsLocalPath(projectDir: string): string {
  return join(projectDir, '.claude', 'settings.local.json');
}

export function applyAlwaysAllowRule(options: AlwaysAllowOptions): AlwaysAllowResult {
  const { projectDir, rule } = options;
  const now = options.now ?? (() => new Date());
  const maxAttempts = options.maxAttempts ?? 3;

  validateRule(rule);
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    throw new SettingsWriteError('invalid-project-dir', `project directory does not exist: ${projectDir}`);
  }

  const settingsPath = settingsLocalPath(projectDir);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // 1. Read + parse + shape-check the current content (missing file = empty settings).
    const originalBytes = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : undefined;
    const original = parseSettings(originalBytes ?? '{}', settingsPath);

    // 2. Already present -> nothing to do (no write, no backup).
    if (original.allow.includes(rule)) {
      return { changed: false, settingsPath, rule };
    }

    // 3. Merge: a structured clone plus the one appended rule.
    const next = structuredClone(original.root);
    const nextPermissions = isPlainObject(next.permissions) ? next.permissions : {};
    next.permissions = nextPermissions;
    const nextAllow = Array.isArray(nextPermissions.allow) ? [...(nextPermissions.allow as string[])] : [];
    nextAllow.push(rule);
    nextPermissions.allow = nextAllow;

    // 4. Additive post-check + JSON round-trip validation against the ORIGINAL parse.
    verifyAdditive(original, next, rule, settingsPath);
    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    verifyAdditive(original, JSON.parse(serialized) as Record<string, unknown>, rule, settingsPath);

    options.onBeforeReplace?.();

    // 5. Conflict check: someone changed the file since this attempt read it -> retry the whole
    //    merge from the new content (their rules are merged in, never clobbered).
    const currentBytes = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : undefined;
    if (currentBytes !== originalBytes) {
      continue;
    }

    // 6. Backup the original bytes, then atomic replace via same-dir tmp + rename.
    mkdirSync(join(projectDir, '.claude'), { recursive: true });
    let backupPath: string | undefined;
    if (originalBytes !== undefined) {
      backupPath = freshBackupPath(settingsPath, compactStamp(now()));
      copyFileSync(settingsPath, backupPath);
    }
    const tmpPath = `${settingsPath}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
    writeFileSync(tmpPath, serialized, 'utf8');
    renameSync(tmpPath, settingsPath);

    return { changed: true, settingsPath, backupPath, rule };
  }

  throw new SettingsWriteError(
    'concurrent-conflict',
    `${settingsPath}: kept changing under concurrent writers (${maxAttempts} attempts)`,
  );
}
