#!/usr/bin/env node
// Acceptance: package 13 (Comm phase 1), VoiceBridge_Spec §9.1 --
//
//   "ship-voice exposing the §3 toolset over local HTTP; spoken-form rendering tested as text.
//    Acceptance: `fleet_status` returns a paragraph that reads aloud naturally."
//
// Spawns the REAL `ship` CLI (dist/cli.js) over a scratch home, with the deterministic test
// seams active (NODE_ENV=test + SHIP_VOICE_FAKE_FLEET / SHIP_VOICE_FAKE_CONTROL /
// SHIP_VOICE_FAKE_SUMMARIZER -- all refused outside NODE_ENV=test, same discipline as ship-log's
// acceptance): no tokens spent, no real claude spawned, fully repeatable. Then drives every §3
// tool endpoint over real HTTP and asserts the spoken outputs obey the §4 ears-first rules and
// the §3 payload-minimization lock. The live half of the acceptance line (real
// `claude agents --json` through the same code path) is demonstrated in the crew report.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIP_CLI = join(HERE, '..', '..', 'ship', 'dist', 'cli.js');

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(probe, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await probe();
      if (value !== undefined && value !== false) return value;
    } catch {
      /* keep polling */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await sleep(150);
  }
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i;

const FAKE_FLEET = [
  { sessionId: '984deabe-afba-4411-a079-a16be751eac1', name: 'auth token refactor', cwd: 'C:\\repos\\auth-service', kind: 'background', status: 'busy' },
  { sessionId: 'd754cb3d-e33c-493f-bd18-495bced4f7c7', name: 'team tasks rls bug', cwd: 'C:\\repos\\team-tasks', kind: 'background', state: 'blocked' },
  { sessionId: '4226671f-ca22-4753-9ffe-e786ab86b7f5', name: 'changelog polish', cwd: 'C:\\repos\\shareWork', kind: 'background', state: 'done', status: 'idle' },
];

