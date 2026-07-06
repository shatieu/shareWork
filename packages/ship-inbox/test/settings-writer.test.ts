import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyAlwaysAllowRule, settingsLocalPath, SettingsWriteError } from '../src/settings-writer.js';

/** The FO-named risk suite (plan 06 §1.1): every non-negotiable of the always-allow writer gets
 * its own dedicated proof here -- validation-first, malformed refusal, additive-only, round-trip
 * validation, timestamped backup, atomic replace, concurrent-merge retry. */

let projectDir: string;

const NOW = () => new Date('2026-07-06T10:00:00.000Z');

function settingsPath(): string {
  return settingsLocalPath(projectDir);
}

function writeSettings(value: unknown): void {
  mkdirSync(join(projectDir, '.claude'), { recursive: true });
  writeFileSync(settingsPath(), typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf8');
}

function readParsed(): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath(), 'utf8'));
}

function dirListing(): string[] {
  const dir = join(projectDir, '.claude');
  return existsSync(dir) ? readdirSync(dir) : [];
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'ship-inbox-settings-'));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe('validation before any write', () => {
  it.each([
    ['empty', ''],
    ['newline smuggling', 'Bash(echo hi)\n"deny": []'],
    ['control char', 'Bash(' + String.fromCharCode(7) + ')'],
    ['leading digit', '1Bash'],
    ['leading paren', '(Bash)'],
    ['overlong', `Bash(${'x'.repeat(600)})`],
  ])('refuses implausible rule (%s) without touching the project', (_name, rule) => {
    writeSettings({ permissions: { allow: ['Read'] } });
    const before = readFileSync(settingsPath(), 'utf8');
    expect(() => applyAlwaysAllowRule({ projectDir, rule, now: NOW })).toThrowError(SettingsWriteError);
    try {
      applyAlwaysAllowRule({ projectDir, rule, now: NOW });
    } catch (err) {
      expect((err as SettingsWriteError).code).toBe('invalid-rule');
    }
    expect(readFileSync(settingsPath(), 'utf8')).toBe(before);
    expect(dirListing()).toEqual(['settings.local.json']);
  });

  it('refuses a missing project directory', () => {
    expect(() =>
      applyAlwaysAllowRule({ projectDir: join(projectDir, 'no-such-dir'), rule: 'WebFetch', now: NOW }),
    ).toThrowError(/project directory/);
  });
});

describe('malformed existing settings = refusal (zero writes, no backup, no tmp)', () => {
  it.each([
    ['invalid JSON', '{ not json !!'],
    ['array root', '[1, 2]'],
    ['permissions not an object', JSON.stringify({ permissions: 'all' })],
    ['allow not an array', JSON.stringify({ permissions: { allow: 'Read' } })],
    ['allow with non-strings', JSON.stringify({ permissions: { allow: ['Read', 42] } })],
  ])('%s', (_name, content) => {
    writeSettings(content);
    let caught: SettingsWriteError | undefined;
    try {
      applyAlwaysAllowRule({ projectDir, rule: 'WebFetch', now: NOW });
    } catch (err) {
      caught = err as SettingsWriteError;
    }
    expect(caught).toBeInstanceOf(SettingsWriteError);
    expect(caught!.code).toBe('malformed-settings');
    // The file is byte-identical and NOTHING else appeared beside it (no backup, no tmp).
    expect(readFileSync(settingsPath(), 'utf8')).toBe(content);
    expect(dirListing()).toEqual(['settings.local.json']);
  });
});

