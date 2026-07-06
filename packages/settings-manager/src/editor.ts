import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { countChanges, diffLines, formatUnifiedDiff, type DiffOp } from './diff.js';
import { structuralSchema, type SchemaProvider, type ValidationResult } from './schema.js';

/**
 * THE RAILS (Trio_Specs §B non-negotiables; plan 07 §3/§4 -- the FO-named risk surface).
 * Every settings write in this package flows through `applyEdit`. Enforced order:
 *
 *  1. VALIDATE BEFORE ANY TOUCH: the new content must parse, be a plain object, and pass the
 *     schema provider with zero errors (warnings pass through to the UI, never block).
 *  2. DIFF BEFORE APPLY: `applyEdit` demands the `baseHash` that only `previewEdit` hands out --
 *     proof the caller diffed against the exact bytes being replaced. Hash drift = typed 409
 *     refusal, zero writes.
 *  3. MALFORMED TARGET = TYPED REFUSAL, file byte-identical. Explicit `overwriteMalformedBase`
 *     opt-in exists as the documented RECOVERY path (a corrupt file must be replaceable with
 *     validated content, or there is no way back) -- and even then the corrupt bytes are backed
 *     up first.
 *  4. TIMESTAMPED BACKUP of the original bytes under `~/.suite/settings-backups/` (spec §B),
 *     with a `.meta.json` sidecar recording the origin path. Backups are never deleted.
 *  5. ATOMIC REPLACE: unique same-directory tmp file + rename (rename replaces on win32 too).
 *  6. JSON ROUND-TRIP: the serialized bytes are re-parsed and deep-compared before replacing.
 *
 * Prior art: ship-inbox's `settings-writer.ts` (merged 2026-07-06) pioneered rails 4-6 for its
 * single-rule additive write; this module generalizes them to document-level edits and shares
 * its honest limit: the read-hash-rename window is not an OS lock -- the hash gate makes a lost
 * concurrent write detectable (409), not impossible.
 */

export type SettingsEditErrorCode =
  | 'invalid-content'
  | 'schema-violation'
  | 'malformed-target'
  | 'base-drift'
  | 'rule-not-found'
  | 'subtractive-violation'
  | 'additive-violation';

export class SettingsEditError extends Error {
  readonly code: SettingsEditErrorCode;
  readonly details?: unknown;

  constructor(code: SettingsEditErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'SettingsEditError';
    this.code = code;
    this.details = details;
  }
}

export interface EditorOptions {
  /** Home-directory override for the backups root -- tests never touch the real home. */
  homeDir?: string;
  now?: () => Date;
  schema?: SchemaProvider;
}

export interface EditPreview {
  targetPath: string;
  exists: boolean;
  /** sha256 of the CURRENT bytes (sentinel for a missing file) -- the apply ticket. */
  baseHash: string;
  /** Whether the current content parses as a settings document. */
  baseMalformed: boolean;
  baseError?: string;
  ops: DiffOp[];
  unifiedDiff: string;
  added: number;
  removed: number;
  /** Validation of the NEW content -- `errors` here will block apply. */
  validation: ValidationResult;
  schemaSource: string;
  /** True when newContent is byte-identical to the current file (apply would be a no-op). */
  unchanged: boolean;
}

export interface ApplyResult {
  targetPath: string;
  changed: boolean;
  backupPath?: string;
}

const ABSENT_SENTINEL = '<absent>';

export function hashContent(content: string | undefined): string {
  return createHash('sha256').update(content ?? ABSENT_SENTINEL, 'utf8').digest('hex');
}

export function backupsDir(homeDir?: string): string {
  return join(homeDir ?? homedir(), '.suite', 'settings-backups');
}

function compactStamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, '');
}

function sanitizeForFilename(path: string): string {
  return path.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+/, '').slice(-140);
}

function readCurrent(targetPath: string): string | undefined {
  if (!existsSync(targetPath) || !statSync(targetPath).isFile()) return undefined;
  return readFileSync(targetPath, 'utf8');
}

