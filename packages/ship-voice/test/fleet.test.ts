import type { SpawnSyncReturns } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  createClaudeFleetSource,
  fakeControlSeamActive,
  fakeFleetSeamActive,
  resolveClaudeBinary,
  resolveSessionName,
  type FleetSession,
  type VoiceSpawnSync,
} from '../src/fleet.js';

function spawnResult(overrides: Partial<SpawnSyncReturns<string>>): SpawnSyncReturns<string> {
  return {
    pid: 1,
    output: [],
    stdout: '',
    stderr: '',
    status: 0,
    signal: null,
    ...overrides,
  } as SpawnSyncReturns<string>;
}

const AGENTS_JSON = JSON.stringify([
  { id: 'abc', sessionId: 's-1', name: 'auth work', cwd: 'C:\\r\\auth', kind: 'background', state: 'blocked' },
  { sessionId: 's-2', name: 'docs pass', cwd: '/r/docs', kind: 'interactive', status: 'busy' },
  'not-a-session',
  { name: 'missing sessionId' },
]);

describe('createClaudeFleetSource (verified `claude agents --json` shape)', () => {
  it('parses the array and keeps only well-formed sessions', async () => {
    let seenArgs: string[] = [];
    const spawn: VoiceSpawnSync = (_cmd, args) => {
      seenArgs = args;
      return spawnResult({ stdout: AGENTS_JSON });
    };
    const sessions = await createClaudeFleetSource(spawn).list();
    expect(seenArgs).toEqual(['agents', '--json']);
    expect(sessions).toHaveLength(2);
    expect(sessions?.[0].sessionId).toBe('s-1');
  });

  it('returns null on non-zero exit, spawn error, or unparsable output -- never throws', async () => {
    const cases: VoiceSpawnSync[] = [
      () => spawnResult({ status: 1, stdout: '[]' }),
      () => spawnResult({ error: new Error('ENOENT') }),
      () => spawnResult({ stdout: 'not json' }),
      () => spawnResult({ stdout: '{"an":"object"}' }),
      () => spawnResult({ stdout: '' }),
    ];
    for (const spawn of cases) {
      expect(await createClaudeFleetSource(spawn).list()).toBeNull();
    }
  });
});

describe('resolveClaudeBinary', () => {
  it('honors the env override', () => {
    expect(resolveClaudeBinary({ SHIP_VOICE_CLAUDE_PATH: 'X:/claude.exe' }, 'win32')).toBe('X:/claude.exe');
  });
  it('plain name on non-Windows', () => {
    expect(resolveClaudeBinary({}, 'linux')).toBe('claude');
  });
});

describe('test seams are refused outside NODE_ENV=test (ship-log discipline)', () => {
  it('fake fleet requires NODE_ENV=test', () => {
    expect(fakeFleetSeamActive({ SHIP_VOICE_FAKE_FLEET: '[]', NODE_ENV: 'test' })).toBe(true);
    expect(fakeFleetSeamActive({ SHIP_VOICE_FAKE_FLEET: '[]', NODE_ENV: 'production' })).toBe(false);
    expect(fakeFleetSeamActive({ SHIP_VOICE_FAKE_FLEET: '[]' })).toBe(false);
    expect(fakeFleetSeamActive({ NODE_ENV: 'test' })).toBe(false);
  });
  it('fake control requires NODE_ENV=test', () => {
    expect(fakeControlSeamActive({ SHIP_VOICE_FAKE_CONTROL: '1', NODE_ENV: 'test' })).toBe(true);
    expect(fakeControlSeamActive({ SHIP_VOICE_FAKE_CONTROL: '1' })).toBe(false);
  });
});

describe('resolveSessionName (§4 fuzzy addressing, laptop-side)', () => {
  const fleet: FleetSession[] = [
    { sessionId: 's-1', name: 'auth token refactor', cwd: 'C:\\repos\\auth-service' },
    { sessionId: 's-2', name: 'team tasks rls bug', cwd: 'C:\\repos\\team-tasks' },
    { sessionId: 's-3', name: 'auth login fix', cwd: 'C:\\repos\\auth-service' },
    { sessionId: 's-4', cwd: '/home/o/harbor' },
  ];

  it('resolves "the auth token one" to the unique best match', () => {
    const { match } = resolveSessionName('the auth token one', fleet);
    expect(match?.sessionId).toBe('s-1');
  });

  it('matches on the repo folder when the session has no name', () => {
    const { match } = resolveSessionName('harbor', fleet);
    expect(match?.sessionId).toBe('s-4');
  });

  it('surfaces ties as candidates for spoken disambiguation', () => {
    const { match, candidates } = resolveSessionName('auth', fleet);
    expect(match).toBeUndefined();
    expect(candidates.map((c) => c.sessionId).sort()).toEqual(['s-1', 's-3']);
  });

  it('no match for unrelated or empty queries', () => {
    expect(resolveSessionName('kubernetes', fleet)).toEqual({ candidates: [] });
    expect(resolveSessionName('  ', fleet)).toEqual({ candidates: [] });
  });

  it('ids never participate in matching (§4 names not ids)', () => {
    expect(resolveSessionName('s-2', fleet).match).toBeUndefined();
  });
});
