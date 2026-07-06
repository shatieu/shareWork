import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendToSpool,
  appendToUnknownSidecar,
  drainSpool,
  spoolDir,
  spoolPath,
  spoolPending,
  unknownSidecarPath,
} from '../src/spool.js';

let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'ship-log-spool-test-'));
});

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

describe('appendToSpool + drainSpool', () => {
  it('append then drain ingests every line and renames the drained file (never deletes)', async () => {
    appendToSpool({ hook_event_name: 'SessionStart', session_id: 's1' }, fakeHome);
    appendToSpool({ hook_event_name: 'SessionEnd', session_id: 's1' }, fakeHome);
    expect(spoolPending(fakeHome)).toBe(true);

    const ingested: unknown[] = [];
    const result = await drainSpool((envelope) => {
      ingested.push(envelope);
    }, fakeHome);

    expect(result.drained).toBe(2);
    expect(result.malformed).toBe(0);
    expect(ingested).toHaveLength(2);
    expect(existsSync(spoolPath(fakeHome))).toBe(false); // claimed + renamed away
    expect(result.drainedFilePath).toBeTruthy();
    expect(existsSync(result.drainedFilePath!)).toBe(true); // left behind, not removed
    expect(spoolPending(fakeHome)).toBe(false);
  });

  it('drains a stale .draining file left over from a crashed prior drain', async () => {
    const dir = spoolDir(fakeHome);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'events.draining.jsonl'), JSON.stringify({ a: 1 }) + '\n');

    const ingested: unknown[] = [];
    const result = await drainSpool((e) => {
      ingested.push(e);
    }, fakeHome);

    expect(result.drained).toBe(1);
    expect(ingested).toEqual([{ a: 1 }]);
  });

  it('routes a malformed line to the unknown sidecar without crashing the drain', async () => {
    const dir = spoolDir(fakeHome);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'events.jsonl'), 'not-json\n' + JSON.stringify({ ok: true }) + '\n');

    const ingested: unknown[] = [];
    const result = await drainSpool((e) => {
      ingested.push(e);
    }, fakeHome);

    expect(result.malformed).toBe(1);
    expect(result.drained).toBe(1);
    expect(existsSync(unknownSidecarPath(fakeHome))).toBe(true);
  });

  it('an ingest-time failure (e.g. schema mismatch) is treated as malformed, not a crash', async () => {
    appendToSpool({ bad: 'envelope' }, fakeHome);
    const result = await drainSpool(() => {
      throw new Error('schema mismatch');
    }, fakeHome);
    expect(result.malformed).toBe(1);
    expect(result.drained).toBe(0);
  });

  it('a no-op drain when nothing is spooled', async () => {
    const result = await drainSpool(() => {
      throw new Error('should never be called');
    }, fakeHome);
    expect(result).toEqual({ drained: 0, malformed: 0, drainedFilePath: null });
  });
});

describe('appendToUnknownSidecar', () => {
  it('appends raw JSON lines to the sidecar file', () => {
    appendToUnknownSidecar({ x: 1 }, fakeHome);
    appendToUnknownSidecar({ x: 2 }, fakeHome);
    const content = readFileSync(unknownSidecarPath(fakeHome), 'utf8');
    expect(content.trim().split('\n')).toHaveLength(2);
  });
});