function parseDocument(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new SettingsEditError('invalid-content', `not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SettingsEditError('invalid-content', 'top level is not an object');
  }
  return parsed as Record<string, unknown>;
}

/** Rail 1+6 combined for a candidate document: parse, schema-check, round-trip-verify. Returns
 * the exact serialized bytes that will hit the disk. */
function validateNewContent(newContent: string, schema: SchemaProvider): { serialized: string; validation: ValidationResult } {
  const document = parseDocument(newContent);
  const validation = schema.validate(document);
  if (!validation.ok) {
    throw new SettingsEditError('schema-violation', 'new content fails schema validation', validation.errors);
  }
  // Preserve the caller's formatting byte-for-byte, but PROVE it round-trips to the same
  // document before anything is replaced (rail 6).
  const reparsed = JSON.parse(newContent) as unknown;
  if (JSON.stringify(reparsed) !== JSON.stringify(document)) {
    throw new SettingsEditError('invalid-content', 'JSON round-trip mismatch');
  }
  return { serialized: newContent.endsWith('\n') ? newContent : `${newContent}\n`, validation };
}

/** READ-ONLY preview: current bytes, diff, validation, and the apply ticket (baseHash). */
export function previewEdit(
  args: { targetPath: string; newContent: string },
  options: EditorOptions = {},
): EditPreview {
  const schema = options.schema ?? structuralSchema;
  const current = readCurrent(args.targetPath);

  let baseMalformed = false;
  let baseError: string | undefined;
  if (current !== undefined) {
    try {
      parseDocument(current);
    } catch (err) {
      baseMalformed = true;
      baseError = (err as SettingsEditError).message;
    }
  }

  let validation: ValidationResult;
  let serialized = args.newContent;
  try {
    const checked = validateNewContent(args.newContent, schema);
    validation = checked.validation;
    serialized = checked.serialized;
  } catch (err) {
    if (err instanceof SettingsEditError) {
      // schema-violation carries the structured issues in `details` -- surface them verbatim
      // so the UI can point at the offending key, not just a flattened message.
      const issues = err.code === 'schema-violation' && Array.isArray(err.details)
        ? (err.details as { path: string; message: string }[])
        : [{ path: '', message: err.message }];
      validation = { ok: false, errors: issues, warnings: [] };
    } else {
      throw err;
    }
  }

  const ops = diffLines(current ?? '', serialized);
  const { added, removed } = countChanges(ops);
  return {
    targetPath: args.targetPath,
    exists: current !== undefined,
    baseHash: hashContent(current),
    baseMalformed,
    baseError,
    ops,
    unifiedDiff: formatUnifiedDiff(ops),
    added,
    removed,
    validation,
    schemaSource: schema.source,
    unchanged: current !== undefined && current === serialized,
  };
}

export interface ApplyEditArgs {
  targetPath: string;
  newContent: string;
  /** The `baseHash` from a preview of the exact bytes being replaced (rail 2). */
  baseHash: string;
  /** Documented recovery path for a corrupt target (rail 3) -- backup still taken. */
  overwriteMalformedBase?: boolean;
}

export function applyEdit(args: ApplyEditArgs, options: EditorOptions = {}): ApplyResult {
  const schema = options.schema ?? structuralSchema;
  const now = options.now ?? (() => new Date());

  // Rail 1: validate the NEW content before touching anything.
  const { serialized } = validateNewContent(args.newContent, schema);

  // Rail 2: the caller must hold a preview ticket for the exact current bytes.
  const current = readCurrent(args.targetPath);
  if (hashContent(current) !== args.baseHash) {
    throw new SettingsEditError(
      'base-drift',
      `${args.targetPath} changed since the diff was previewed -- re-preview and re-confirm`,
    );
  }

  // Rail 3: a malformed target is refused byte-identical unless recovery is explicit.
  if (current !== undefined) {
    try {
      parseDocument(current);
    } catch (err) {
      if (!args.overwriteMalformedBase) {
        throw new SettingsEditError(
          'malformed-target',
          `${args.targetPath} is malformed (${(err as SettingsEditError).message}); refusing to edit. ` +
            'Restore a backup, or re-apply with overwriteMalformedBase to replace it (the corrupt bytes are backed up first).',
        );
      }
    }
  }

  if (current !== undefined && current === serialized) {
    return { targetPath: args.targetPath, changed: false };
  }

  // Rail 4: timestamped backup (with origin sidecar) before replacing an existing file.
  let backupPath: string | undefined;
  if (current !== undefined) {
    backupPath = writeBackup(args.targetPath, current, now(), options.homeDir);
  }

  // Rail 5: unique same-dir tmp + atomic rename.
  mkdirSync(dirname(args.targetPath), { recursive: true });
  const tmpPath = `${args.targetPath}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  writeFileSync(tmpPath, serialized, 'utf8');
  renameSync(tmpPath, args.targetPath);

  return { targetPath: args.targetPath, changed: true, backupPath };
}

/* ────────────────────────────── backups ────────────────────────────── */

export interface BackupEntry {
  /** Backup filename (the restore id). */
  id: string;
  path: string;
  /** Original file the backup came from. */
  targetPath: string;
  createdAt: string;
  bytes: number;
}

function writeBackup(targetPath: string, content: string, at: Date, homeDir?: string): string {
  const dir = backupsDir(homeDir);
  mkdirSync(dir, { recursive: true });
  const base = `${compactStamp(at)}--${sanitizeForFilename(targetPath)}`;
  let name = `${base}.json`;
  for (let n = 1; existsSync(join(dir, name)); n += 1) {
    name = `${base}-${n}.json`;
  }
  const backupPath = join(dir, name);
  const tmpPath = `${backupPath}.tmp-${process.pid}`;
  writeFileSync(tmpPath, content, 'utf8');
  renameSync(tmpPath, backupPath);
  writeFileSync(`${backupPath}.meta.json`, `${JSON.stringify({ targetPath, createdAt: at.toISOString() }, null, 2)}\n`, 'utf8');
  return backupPath;
}

export function listBackups(homeDir?: string): BackupEntry[] {
  const dir = backupsDir(homeDir);
  if (!existsSync(dir)) return [];
  const entries: BackupEntry[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json') || name.endsWith('.meta.json')) continue;
    const metaPath = join(dir, `${name}.meta.json`);
    let targetPath = '';
    let createdAt = '';
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
        targetPath = typeof meta.targetPath === 'string' ? meta.targetPath : '';
        createdAt = typeof meta.createdAt === 'string' ? meta.createdAt : '';
      } catch {
        /* a corrupt sidecar degrades the label, never the listing */
      }
    }
    const full = join(dir, name);
    entries.push({ id: name, path: full, targetPath, createdAt, bytes: statSync(full).size });
  }
  return entries.sort((a, b) => b.id.localeCompare(a.id));
}

