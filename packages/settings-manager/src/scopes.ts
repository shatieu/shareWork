import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Scope discovery + read-only loading (plan 07 §3, Trio_Specs §B). This module NEVER writes --
 * it feeds both the simulator (provably read-only) and the editor (which writes only through
 * editor.ts's rails).
 *
 * Verified facts (code.claude.com/docs/en/settings, fetched 2026-07-06): precedence highest→lowest
 * is managed → CLI args → local → project → user. Permission arrays MERGE across scopes; every
 * other setting is overridden by precedence. The CLI-args scope has no file representation, so it
 * is surfaced as an explicit "not simulatable from files" caveat, never guessed.
 */

/** File-backed scopes, ordered highest precedence first. */
export const SCOPE_ORDER = ['managed', 'local', 'project', 'user'] as const;
export type ScopeName = (typeof SCOPE_ORDER)[number];

/** Scopes the editor may ever write. Managed is policy (IT-owned); CLI args aren't a file. */
export const WRITABLE_SCOPES = ['local', 'project', 'user'] as const;
export type WritableScopeName = (typeof WRITABLE_SCOPES)[number];

export interface ScopeFile {
  scope: ScopeName;
  /** Absolute path this scope resolves to on this machine. */
  path: string;
  exists: boolean;
  /** Parsed JSON document (plain object) when the file exists and parses cleanly. */
  settings?: Record<string, unknown>;
  /** Parse/shape failure -- the scope is EXCLUDED from merging and the error is surfaced.
   * A malformed settings file is never coerced or partially read. */
  error?: string;
  /** Raw bytes as read (present whenever the file exists, even when malformed). */
  raw?: string;
}

export interface ScopePathOptions {
  /** Project directory for project/local scopes. Omit = user+managed only. */
  projectDir?: string;
  /** Home-directory override -- tests never touch the real home. */
  homeDir?: string;
  /** Managed-settings file override -- tests never depend on IT policy files.
   * Default: the documented per-OS path. */
  managedPath?: string;
  /** Platform override for the managed-path default (tests). Default `process.platform`. */
  platform?: NodeJS.Platform;
}

/** Documented managed-settings file path per OS (docs 2026-07-06; the Windows ProgramData
 * location is legacy-dead as of CC 2.1.75). MDM/registry/server delivery mechanisms are not
 * readable here -- their absence is reported as a simulator caveat, not silently ignored. */
export function defaultManagedPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode\\managed-settings.json';
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json';
  return '/etc/claude-code/managed-settings.json';
}

export function scopePath(scope: ScopeName, options: ScopePathOptions = {}): string | undefined {
  const home = options.homeDir ?? homedir();
  switch (scope) {
    case 'managed':
      return options.managedPath ?? defaultManagedPath(options.platform);
    case 'user':
      return join(home, '.claude', 'settings.json');
    case 'project':
      return options.projectDir ? join(options.projectDir, '.claude', 'settings.json') : undefined;
    case 'local':
      return options.projectDir ? join(options.projectDir, '.claude', 'settings.local.json') : undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads one scope file. Missing file = exists:false (not an error). Malformed JSON or a
 * non-object top level = error surfaced, settings absent. */
export function readScopeFile(scope: ScopeName, path: string): ScopeFile {
  if (!existsSync(path) || !statSync(path).isFile()) {
    return { scope, path, exists: false };
  }
  const raw = readFileSync(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { scope, path, exists: true, raw, error: `not valid JSON: ${(err as Error).message}` };
  }
  if (!isPlainObject(parsed)) {
    return { scope, path, exists: true, raw, error: 'top level is not an object' };
  }
  return { scope, path, exists: true, raw, settings: parsed };
}

/** Loads every file-backed scope, highest precedence first. Scopes with no resolvable path
 * (project/local without a projectDir) are omitted entirely. */
export function loadScopes(options: ScopePathOptions = {}): ScopeFile[] {
  const files: ScopeFile[] = [];
  for (const scope of SCOPE_ORDER) {
    const path = scopePath(scope, options);
    if (!path) continue;
    files.push(readScopeFile(scope, path));
  }
  return files;
}
