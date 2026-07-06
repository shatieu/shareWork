import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openShipLogDb, getSession } from '../src/db.js';
import { createCaptureContext } from '../src/capture.js';
import { ingestEnvelope } from '../src/ingest.js';
import { unknownSidecarPath } from '../src/spool.js';
import type { Summarizer } from '../src/summarize.js';

let fakeHome: string;
let db: Database.Database;

const fakeSummarizer: Summarizer = async () => ({ text: 'ok', model: 'fake' });

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'ship-log-ingest-test-'));
  db = openShipLogDb(fakeHome);
});

afterEach(() => {
  db.close();
  rmSync(fakeHome, { recursive: true, force: true });
});

describe('ingestEnvelope', () => {
  it('routes a valid SessionStart envelope to capture.ts', async () => {
    const ctx = createCaptureContext(db, fakeSummarizer);
    const result = await ingestEnvelope(
      ctx,
      {
        v: 1,
        hook_event_name: 'SessionStart',
        session_id: 'sess-1',
        cwd: process.cwd(),
        emitted_at: new Date().toISOString(),
        payload: { source: 'startup' },
      },
      fakeHome,
    );
    expect(result.stored).toBe('captured');
    expect(getSession(db, 'sess-1')).toBeTruthy();
  });

  it('stores an unrecognized event name in the unknown sidecar instead of rejecting it', async () => {
    const ctx = createCaptureContext(db, fakeSummarizer);
    const result = await ingestEnvelope(
      ctx,
      {
        v: 1,
        hook_event_name: 'Notification',
        session_id: 'sess-2',
        cwd: process.cwd(),
        emitted_at: new Date().toISOString(),
        payload: { kind: 'agent_needs_input' },
      },
      fakeHome,
    );
    expect(result.stored).toBe('unknown');
    expect(existsSync(unknownSidecarPath(fakeHome))).toBe(true);
    expect(readFileSync(unknownSidecarPath(fakeHome), 'utf8')).toContain('Notification');
  });

  it('throws on a genuinely malformed envelope (missing required fields)', async () => {
    const ctx = createCaptureContext(db, fakeSummarizer);
    await expect(
      ingestEnvelope(ctx, { hook_event_name: 'SessionStart' }, fakeHome),
    ).rejects.toThrow();
  });
});
