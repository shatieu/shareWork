import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyEdit,
  backupsDir,
  computeAdditiveRules,
  computeRemoveAllowRule,
  hashContent,
  listBackups,
  previewEdit,
  readBackup,
  SettingsEditError,
} from '../src/editor.js';

/** One dedicated test per rail (FO-named risk; plan 07 §4). */

let dir: string;
let home: string;
let target: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'settings-editor-'));
  home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  target = join(dir, 'settings.json');
});

const VALID = `{\n  "permissions": {\n    "allow": ["Bash(ls *)"]\n  }\n}\n`;
const VALID_NEXT = `{\n  "permissions": {\n    "allow": ["Bash(ls *)", "Bash(git status)"]\n  }\n}\n`;

function preview(newContent: string) {
  return previewEdit({ targetPath: target, newContent }, { homeDir: home });
}

describe('rail 2: diff preview is mandatory -- apply demands the preview ticket', () => {
  it('preview returns diff + baseHash; apply with that hash succeeds atomically', () => {
    writeFileSync(target, VALID, 'utf8');
    const p = preview(VALID_NEXT);
    expect(p.unifiedDiff).toContain('+    "allow": ["Bash(ls *)", "Bash(git status)"]');
    expect(p.added).toBeGreaterThan(0);
    const result = applyEdit({ targetPath: target, newContent: VALID_NEXT, baseHash: p.baseHash }, { homeDir: home });
    expect(result.changed).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(VALID_NEXT);
  });

  it('base drift between preview and apply = typed refusal, zero writes', () => {
    writeFileSync(target, VALID, 'utf8');
    const p = preview(VALID_NEXT);
    // A concurrent writer lands after the preview:
    const drifted = `{\n  "permissions": {\n    "allow": ["Bash(ls *)", "WebFetch"]\n  }\n}\n`;
    writeFileSync(target, drifted, 'utf8');
    let error: SettingsEditError | undefined;
    try {
      applyEdit({ targetPath: target, newContent: VALID_NEXT, baseHash: p.baseHash }, { homeDir: home });
    } catch (err) {
      error = err as SettingsEditError;
    }
    expect(error?.code).toBe('base-drift');
    expect(readFileSync(target, 'utf8')).toBe(drifted); // byte-identical to the drifted state
    expect(existsSync(backupsDir(home))).toBe(false); // no backup, no tmp residue
  });

  it('a stale hash for a since-created file also refuses', () => {
    const p = preview(VALID); // file absent at preview time
    expect(p.exists).toBe(false);
    writeFileSync(target, VALID_NEXT, 'utf8');
    expect(() => applyEdit({ targetPath: target, newContent: VALID, baseHash: p.baseHash }, { homeDir: home })).toThrow(
      SettingsEditError,
    );
  });
});

describe('rail 1: validate before any touch', () => {
  it('invalid JSON new content = typed refusal, file untouched', () => {
    writeFileSync(target, VALID, 'utf8');
    let error: SettingsEditError | undefined;
    try {
      applyEdit({ targetPath: target, newContent: '{oops', baseHash: hashContent(VALID) }, { homeDir: home });
    } catch (err) {
      error = err as SettingsEditError;
    }
    expect(error?.code).toBe('invalid-content');
    expect(readFileSync(target, 'utf8')).toBe(VALID);
  });

  it('schema errors block: permissions.allow as a string is refused', () => {
    writeFileSync(target, VALID, 'utf8');
    const bad = '{"permissions": {"allow": "Bash"}}';
    let error: SettingsEditError | undefined;
    try {
      applyEdit({ targetPath: target, newContent: bad, baseHash: hashContent(VALID) }, { homeDir: home });
    } catch (err) {
      error = err as SettingsEditError;
    }
    expect(error?.code).toBe('schema-violation');
    expect(readFileSync(target, 'utf8')).toBe(VALID);
  });

  it('unknown top-level keys WARN in preview but never block (CC ignores unknowns)', () => {
    writeFileSync(target, VALID, 'utf8');
    const withUnknown = '{"totallyNovelKey": true}\n';
    const p = preview(withUnknown);
    expect(p.validation.ok).toBe(true);
    expect(p.validation.warnings.some((w) => w.path === 'totallyNovelKey')).toBe(true);
    const result = applyEdit({ targetPath: target, newContent: withUnknown, baseHash: p.baseHash }, { homeDir: home });
    expect(result.changed).toBe(true);
  });
});

