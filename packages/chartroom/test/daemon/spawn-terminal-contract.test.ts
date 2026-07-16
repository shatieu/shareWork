import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnTerminal, type SpawnLike, type SpawnTerminalContract } from '../../src/daemon/routes/claude-session.js';
import { createChartroomStation } from '../../src/station.js';

/** The fixed argv the hull's Chapel tab passes through the contract (deck-chapel-tab plan). */
const CHAPLAIN_ARGV = ['claude', '--agent', 'ship-crew:chaplain'];

interface SpawnCall {
  command: string;
  args: string[];
  options: { detached: boolean; stdio: string; env: NodeJS.ProcessEnv; cwd?: string };
}

function recordingSpawner(calls: SpawnCall[], onUnref?: () => void): SpawnLike {
  return (command, args, options) => {
    calls.push({ command, args, options: options as SpawnCall['options'] });
    return { unref: () => onUnref?.() };
  };
}

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'chartroom-spawn-terminal-test-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('spawnTerminal (the spawnTerminal station contract, deck-chapel-tab plan)', () => {
  it('win32 + wt: same researcher-R1 argv shape as the claude-session route, argv appended to cmd /k', () => {
    const calls: SpawnCall[] = [];
    let unrefed = false;
    spawnTerminal(
      { argv: CHAPLAIN_ARGV, cwd, title: 'Chaplain' },
      {
        spawner: recordingSpawner(calls, () => {
          unrefed = true;
        }),
        platform: 'win32',
        hasWindowsTerminal: () => true,
        baseEnv: { PATH: 'keep-me', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's' },
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('wt.exe');
    expect(calls[0].args).toEqual(['-w', 'new', '-d', cwd, 'cmd', '/k', 'claude', '--agent', 'ship-crew:chaplain']);
    expect(calls[0].options.detached).toBe(true);
    expect(calls[0].options.stdio).toBe('ignore');
    // Claude env hygiene runs on the contract path too (researcher R2 list, no second copy).
    expect(calls[0].options.env.PATH).toBe('keep-me');
    expect(calls[0].options.env.CLAUDECODE).toBeUndefined();
    expect(calls[0].options.env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
    expect(unrefed).toBe(true);
  });

  it('win32 without wt: cmd /c start with the request title (default argv[0]) and spawn cwd', () => {
    const calls: SpawnCall[] = [];
    spawnTerminal(
      { argv: CHAPLAIN_ARGV, cwd, title: 'Chaplain' },
      { spawner: recordingSpawner(calls), platform: 'win32', hasWindowsTerminal: () => false },
    );
    expect(calls[0].command).toBe('cmd');
    expect(calls[0].args).toEqual(['/c', 'start', 'Chaplain', 'cmd', '/k', 'claude', '--agent', 'ship-crew:chaplain']);
    expect(calls[0].options.cwd).toBe(cwd);

    // Title omitted -> argv[0] stands in (the `start` title slot must never be empty).
    const untitled: SpawnCall[] = [];
    spawnTerminal(
      { argv: CHAPLAIN_ARGV, cwd },
      { spawner: recordingSpawner(untitled), platform: 'win32', hasWindowsTerminal: () => false },
    );
    expect(untitled[0].args[2]).toBe('claude');
  });

  it('linux: cd-and-exec shell line carries the full argv', () => {
    const calls: SpawnCall[] = [];
    spawnTerminal({ argv: CHAPLAIN_ARGV, cwd }, { spawner: recordingSpawner(calls), platform: 'linux' });
    expect(calls[0].command).toBe('x-terminal-emulator');
    expect(calls[0].args[1]).toContain('exec claude --agent ship-crew:chaplain');
  });

  it('empty argv is a synchronous error, nothing spawned', () => {
    const calls: SpawnCall[] = [];
    expect(() =>
      spawnTerminal({ argv: [], cwd }, { spawner: recordingSpawner(calls), platform: 'win32' }),
    ).toThrow(/argv must be non-empty/);
    expect(calls).toHaveLength(0);
  });
});

describe('chartroom station contracts map', () => {
  it("offers 'spawnTerminal' so the hull's getContract('chartroom','spawnTerminal') resolves", () => {
    const home = mkdtempSync(join(tmpdir(), 'chartroom-station-contract-home-'));
    try {
      const station = createChartroomStation({ homeDir: home });
      const contract = station.contracts?.spawnTerminal as SpawnTerminalContract | undefined;
      expect(typeof contract).toBe('function');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