describe('additive-only writes', () => {
  it('creates .claude/settings.local.json from scratch (no backup for a fresh file)', () => {
    const result = applyAlwaysAllowRule({ projectDir, rule: 'Bash(git status:*)', now: NOW });
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeUndefined();
    expect(readParsed()).toEqual({ permissions: { allow: ['Bash(git status:*)'] } });
    expect(dirListing()).toEqual(['settings.local.json']);
  });

  it('appends to an existing allow list, preserving every other rule and key verbatim', () => {
    const existing = {
      $schema: 'https://json.schemastore.org/claude-code-settings.json',
      permissions: {
        allow: ['Read', 'Bash(pnpm test:*)'],
        deny: ['WebSearch'],
        ask: ['Bash(git push:*)'],
        additionalDirectories: ['../docs'],
      },
      env: { FOO: 'bar' },
      unknownFutureKey: { nested: [1, 2, 3] },
    };
    writeSettings(existing);

    const result = applyAlwaysAllowRule({ projectDir, rule: 'WebFetch', now: NOW });
    expect(result.changed).toBe(true);

    const after = readParsed();
    expect(after).toEqual({
      ...existing,
      permissions: { ...existing.permissions, allow: ['Read', 'Bash(pnpm test:*)', 'WebFetch'] },
    });
  });

  it('is idempotent: an already-present rule writes nothing (no backup churn)', () => {
    writeSettings({ permissions: { allow: ['WebFetch'] } });
    const before = readFileSync(settingsPath(), 'utf8');
    const result = applyAlwaysAllowRule({ projectDir, rule: 'WebFetch', now: NOW });
    expect(result.changed).toBe(false);
    expect(readFileSync(settingsPath(), 'utf8')).toBe(before);
    expect(dirListing()).toEqual(['settings.local.json']);
  });
});

describe('backup + atomic replace', () => {
  it('writes a timestamped backup of the ORIGINAL bytes beside the file before replacing', () => {
    const originalText = `{"permissions":{"allow":["Read"]},"commentPreserved":false}`;
    writeSettings(originalText);

    const result = applyAlwaysAllowRule({ projectDir, rule: 'WebFetch', now: NOW });
    expect(result.backupPath).toBe(`${settingsPath()}.bak-20260706T100000000Z`);
    expect(readFileSync(result.backupPath!, 'utf8')).toBe(originalText);
    expect((readParsed().permissions as Record<string, unknown>).allow).toEqual(['Read', 'WebFetch']);
  });

  it('never overwrites an existing backup (same-timestamp writes get a suffix)', () => {
    writeSettings({ permissions: { allow: [] } });
    const first = applyAlwaysAllowRule({ projectDir, rule: 'RuleA', now: NOW });
    const second = applyAlwaysAllowRule({ projectDir, rule: 'RuleB', now: NOW });
    expect(first.backupPath).not.toBe(second.backupPath);
    expect(existsSync(first.backupPath!)).toBe(true);
    expect(existsSync(second.backupPath!)).toBe(true);
    // Both historical states are preserved: [] and [RuleA].
    expect(JSON.parse(readFileSync(second.backupPath!, 'utf8')).permissions.allow).toEqual(['RuleA']);
  });

  it('leaves no tmp file behind on success', () => {
    writeSettings({ permissions: { allow: [] } });
    applyAlwaysAllowRule({ projectDir, rule: 'WebFetch', now: NOW });
    expect(dirListing().filter((f) => f.includes('.tmp-'))).toEqual([]);
  });
});

describe('concurrent modification', () => {
  it('re-merges from the concurrent writer\'s content -- both rules survive', () => {
    writeSettings({ permissions: { allow: ['Read'] } });
    let interleaved = false;
    const result = applyAlwaysAllowRule({
      projectDir,
      rule: 'WebFetch',
      now: NOW,
      onBeforeReplace: () => {
        if (interleaved) return;
        interleaved = true;
        // A concurrent writer lands between our read and our replace.
        writeSettings({ permissions: { allow: ['Read', 'ConcurrentRule'], deny: ['WebSearch'] } });
      },
    });
    expect(result.changed).toBe(true);
    const after = readParsed();
    expect((after.permissions as Record<string, unknown>).allow).toEqual(['Read', 'ConcurrentRule', 'WebFetch']);
    expect((after.permissions as Record<string, unknown>).deny).toEqual(['WebSearch']);
  });

  it('gives up loudly (typed error) when the file never stops changing', () => {
    writeSettings({ permissions: { allow: [] } });
    let n = 0;
    let caught: SettingsWriteError | undefined;
    try {
      applyAlwaysAllowRule({
        projectDir,
        rule: 'WebFetch',
        now: NOW,
        maxAttempts: 3,
        onBeforeReplace: () => {
          n += 1;
          writeSettings({ permissions: { allow: [`Churn${n}`] } });
        },
      });
    } catch (err) {
      caught = err as SettingsWriteError;
    }
    expect(caught?.code).toBe('concurrent-conflict');
    // The last concurrent write is intact -- we never clobbered it with a stale merge.
    expect((readParsed().permissions as Record<string, unknown>).allow).toEqual(['Churn3']);
  });
});