describe('rail 3: malformed target = typed refusal, file byte-identical', () => {
  const MALFORMED = '{"permissions": {broken';

  it('refuses by default and leaves every byte in place', () => {
    writeFileSync(target, MALFORMED, 'utf8');
    const p = preview(VALID);
    expect(p.baseMalformed).toBe(true);
    let error: SettingsEditError | undefined;
    try {
      applyEdit({ targetPath: target, newContent: VALID, baseHash: p.baseHash }, { homeDir: home });
    } catch (err) {
      error = err as SettingsEditError;
    }
    expect(error?.code).toBe('malformed-target');
    expect(readFileSync(target, 'utf8')).toBe(MALFORMED);
    expect(readdirSync(dir).filter((n) => n.includes('.tmp-'))).toEqual([]); // no tmp residue
    expect(existsSync(backupsDir(home))).toBe(false);
  });

  it('explicit recovery opt-in replaces it -- corrupt bytes backed up first', () => {
    writeFileSync(target, MALFORMED, 'utf8');
    const p = preview(VALID);
    const result = applyEdit(
      { targetPath: target, newContent: VALID, baseHash: p.baseHash, overwriteMalformedBase: true },
      { homeDir: home },
    );
    expect(result.changed).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(VALID);
    expect(result.backupPath).toBeDefined();
    expect(readFileSync(result.backupPath!, 'utf8')).toBe(MALFORMED);
  });
});

describe('rail 4: timestamped backups under ~/.suite/settings-backups/', () => {
  it('every replacing apply backs up the original bytes with an origin sidecar', () => {
    writeFileSync(target, VALID, 'utf8');
    const p = preview(VALID_NEXT);
    const result = applyEdit({ targetPath: target, newContent: VALID_NEXT, baseHash: p.baseHash }, { homeDir: home });
    expect(result.backupPath).toContain(join(home, '.suite', 'settings-backups'));
    expect(readFileSync(result.backupPath!, 'utf8')).toBe(VALID);
    const meta = JSON.parse(readFileSync(`${result.backupPath!}.meta.json`, 'utf8'));
    expect(meta.targetPath).toBe(target);
  });

  it('creating a fresh file needs no backup', () => {
    const p = preview(VALID);
    const result = applyEdit({ targetPath: target, newContent: VALID, baseHash: p.baseHash }, { homeDir: home });
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeUndefined();
  });

  it('same-millisecond backups never overwrite each other', () => {
    const now = () => new Date('2026-07-06T12:00:00.000Z');
    writeFileSync(target, VALID, 'utf8');
    const p1 = preview(VALID_NEXT);
    applyEdit({ targetPath: target, newContent: VALID_NEXT, baseHash: p1.baseHash }, { homeDir: home, now });
    const p2 = preview(VALID);
    applyEdit({ targetPath: target, newContent: VALID, baseHash: p2.baseHash }, { homeDir: home, now });
    const backups = listBackups(home);
    expect(backups).toHaveLength(2);
    expect(new Set(backups.map((b) => b.id)).size).toBe(2);
  });

  it('listBackups + readBackup round-trip; restore goes through the same preview/apply gate', () => {
    writeFileSync(target, VALID, 'utf8');
    const p = preview(VALID_NEXT);
    applyEdit({ targetPath: target, newContent: VALID_NEXT, baseHash: p.baseHash }, { homeDir: home });
    const [entry] = listBackups(home);
    expect(entry.targetPath).toBe(target);
    const backup = readBackup(entry.id, home)!;
    expect(backup.content).toBe(VALID);
    // one-click restore = normal rails apply of the backup bytes
    const restorePreview = preview(backup.content);
    const restored = applyEdit(
      { targetPath: target, newContent: backup.content, baseHash: restorePreview.baseHash },
      { homeDir: home },
    );
    expect(restored.changed).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(VALID);
    expect(listBackups(home)).toHaveLength(2); // the restore itself was backed up
  });

  it('readBackup refuses path-traversal ids', () => {
    expect(readBackup('../../etc/passwd', home)).toBeUndefined();
  });
});

