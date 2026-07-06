import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  configPath,
  initConfig,
  loadConfig,
  loadResumePrompt,
  resolveStateDir,
  resumePromptPath,
} from '../src/config.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'lookout-config-'));
}

describe('resolveStateDir', () => {
  it('defaults to repo-local .ship/lookout (the spec-named signal path)', () => {
    expect(resolveStateDir(undefined, '/repo')).toContain('.ship');
    expect(resolveStateDir(undefined, '/repo').replace(/\\/g, '/')).toContain('/repo/.ship/lookout');
  });

  it('keeps absolute paths as-is', () => {
    const abs = tempDir();
    expect(resolveStateDir(abs, '/elsewhere')).toBe(abs);
  });
});

describe('loadConfig', () => {
  it('yields defaults (sessionId null -> guard refuses) when no config exists', () => {
    const dir = tempDir();
    const config = loadConfig(dir, '/repo');
    expect(config.sessionId).toBeNull();
    expect(config.mode).toBe('pause');
    expect(config.thresholds).toEqual({ alertAt: 80, pauseAt: 93 });
    expect(config.guard).toEqual({
      sensorStaleMinutes: 12,
      tokensAvailableBelowPct: 20,
      idleMinutes: 30,
    });
    expect(config.pollSeconds).toBe(300);
  });

  it('layers file values over defaults, deep-merging thresholds and guard', () => {
    const dir = tempDir();
    writeFileSync(
      configPath(dir),
      JSON.stringify({ sessionId: 'x', mode: 'spend', thresholds: { pauseAt: 90 } }),
    );
    const config = loadConfig(dir, '/repo');
    expect(config.sessionId).toBe('x');
    expect(config.mode).toBe('spend');
    expect(config.thresholds).toEqual({ alertAt: 80, pauseAt: 90 });
    expect(config.guard.idleMinutes).toBe(30);
  });
});

describe('initConfig', () => {
  it('mints a session id, writes config + default resume prompt, prints the pinned launch', () => {
    const dir = tempDir();
    const result = initConfig(dir, { cwd: '/repo', mintUuid: () => 'uuid-1' });
    expect(result.configCreated).toBe(true);
    expect(result.promptCreated).toBe(true);
    expect(result.config.sessionId).toBe('uuid-1');
    expect(result.launchCommand).toBe('claude --session-id uuid-1');
    expect(existsSync(configPath(dir))).toBe(true);
    expect(readFileSync(resumePromptPath(dir), 'utf8')).toContain('Lookout Guard resurrection');
  });

  it('is idempotent: keeps an existing sessionId and never overwrites the prompt', () => {
    const dir = tempDir();
    initConfig(dir, { cwd: '/repo', mintUuid: () => 'uuid-1' });
    writeFileSync(resumePromptPath(dir), 'my custom mission prompt');
    const second = initConfig(dir, { cwd: '/repo', mintUuid: () => 'uuid-2' });
    expect(second.config.sessionId).toBe('uuid-1');
    expect(second.configCreated).toBe(false);
    expect(second.promptCreated).toBe(false);
    expect(readFileSync(resumePromptPath(dir), 'utf8')).toBe('my custom mission prompt');
  });

  it('accepts an explicit --session-id override', () => {
    const dir = tempDir();
    const result = initConfig(dir, { cwd: '/repo', sessionId: 'pinned-id' });
    expect(result.config.sessionId).toBe('pinned-id');
  });
});

describe('loadResumePrompt', () => {
  it('returns null for missing or blank prompts (guard then refuses)', () => {
    const dir = tempDir();
    expect(loadResumePrompt(dir)).toBeNull();
    writeFileSync(resumePromptPath(dir), '   \n');
    expect(loadResumePrompt(dir)).toBeNull();
    writeFileSync(resumePromptPath(dir), 'go\n');
    expect(loadResumePrompt(dir)).toBe('go');
  });
});