async function main() {
  const home = mkdtempSync(join(tmpdir(), 'voice-accept-home-'));
  mkdirSync(join(home, '.chartroom'), { recursive: true });
  writeFileSync(join(home, '.chartroom', 'repos.json'), JSON.stringify({ repos: [] }), 'utf8');

  const env = {
    ...process.env,
    USERPROFILE: home,
    HOME: home,
    NODE_ENV: 'test',
    SHIP_VOICE_FAKE_FLEET: JSON.stringify(FAKE_FLEET),
    SHIP_VOICE_FAKE_CONTROL: '1',
    SHIP_VOICE_FAKE_SUMMARIZER: '1',
    SHIP_LOG_FAKE_SUMMARIZER: '1',
  };

  const child = spawn(process.execPath, [SHIP_CLI, 'serve', '--port', '4491'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let bootLog = '';
  child.stdout.on('data', (d) => {
    bootLog += String(d);
  });
  child.stderr.on('data', (d) => {
    bootLog += String(d);
  });

  const HDR = { host: '127.0.0.1:4491', 'x-ship-deck': '1', 'content-type': 'application/json' };
  const base = 'http://127.0.0.1:4491';
  const get = async (path) => {
    const res = await fetch(`${base}${path}`, { headers: HDR, signal: AbortSignal.timeout(5000) });
    return { status: res.status, body: await res.json() };
  };
  const post = async (path, payload) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: HDR,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    return { status: res.status, body: await res.json() };
  };

  try {
    await waitFor(async () => (await get('/api/ship-voice/health')).body.ok, 'ship-voice station up');
    assert(/ship-voice/.test(bootLog), 'boot log lists the ship-voice station');

    /* ── the acceptance line: fleet_status paragraph ── */
    const fleet = await get('/api/ship-voice/fleet_status');
    assert(fleet.status === 200, 'fleet_status responds 200');
    const spoken = fleet.body.spoken;
    console.log(`\n  fleet_status speaks:\n  "${spoken}"\n`);
    assert(typeof spoken === 'string' && spoken.length > 40, 'fleet_status returns a paragraph');
    assert(spoken.includes('Two sessions are running.'), 'counts spoken as words');
    assert(spoken.includes('Auth token refactor is working.'), 'sessions named speakably');
    assert(spoken.includes('is blocked waiting on an approval'), 'blocked state reads naturally');
    assert(spoken.includes('One session has finished.'), 'finished sessions mentioned');
    assert(!UUID_RE.test(spoken), 'no ids in anything spoken (§4 names-not-ids)');
    assert(!/[{}[\]"]/.test(spoken), 'no JSON debris in the paragraph');
    assert(/^[A-Z].*\.$/s.test(spoken.trim()), 'reads as prose: starts capitalized, ends with a period');

    /* ── session_status: fuzzy addressing ── */
    const session = await get('/api/ship-voice/session_status?name=the%20auth%20one');
    assert(session.body.resolved === true, 'fuzzy "the auth one" resolves laptop-side (§4)');
    assert(session.body.spoken.includes('Auth token refactor'), 'session_status speaks the name');

    /* ── send_to_session / dispatch (fake control seam -- no spawns) ── */
    const sent = await post('/api/ship-voice/send_to_session', { name: 'team tasks', text: 'Finish the RLS fix first.' });
    assert(sent.status === 200 && sent.body.sent === true, 'send_to_session acks');
    assert(sent.body.spoken === 'Sent to team tasks rls bug.', 'send ack is spoken-form');
    const dispatched = await post('/api/ship-voice/dispatch', { repo: home, task: 'Sweep the docks.' });
    assert(dispatched.status === 200 && dispatched.body.dispatched === true, 'dispatch acks');

    /* ── approve with §6 rails, against the REAL ship-inbox in the same hull ── */
    const created = await post('/api/ship-inbox/permissions', {
      sessionId: FAKE_FLEET[1].sessionId,
      cwd: home,
      toolName: 'Bash',
      toolInput: { command: 'npm publish' },
    });
    assert(created.status === 201, 'seeded a real pending permission via ship-inbox');
    const requestId = created.body.id;

    const statusWithPending = await get('/api/ship-voice/fleet_status');
    assert(
      statusWithPending.body.spoken.includes('One permission request is waiting for you.'),
      'fleet_status folds in the pending permission',
    );
    assert(
      statusWithPending.body.pendingRequests?.[0]?.requestId === requestId,
      'fleet_status metadata carries the requestId for follow-up',
    );

    const readBack = await post('/api/ship-voice/approve', { requestId });
    assert(readBack.body.needsConfirmation === true, 'approve without confirm only reads back (§6)');
    assert(readBack.body.spoken.includes('wants to run `npm publish` — approve?'), 'read-back speaks the command metadata');
    assert(readBack.body.confirmPhrase === 'confirm publish', 'destructive class demands a confirm phrase');

    const bare = await post('/api/ship-voice/approve', { requestId, confirm: true });
    assert(bare.status === 403, 'bare confirm refused for destructive class (§6 never a bare yes)');

    const confirmed = await post('/api/ship-voice/approve', { requestId, confirm: true, confirmPhrase: 'confirm publish' });
    assert(confirmed.status === 200 && confirmed.body.decided === 'allowed', 'exact phrase approves');

    const decision = await get(`/api/ship-inbox/permissions/${requestId}/decision`);
    assert(decision.body.behavior === 'allow', 'decision landed in the real inbox queue');

    const smuggle = await post('/api/ship-voice/approve', { requestId, confirm: true, alwaysAllowRule: 'Bash(x:*)' });
    assert(smuggle.status === 400, 'no always-allow by voice, even as a smuggled key (§6)');

    /* ── deny ── */
    const created2 = await post('/api/ship-inbox/permissions', {
      sessionId: FAKE_FLEET[0].sessionId,
      cwd: home,
      toolName: 'Bash',
      toolInput: { command: 'git push origin main' },
    });
    const denied = await post('/api/ship-voice/deny', { requestId: created2.body.id, message: 'hold off' });
    assert(denied.status === 200 && denied.body.decided === 'denied', 'deny works');

    /* ── ledger round trip ── */
    const added = await post('/api/ship-voice/ledger_add', { title: 'Park the changelog idea', project: 'shareWork' });
    assert(added.status === 200 && added.body.added === true, 'ledger_add lands in the real ledger');
    const ledger = await get('/api/ship-voice/ledger_status');
    assert(ledger.body.spoken.includes('One ledger item.'), 'ledger_status speaks the item back');

    /* ── whats_new ── */
    const news = await get('/api/ship-voice/whats_new');
    assert(news.status === 200 && typeof news.body.spoken === 'string', 'whats_new speaks');
    assert(news.body.spoken.includes('Nothing new in the log today yet.'), 'empty log day reads naturally');
  } finally {
    child.kill();
    await sleep(300);
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* scratch dir may be briefly locked on Windows */
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} acceptance check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll Comm phase-1 text-mode acceptance checks passed.');
}

main().catch((err) => {
  console.error(`acceptance run crashed: ${err.message}`);
  process.exit(1);
});
