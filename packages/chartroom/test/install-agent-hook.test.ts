import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installAgentHook } from '../src/install-agent-hook.js';

let repoRoot: string;

function scriptPath(): string {
  return join(repoRoot, '.claude', 'hooks', 'chartroom-post-tool-use.mjs');
}

function settingsPath(): string {
  return join(repoRoot, '.claude', 'settings.json');
}

function readSettings(): any {
  return JSON.parse(readFileSync(settingsPath(), 'utf8'));
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-install-agent-hook-test-'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('installAgentHook', () => {
  it('fresh install writes the hook script and a new settings.json with a PostToolUseFailure/Read entry', () => {
    const result = installAgentHook(repoRoot);
    expect(result.status).toBe('installed');

    expect(existsSync(scriptPath())).toBe(true);
    const script = readFileSync(scriptPath(), 'utf8');
    expect(script).toContain('chartroom:managed-post-tool-use-hook');

    const settings = readSettings();
    expect(settings.hooks.PostToolUseFailure).toHaveLength(1);
    expect(settings.hooks.PostToolUseFailure[0].matcher).toBe('Read');
    expect(settings.hooks.PostToolUseFailure[0].hooks[0].command).toContain('chartroom-post-tool-use.mjs');
  });

  it('re-running is idempotent: no duplicate PostToolUseFailure entries on a second run', () => {
    installAgentHook(repoRoot);
    const second = installAgentHook(repoRoot);
    expect(second.status).toBe('already-present');

    const settings = readSettings();
    expect(settings.hooks.PostToolUseFailure).toHaveLength(1);
  });

  it('preserves an existing, unrelated PostToolUseFailure matcher entry -- appends alongside it', () => {
    mkdirSync(join(repoRoot, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath(),
      JSON.stringify({
        hooks: {
          PostToolUseFailure: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'some-other-tool.sh' }] }],
        },
      }),
      'utf8',
    );

    const result = installAgentHook(repoRoot);
    expect(result.status).toBe('installed');

    const settings = readSettings();
    expect(settings.hooks.PostToolUseFailure).toHaveLength(2);
    const foreign = settings.hooks.PostToolUseFailure.find((e: any) => e.matcher === 'Write');
    expect(foreign.hooks[0].command).toBe('some-other-tool.sh');
    const ours = settings.hooks.PostToolUseFailure.find((e: any) => e.matcher === 'Read');
    expect(ours.hooks[0].command).toContain('chartroom-post-tool-use.mjs');
  });

  it('refuses to overwrite a differently-authored file already at the hook script path', () => {
    mkdirSync(join(repoRoot, '.claude', 'hooks'), { recursive: true });
    writeFileSync(scriptPath(), '#!/usr/bin/env node\nconsole.log("not chartroom");\n', 'utf8');

    const result = installAgentHook(repoRoot);
    expect(result.status).toBe('refused');
    if (result.status === 'refused') {
      expect(result.scriptPath).toBe(scriptPath());
    }

    // Untouched, and settings.json was never created.
    expect(readFileSync(scriptPath(), 'utf8')).toContain('not chartroom');
    expect(existsSync(settingsPath())).toBe(false);
  });

  it('refreshing an already-installed hook overwrites the script content (upgrade path)', () => {
    installAgentHook(repoRoot);
    writeFileSync(scriptPath(), '// chartroom:managed-post-tool-use-hook (stale content)\n', 'utf8');

    const result = installAgentHook(repoRoot);
    expect(result.status).toBe('already-present');
    expect(readFileSync(scriptPath(), 'utf8')).not.toContain('stale content');
  });
});