export function readBackup(id: string, homeDir?: string): { entry: BackupEntry; content: string } | undefined {
  if (id.includes('/') || id.includes('\\') || id.includes('..')) return undefined;
  const entry = listBackups(homeDir).find((candidate) => candidate.id === id);
  if (!entry) return undefined;
  return { entry, content: readFileSync(entry.path, 'utf8') };
}

/* ────────────────── structured edit computations (pure; no fs) ────────────────── */

function clonePermissions(document: Record<string, unknown>): {
  next: Record<string, unknown>;
  permissions: Record<string, unknown>;
} {
  const next = structuredClone(document);
  const permissions =
    typeof next.permissions === 'object' && next.permissions !== null && !Array.isArray(next.permissions)
      ? (next.permissions as Record<string, unknown>)
      : {};
  next.permissions = permissions;
  return { next, permissions };
}

/**
 * Revoke: remove EXACTLY ONE occurrence of `rule` from `permissions.allow`. Post-verified: the
 * result must be the original minus that single entry, everything else byte-equal (the
 * subtractive mirror of ship-inbox's additive invariant).
 */
export function computeRemoveAllowRule(currentText: string, rule: string): string {
  const original = parseDocument(currentText);
  const { next, permissions } = clonePermissions(original);
  const allow = Array.isArray(permissions.allow) ? [...(permissions.allow as unknown[])] : [];
  const index = allow.indexOf(rule);
  if (index === -1) {
    throw new SettingsEditError('rule-not-found', `allow rule not present: ${JSON.stringify(rule)}`);
  }
  allow.splice(index, 1);
  permissions.allow = allow;

  // Post-check: putting the rule back at the same index must reproduce the original document
  // exactly -- proof the removal touched nothing else. (`rule` was found in `permissions.allow`,
  // so the original necessarily had a permissions object; clonePermissions changed nothing.)
  const restored = structuredClone(next);
  ((restored.permissions as Record<string, unknown>).allow as unknown[]).splice(index, 0, rule);
  if (JSON.stringify(restored) !== JSON.stringify(original)) {
    throw new SettingsEditError('subtractive-violation', 'removal would change more than the one rule');
  }
  return `${JSON.stringify(next, null, 2)}\n`;
}