describe('rail 5: atomic replace', () => {
  it('writes via a unique same-dir tmp + rename (no partial target possible)', () => {
    writeFileSync(target, VALID, 'utf8');
    const p = preview(VALID_NEXT);
    applyEdit({ targetPath: target, newContent: VALID_NEXT, baseHash: p.baseHash }, { homeDir: home });
    // the tmp file never survives
    expect(readdirSync(dir).filter((n) => n.includes('.tmp-'))).toEqual([]);
    expect(statSync(target).size).toBe(Buffer.byteLength(VALID_NEXT));
  });

  it('no-op apply (identical bytes) writes nothing and takes no backup', () => {
    writeFileSync(target, VALID, 'utf8');
    const before = statSync(target).mtimeMs;
    const p = preview(VALID);
    expect(p.unchanged).toBe(true);
    const result = applyEdit({ targetPath: target, newContent: VALID, baseHash: p.baseHash }, { homeDir: home });
    expect(result.changed).toBe(false);
    expect(statSync(target).mtimeMs).toBe(before);
    expect(listBackups(home)).toHaveLength(0);
  });
});

describe('structured edits (pure computations feeding the same rails)', () => {
  it('computeRemoveAllowRule removes exactly one occurrence, everything else identical', () => {
    const current = JSON.stringify(
      {
        model: 'opus',
        permissions: { allow: ['A', 'B', 'A'], deny: ['X'], defaultMode: 'default' },
        hooks: { Stop: [] },
      },
      null,
      2,
    );
    const next = JSON.parse(computeRemoveAllowRule(current, 'A'));
    expect(next.permissions.allow).toEqual(['B', 'A']);
    expect(next.permissions.deny).toEqual(['X']);
    expect(next.model).toBe('opus');
    expect(next.hooks).toEqual({ Stop: [] });
  });

  it('computeRemoveAllowRule: absent rule = typed rule-not-found', () => {
    expect(() => computeRemoveAllowRule('{"permissions":{"allow":["A"]}}', 'Z')).toThrowError(
      expect.objectContaining({ code: 'rule-not-found' }),
    );
  });

  it('computeRemoveAllowRule refuses malformed input', () => {
    expect(() => computeRemoveAllowRule('{broken', 'A')).toThrowError(
      expect.objectContaining({ code: 'invalid-content' }),
    );
  });

  it('computeAdditiveRules appends only missing rules and preserves everything else', () => {
    const current = JSON.stringify({ model: 'opus', permissions: { allow: ['A'], defaultMode: 'plan' } });
    const { newContent, addedRules } = computeAdditiveRules(current, { allow: ['A', 'B'], deny: ['D'] });
    const next = JSON.parse(newContent);
    expect(addedRules).toBe(2); // A was already present
    expect(next.permissions.allow).toEqual(['A', 'B']);
    expect(next.permissions.deny).toEqual(['D']);
    expect(next.permissions.defaultMode).toBe('plan');
    expect(next.model).toBe('opus');
  });

  it('computeAdditiveRules from a missing file starts a fresh document', () => {
    const { newContent, addedRules } = computeAdditiveRules(undefined, { allow: ['A'] });
    expect(JSON.parse(newContent).permissions.allow).toEqual(['A']);
    expect(addedRules).toBe(1);
  });
});
