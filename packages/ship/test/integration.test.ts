import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChartroomStation } from 'chartroom/station';
import { createShipInboxStation } from 'ship-inbox/station';
import { createShipLedgerStation } from 'ship-ledger/station';
import { createShipLogStation } from 'ship-log/station';
import { readServices } from 'suite-conventions';
import { createHull } from '../src/hull.js';

/** chartroom's daemon.json discovery file, read directly (its reader isn't public chartroom API
 * and this test only cares about the on-disk contract `chartroom open` consumes). */
function readDaemonJson(homeDir: string): { port: number; pid: number } | undefined {
  const path = join(homeDir, '.chartroom', 'daemon.json');
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')) as { port: number; pid: number };
}

let home: string;
let repoRoot: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ship-integration-home-'));
  repoRoot = mkdtempSync(join(tmpdir(), 'ship-integration-repo-'));
  mkdirSync(join(repoRoot, '.git'), { recursive: true });
  mkdirSync(join(repoRoot, 'assets'), { recursive: true });
  writeFileSync(join(repoRoot, 'guide.md'), '---\nid: guide\n---\n\n# Guide\n\n![pic](assets/pic.png)\n', 'utf8');
  writeFileSync(join(repoRoot, 'assets', 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  mkdirSync(join(home, '.chartroom'), { recursive: true });
  writeFileSync(
    join(home, '.chartroom', 'repos.json'),
    JSON.stringify({ repos: [{ id: 'repo-a', absPath: repoRoot, addedAt: 't' }] }, null, 2),
    'utf8',
  );
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('hull + real chartroom station over a temp registry (plan 03 §5 integration)', () => {
  it('one injected app serves stations list, repos, a doc, a raw asset, and both discovery files agree', async () => {
    const station = createChartroomStation({ homeDir: home });
    const hull = await createHull([station], { homeDir: home, uiDistDir: join(home, 'no-ui') });
    await hull.start(4321);
    const headers = { host: '127.0.0.1:4321' };

    try {
      const stations = await hull.app.inject({ method: 'GET', url: '/api/hull/stations', headers });
      expect(stations.json()).toEqual([{ name: 'chartroom', tab: { id: 'docs', title: 'Docs' } }]);

      const repos = await hull.app.inject({ method: 'GET', url: '/api/repos', headers });
      expect(repos.statusCode).toBe(200);
      expect(repos.json()[0]).toMatchObject({ id: 'repo-a', docCount: 1 });

      const doc = await hull.app.inject({ method: 'GET', url: '/api/repos/repo-a/docs/guide', headers });
      expect(doc.statusCode).toBe(200);
      expect(doc.json().doc.title).toBe('Guide');

      const raw = await hull.app.inject({ method: 'GET', url: '/api/repos/repo-a/raw/assets/pic.png', headers });
      expect(raw.statusCode).toBe(200);

      // Both discovery files point at the hull's port: chartroom's daemon.json (so `chartroom
      // open` finds the Deck) and the suite's services.json.
      expect(readDaemonJson(home)?.port).toBe(4321);
      expect(readServices(home).hull).toMatchObject({ port: 4321, stations: ['chartroom'] });
    } finally {
      await hull.stop();
      await hull.app.close();
    }

    expect(readDaemonJson(home)).toBeUndefined();
    expect(readServices(home).hull).toBeUndefined();
  });

  it('claude-session rides into the hull: 403 without the deck header, spawn seam reachable with it', async () => {
    // The station factory wires the real spawn; this test only proves the route is mounted and
    // guarded under the hull -- argv-level assertions live in chartroom's own suite.
    const station = createChartroomStation({ homeDir: home });
    const hull = await createHull([station], { homeDir: home, uiDistDir: join(home, 'no-ui') });
    const headers = { host: '127.0.0.1' };

    const noHeader = await hull.app.inject({
      method: 'POST',
      url: '/api/repos/repo-a/claude-session',
      headers,
    });
    expect(noHeader.statusCode).toBe(403);

    const unknownRepo = await hull.app.inject({
      method: 'POST',
      url: '/api/repos/nope/claude-session',
      headers: { ...headers, 'x-ship-deck': '1' },
    });
    expect(unknownRepo.statusCode).toBe(404);

    await hull.app.close();
  });

  it('mirrors a TaskCreated/TaskCompleted pair from ship-log ingest into the ship-ledger station (Bridge phase 2 fan-out)', async () => {
    // The full in-hull path, spec §3: emitter-shaped envelope -> POST /api/ship-log/events ->
    // hookEventConsumer contract -> native-mirror ledger item, readable on the ledger's own API.
    const shipLog = createShipLogStation({ homeDir: home });
    const shipLedger = createShipLedgerStation({ homeDir: home });
    const hull = await createHull([shipLog, shipLedger], {
      homeDir: home,
      uiDistDir: join(home, 'no-ui'),
    });
    const headers = { host: '127.0.0.1', 'x-ship-deck': '1' };

    try {
      const envelope = (event: string, extra: Record<string, unknown>) => ({
        v: 1,
        hook_event_name: event,
        session_id: 'sess-mirror-1',
        cwd: repoRoot,
        emitted_at: new Date().toISOString(),
        payload: { session_id: 'sess-mirror-1', task_id: '1', ...extra },
      });

      const created = await hull.app.inject({
        method: 'POST',
        url: '/api/ship-log/events',
        headers,
        payload: envelope('TaskCreated', { task_subject: 'Native task via hull' }),
      });
      expect(created.statusCode).toBe(202);
      expect(created.json()).toEqual({ queued: false, stored: 'forwarded' });

      const afterCreate = await hull.app.inject({
        method: 'GET',
        url: '/api/ship-ledger/items?source=native-mirror',
        headers,
      });
      expect(afterCreate.json()).toHaveLength(1);
      expect(afterCreate.json()[0]).toMatchObject({
        title: 'Native task via hull',
        status: 'open',
        source: 'native-mirror',
        nativeTaskId: '1',
      });

      const completed = await hull.app.inject({
        method: 'POST',
        url: '/api/ship-log/events',
        headers,
        payload: envelope('TaskCompleted', { task_subject: 'Native task via hull' }),
      });
      expect(completed.statusCode).toBe(202);

      const afterComplete = await hull.app.inject({
        method: 'GET',
        url: '/api/ship-ledger/items?source=native-mirror',
        headers,
      });
      expect(afterComplete.json()).toHaveLength(1);
      expect(afterComplete.json()[0]).toMatchObject({ status: 'done', stageProgress: 100 });
    } finally {
      await hull.stop();
      await hull.app.close();
    }
  });

  it('fans a Notification from ship-log ingest into ship-inbox, and the one page aggregates it with Chart Room items (Bridge phase 3)', async () => {
    // Spec §5's full in-hull path: emitter-shaped Notification envelope -> POST
    // /api/ship-log/events -> hookEventConsumer contract -> agent question on the inbox API --
    // and /api/ship-inbox/items pulls Chart Room's unanswered ask-me via the listInbox contract.
    writeFileSync(
      join(repoRoot, 'q.md'),
      '---\nid: q\n---\n\n# Q\n\n:::ask-me{id="q-1" type="text"}\nWhich port?\n:::\n',
      'utf8',
    );
    const chartroom = createChartroomStation({ homeDir: home });
    const shipLog = createShipLogStation({ homeDir: home });
    const shipInbox = createShipInboxStation({ homeDir: home });
    const hull = await createHull([chartroom, shipLog, shipInbox], {
      homeDir: home,
      uiDistDir: join(home, 'no-ui'),
    });
    const headers = { host: '127.0.0.1', 'x-ship-deck': '1' };

    try {
      const stations = await hull.app.inject({ method: 'GET', url: '/api/hull/stations', headers });
      expect(stations.json()).toContainEqual({
        name: 'ship-inbox',
        tab: { id: 'inbox', title: 'Inbox' },
      });

      const notified = await hull.app.inject({
        method: 'POST',
        url: '/api/ship-log/events',
        headers,
        payload: {
          v: 1,
          hook_event_name: 'Notification',
          session_id: 'sess-inbox-1',
          cwd: repoRoot,
          emitted_at: new Date().toISOString(),
          payload: {
            session_id: 'sess-inbox-1',
            notification_type: 'agent_needs_input',
            message: 'Need the deploy target',
          },
        },
      });
      expect(notified.statusCode).toBe(202);
      expect(notified.json()).toEqual({ queued: false, stored: 'forwarded' });

      const items = await hull.app.inject({ method: 'GET', url: '/api/ship-inbox/items', headers });
      const body = items.json();
      expect(body.questions).toHaveLength(1);
      expect(body.questions[0]).toMatchObject({
        kind: 'agent_needs_input',
        message: 'Need the deploy target',
        sessionId: 'sess-inbox-1',
      });
      expect(body.docs).toHaveLength(1);
      expect(body.docs[0]).toMatchObject({ kind: 'ask-me', label: 'Which port?', docId: 'q' });
      expect(body.permissions).toEqual([]);

      const summary = await hull.app.inject({ method: 'GET', url: '/api/ship-inbox/summary', headers });
      expect(summary.json()).toEqual({ permissionsPending: 0, questionsOpen: 1, docsOpen: 1, total: 2 });
    } finally {
      await hull.stop();
      await hull.app.close();
    }
  });
});