/**
 * Template-pack application: additively merge permission rules into a document (missing file =
 * empty document). Post-verified additive: result is the original plus only the appended rules.
 */
export function computeAdditiveRules(
  currentText: string | undefined,
  add: { allow?: string[]; deny?: string[]; ask?: string[] },
): { newContent: string; addedRules: number } {
  const original = currentText === undefined ? {} : parseDocument(currentText);
  const { next, permissions } = clonePermissions(original);
  let addedRules = 0;
  for (const list of ['allow', 'deny', 'ask'] as const) {
    const additions = add[list];
    if (!additions || additions.length === 0) continue;
    const existing = Array.isArray(permissions[list]) ? [...(permissions[list] as unknown[])] : [];
    const before = existing.length;
    for (const rule of additions) {
      if (!existing.includes(rule)) existing.push(rule);
    }
    addedRules += existing.length - before;
    if (existing.length > 0 || permissions[list] !== undefined) permissions[list] = existing;
  }

  // Additive post-check (rail: additive by construction AND by verification):
  //  (a) each merged list starts with the original list, byte-equal;
  //  (b) every appended element was explicitly requested and not already present;
  //  (c) with the three lists blanked out on both sides, the documents are identical.
  const originalRoot = original as Record<string, unknown>;
  const originalPermissions =
    typeof originalRoot.permissions === 'object' && originalRoot.permissions !== null && !Array.isArray(originalRoot.permissions)
      ? (originalRoot.permissions as Record<string, unknown>)
      : {};
  for (const list of ['allow', 'deny', 'ask'] as const) {
    const originalList = Array.isArray(originalPermissions[list]) ? (originalPermissions[list] as unknown[]) : [];
    const nextList = Array.isArray(permissions[list]) ? (permissions[list] as unknown[]) : [];
    if (JSON.stringify(nextList.slice(0, originalList.length)) !== JSON.stringify(originalList)) {
      throw new SettingsEditError('additive-violation', `merged '${list}' does not preserve the original prefix`);
    }
    for (const appended of nextList.slice(originalList.length)) {
      if (typeof appended !== 'string' || !(add[list] ?? []).includes(appended) || originalList.includes(appended)) {
        throw new SettingsEditError('additive-violation', `merged '${list}' gained an unrequested entry`);
      }
    }
  }
  const blank = (doc: Record<string, unknown>): string => {
    const copy = structuredClone(doc);
    const perms =
      typeof copy.permissions === 'object' && copy.permissions !== null && !Array.isArray(copy.permissions)
        ? (copy.permissions as Record<string, unknown>)
        : {};
    for (const list of ['allow', 'deny', 'ask'] as const) delete perms[list];
    copy.permissions = perms;
    return JSON.stringify(copy);
  };
  if (blank(next) !== blank(originalRoot)) {
    throw new SettingsEditError('additive-violation', 'merge would change keys outside the permission lists');
  }

  return { newContent: `${JSON.stringify(next, null, 2)}\n`, addedRules };
}

/**
 * Add-modal batch computation (plan 14): sets/overwrites exactly the requested top-level keys,
 * optionally sets `permissions.defaultMode`, and appends missing permission rules additively --
 * ONE new document per target file, applied through the same preview/apply rails. Pure; no fs.
 *
 * Post-checks mirror the package-7 invariants:
 *  - only the requested keys differ from the original (everything else byte-equal);
 *  - original rule lists survive as exact prefixes; appended entries are requested + new;
 *  - `values.permissions` is refused (the permissions surface is rules + defaultMode here).
 */
export interface SettingsAdditions {
  /** Top-level keys to set (overwriting an existing key is allowed -- the diff shows it). */
  values?: Record<string, unknown>;
  /** Sets `permissions.defaultMode` (scalar-override semantics). */
  defaultMode?: string;
  permissions?: { allow?: string[]; deny?: string[]; ask?: string[] };
}

export interface AddSettingsResult {
  newContent: string;
  /** Requested keys that did not exist before ("added" badges in the UI). */
  addedKeys: string[];
  /** Requested keys that existed and now hold a new value ("overwritten" badges). */
  overwrittenKeys: string[];
  addedRules: number;
}

export function computeAddSettings(
  currentText: string | undefined,
  additions: SettingsAdditions,
): AddSettingsResult {
  const values = additions.values ?? {};
  if ('permissions' in values) {
    throw new SettingsEditError(
      'invalid-content',
      'set permission rules via the rule lists, not a raw "permissions" value',
    );
  }
  const original = currentText === undefined ? {} : parseDocument(currentText);

  // Rules first (reuses the additive invariant + its post-check verbatim).
  const ruleAdditions = additions.permissions ?? {};
  const wantsRules = Boolean(
    ruleAdditions.allow?.length || ruleAdditions.deny?.length || ruleAdditions.ask?.length,
  );
  const afterRules = wantsRules
    ? computeAdditiveRules(currentText, ruleAdditions)
    : { newContent: currentText ?? '{}', addedRules: 0 };
  const next = parseDocument(afterRules.newContent);

  const addedKeys: string[] = [];
  const overwrittenKeys: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    (key in original ? overwrittenKeys : addedKeys).push(key);
    next[key] = structuredClone(value);
  }
  if (additions.defaultMode !== undefined) {
    const permissions =
      typeof next.permissions === 'object' && next.permissions !== null && !Array.isArray(next.permissions)
        ? (next.permissions as Record<string, unknown>)
        : {};
    const originalPermissions =
      typeof original.permissions === 'object' && original.permissions !== null && !Array.isArray(original.permissions)
        ? (original.permissions as Record<string, unknown>)
        : {};
    ('defaultMode' in originalPermissions ? overwrittenKeys : addedKeys).push('permissions.defaultMode');
    permissions.defaultMode = additions.defaultMode;
    next.permissions = permissions;
  }

  // Post-check: reverting the requested keys on the result must reproduce the rules-only
  // document exactly -- proof nothing outside the request changed.
  const check = structuredClone(next);
  const rulesOnly = parseDocument(afterRules.newContent);
  for (const key of Object.keys(values)) {
    if (key in rulesOnly) check[key] = structuredClone(rulesOnly[key]);
    else delete check[key];
  }
  if (additions.defaultMode !== undefined) {
    const checkPermissions = check.permissions as Record<string, unknown>;
    const rulesOnlyPermissions =
      typeof rulesOnly.permissions === 'object' && rulesOnly.permissions !== null && !Array.isArray(rulesOnly.permissions)
        ? (rulesOnly.permissions as Record<string, unknown>)
        : undefined;
    if (rulesOnlyPermissions && 'defaultMode' in rulesOnlyPermissions) {
      checkPermissions.defaultMode = rulesOnlyPermissions.defaultMode;
    } else {
      delete checkPermissions.defaultMode;
      if (rulesOnlyPermissions === undefined && Object.keys(checkPermissions).length === 0) {
        delete check.permissions;
      }
    }
  }
  if (JSON.stringify(check) !== JSON.stringify(rulesOnly)) {
    throw new SettingsEditError('additive-violation', 'batch add would change keys outside the request');
  }

  return {
    newContent: `${JSON.stringify(next, null, 2)}
`,
    addedKeys,
    overwrittenKeys,
    addedRules: afterRules.addedRules,
  };
}
