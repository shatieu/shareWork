#!/usr/bin/env node
// Acceptance: package 03 (Captain's Deck), plan §6.1 -- the acceptance line's automated half:
//
//   "`ship serve` boots the Deck with Chart Room mounted, all Chart Room tests still pass,
//    one port serves everything"
//
// Phase A (real bin, spawned process): scratch home (env-overridden USERPROFILE/HOME) with a
//   registered temp git repo + temp progress.json; spawn the REAL `ship` CLI (dist/cli.js);
//   assert ONE port serves: the Deck UI html, /api/hull/stations (docs tab), /api/repos (stats),
//   a doc, /api/voyage; both discovery files (~/.suite/services.json + ~/.chartroom/daemon.json)
//   registered with that port; mutate progress.json -> /api/voyage reflects it live.
//   Teardown kills by pid (same pattern as chartroom's open-associate-e2e).
//
// Phase B (in-process lifecycle): Windows cannot deliver SIGINT/SIGTERM to another process
//   (process.kill = TerminateProcess, handlers never run), so the graceful-shutdown half --
//   "both discovery files cleared" -- is demonstrated by driving the exact same code path the
//   signal handler runs (`hull.stop()`) in-process over a second scratch home.
//
// The chip half of the acceptance line ("the claude chip opens a real terminal in the right
// repo") is a real-machine manual proof, evidence in the crew report -- a CI script must not
// spawn visible terminals.

import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIP_CLI = join(HERE, '..', 'dist', 'cli.js');
const UI_INDEX = join(HERE, '..', 'dist', 'public', 'index.html');

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

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function waitFor(probe, label, timeoutMs = 15000) {
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

const scratch = [];
function scratchDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function makeScratchWorld(tag) {
  const home = scratchDir(`deck-boot-home-${tag}-`);
  const repo = scratchDir(`deck-boot-repo-${tag}-`);
  mkdirSync(join(repo, '.git'), { recursive: true });
  writeFileSync(join(repo, 'charter.md'), '---\nid: charter\n---\n\n# Charter\n\nThe crew charter.\n', 'utf8');
  mkdirSync(join(home, '.chartroom'), { recursive: true });
  writeFileSync(
    join(home, '.chartroom', 'repos.json'),
    JSON.stringify({ repos: [{ id: 'scratch-repo', absPath: repo, addedAt: new Date().toISOString() }] }, null, 2),
    'utf8',
  );
  const voyage = join(home, 'progress.json');
  writeFileSync(
    voyage,
    JSON.stringify(
      {
        packages: [
          { id: 0, title: 'Charter', status: 'PASS+merged', stage_progress: 100, difficulty: 'S', remaining_guess_h: 0 },
          { id: 3, title: 'Deck', status: 'implementing', stage_progress: 60, difficulty: 'XL', remaining_guess_h: 10 },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
  return { home, repo, voyage };
}

function childEnv(home) {
  return {
    ...process.env,
    USERPROFILE: home, // Windows homedir()
    HOME: home, // POSIX homedir()
  };
}

async function phaseA() {
  console.log('--- Phase A: real `ship serve` bin, one port serves everything ---');
  assert(existsSync(SHIP_CLI), `ship CLI built at ${SHIP_CLI} (run \`pnpm --filter ship build\`)`);
  assert(
    existsSync(UI_INDEX),
    `Deck bundle present at ${UI_INDEX} (run \`pnpm --filter ship build:ui-bundle\` after building chartroom-ui)`,
  );
  if (failures > 0) return;

  const world = makeScratchWorld('a');
  const child = spawn(process.execPath, [SHIP_CLI, 'serve', '--voyage', world.voyage], {
    env: childEnv(world.home),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (c) => {
    stdout += String(c);
  });
  child.stderr.on('data', (c) => {
    stdout += String(c);
  });

  try {
    const port = await waitFor(() => {
      const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout);
      return m ? Number(m[1]) : undefined;
    }, 'ship serve to print its URL');
    console.log(`  ship serve up on port ${port} (pid ${child.pid})`);
    const base = `http://127.0.0.1:${port}`;

    await waitFor(() => getJson(`${base}/api/hull/stations`), 'hull to answer');

    // ONE port serves everything:
    const html = await (await fetch(`${base}/`, { signal: AbortSignal.timeout(3000) })).text();
    assert(html.toLowerCase().includes('<!doctype html'), 'GET / serves the Deck UI html');

    // Package 4 (Bridge phase 1) mounted ship-log, package 5 (Bridge phase 2) ship-ledger (both
    // tab-less); package 6 (Bridge phase 3) mounts ship-inbox (Inbox tab); package 13 (Comm
    // phase 1) mounts ship-voice (tab-less -- its UI is the phone, phases 2-4); package 7
    // mounts settings-manager (Settings tab); package 9 mounts ship-console (Console tab);
    // package 11 mounts skill-analytics (tab-less -- the console renders its JSON);
    // wave2-F mounts ship-comms (tab-less -- agent-to-agent message store).
    const stations = await getJson(`${base}/api/hull/stations`);
    const chartroomStation = stations.find((s) => s.name === 'chartroom');
    const shipLogStation = stations.find((s) => s.name === 'ship-log');
    const shipLedgerStation = stations.find((s) => s.name === 'ship-ledger');
    const shipInboxStation = stations.find((s) => s.name === 'ship-inbox');
    const shipVoiceStation = stations.find((s) => s.name === 'ship-voice');
    const settingsStation = stations.find((s) => s.name === 'settings-manager');
    const consoleStation = stations.find((s) => s.name === 'ship-console');
    const skillAnalyticsStation = stations.find((s) => s.name === 'skill-analytics');
    const shipCommsStation = stations.find((s) => s.name === 'ship-comms');
    assert(
      stations.length === 9 &&
        chartroomStation?.tab?.id === 'docs' &&
        shipLogStation !== undefined && shipLogStation.tab === undefined &&
        shipLedgerStation !== undefined && shipLedgerStation.tab === undefined &&
        shipVoiceStation !== undefined && shipVoiceStation.tab === undefined &&
        skillAnalyticsStation !== undefined && skillAnalyticsStation.tab === undefined &&
        shipCommsStation !== undefined && shipCommsStation.tab === undefined &&
        shipInboxStation?.tab?.id === 'inbox' && shipInboxStation.tab.title === 'Inbox' &&
        settingsStation?.tab?.id === 'settings' && settingsStation.tab.title === 'Settings' &&
        consoleStation?.tab?.id === 'console' && consoleStation.tab.title === 'Console',
      'GET /api/hull/stations lists chartroom (Docs) + tab-less ship-log/ship-ledger/ship-voice/skill-analytics/ship-comms + ship-inbox (Inbox) + settings-manager (Settings) + ship-console (Console)',
    );

    // Agent comms through the hull (wave2-F): send by exact id -> poll returns + marks delivered.
    const commsHdr = { 'content-type': 'application/json', 'x-ship-deck': '1' };
    const commsTo = '99999999-1111-4222-8333-444444444444';
    const sendRes = await fetch(`${base}/api/ship-comms/send`, {
      method: 'POST',
      headers: commsHdr,
      body: JSON.stringify({ from: 'deck-boot', to: commsTo, text: 'acceptance ping' }),
      signal: AbortSignal.timeout(3000),
    });
    assert(sendRes.status === 201, 'POST /api/ship-comms/send by exact id -> 201 through the hull');
    const commsPoll = await (
      await fetch(`${base}/api/ship-comms/poll?session=${commsTo}`, {
        headers: commsHdr,
        signal: AbortSignal.timeout(3000),
      })
    ).json();
    assert(
      commsPoll.messages.length === 1 &&
        commsPoll.messages[0].text === 'acceptance ping' &&
        commsPoll.messages[0].deliveredAt !== null,
      'GET /api/ship-comms/poll returns the queued message and marks it delivered',
    );

    // Skill analytics through the hull (package 11): health answers with the store path.
    const skillHealth = await getJson(`${base}/api/skill-analytics/health`);
    assert(
      skillHealth.ok === true && typeof skillHealth.dbPath === 'string',
      'GET /api/skill-analytics/health answers through the hull',
    );

    // Console overview through the hull -- SHAPE only: the real fleet comes from
    // `claude agents --json` on this machine, so session contents are machine state this
    // script must not assert on (available may honestly be false when claude isn't on PATH).
    // Own 20s budget: the endpoint shells out to `claude agents --json` (15s spawn timeout).
    const consoleRes = await fetch(`${base}/api/ship-console/overview`, { signal: AbortSignal.timeout(20000) });
    assert(consoleRes.ok, 'GET /api/ship-console/overview answers 200 through the hull');
    const consoleOverview = await consoleRes.json();
    assert(
      typeof consoleOverview.available === 'boolean' &&
        Array.isArray(consoleOverview.sessions) &&
        typeof consoleOverview.counts?.total === 'number' &&
        consoleOverview.pending !== null && typeof consoleOverview.pending.permissionsPending === 'number' &&
        'rollup' in consoleOverview,
      'GET /api/ship-console/overview serves the fleet-overview shape with a live inbox badge through the hull',
    );

    const inboxItems = await getJson(`${base}/api/ship-inbox/items`);
    assert(
      Array.isArray(inboxItems.permissions) && Array.isArray(inboxItems.questions) && Array.isArray(inboxItems.docs),
      'GET /api/ship-inbox/items serves the aggregated one-page shape through the hull',
    );

    const repos = await getJson(`${base}/api/repos`);
    assert(
      repos.length === 1 && repos[0].id === 'scratch-repo' && repos[0].docCount === 1,
      'GET /api/repos lists the scratch repo with stats',
    );

    const doc = await getJson(`${base}/api/repos/scratch-repo/docs/charter`);
    assert(doc.doc.title === 'Charter', 'GET a doc through the hull');

    const voyage = await getJson(`${base}/api/voyage`);
    assert(
      voyage.packages.length === 2 && voyage.packages[1].difficulty === 'XL' && voyage.packages[1].source === 'mission',
      'GET /api/voyage serves the parsed progress file',
    );

    // Host guard is live on the real socket. NOTE: undici's fetch() treats Host as a forbidden
    // header and silently drops the override, so this probe must use raw node:http.
    const evilStatus = await new Promise((resolvePromise, rejectPromise) => {
      const req = httpRequest(
        { host: '127.0.0.1', port, path: '/api/repos', headers: { host: 'evil.com' } },
        (res) => {
          res.resume();
          resolvePromise(res.statusCode);
        },
      );
      req.on('error', rejectPromise);
      req.end();
    });
    assert(evilStatus === 403, 'Host: evil.com -> 403 (DNS-rebinding guard)');

    // CSRF guard is live:
    const csrf = await fetch(`${base}/api/repos/scratch-repo/claude-session`, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
    });
    assert(csrf.status === 403, 'claude-session without x-ship-deck -> 403 (CSRF guard)');

    // Discovery files (in the scratch home) both point at this port:
    const services = JSON.parse(readFileSync(join(world.home, '.suite', 'services.json'), 'utf8'));
    assert(
      services.hull?.port === port && services.hull?.stations?.includes('chartroom'),
      '~/.suite/services.json registered with the hull port + stations',
    );
    const daemonJson = JSON.parse(readFileSync(join(world.home, '.chartroom', 'daemon.json'), 'utf8'));
    assert(daemonJson.port === port, '~/.chartroom/daemon.json points chartroom open at the hull');

    // Live voyage: atomic rename-over, then poll until the API reflects it.
    const updated = {
      packages: [
        { id: 0, title: 'Charter', status: 'PASS+merged', stage_progress: 100, difficulty: 'S', remaining_guess_h: 0 },
        { id: 3, title: 'Deck', status: 'implementing', stage_progress: 90, difficulty: 'XL', remaining_guess_h: 2 },
        { id: 4, title: 'Bridge', status: 'pending', stage_progress: 0, difficulty: null, remaining_guess_h: null },
      ],
    };
    const tmp = join(world.home, 'progress.tmp');
    writeFileSync(tmp, JSON.stringify(updated, null, 2), 'utf8');
    renameSync(tmp, world.voyage);
    const live = await waitFor(async () => {
      const v = await getJson(`${base}/api/voyage`);
      return v.packages.length === 3 && v.packages[1].stage_progress === 90 ? v : undefined;
    }, 'voyage API to reflect the renamed-over progress.json');
    assert(live.packages[2].title === 'Bridge', 'voyage live-update reflects the file change');
  } finally {
    try {
      process.kill(child.pid);
      console.log(`  teardown: killed spawned deck pid ${child.pid}`);
    } catch {
      console.log(`  teardown: deck pid ${child.pid} already gone`);
    }
  }
}

async function phaseB() {
  console.log('--- Phase B: graceful-shutdown cleanup (in-process; Windows cannot deliver signals) ---');
  // Drives EXACTLY the code the SIGINT/SIGTERM handler runs (hull.stop()) -- the only difference
  // is the trigger, because process.kill on Windows is TerminateProcess (no handlers).
  const { createHull } = await import('../dist/hull.js');
  const { createChartroomStation } = await import('chartroom/station');

  const world = makeScratchWorld('b');
  const station = createChartroomStation({ homeDir: world.home });
  const hull = await createHull([station], { homeDir: world.home, voyageFile: world.voyage });
  await hull.app.listen({ port: 0, host: '127.0.0.1' });
  const address = hull.app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await hull.start(port);

  assert(
    JSON.parse(readFileSync(join(world.home, '.suite', 'services.json'), 'utf8')).hull?.port === port,
    'services.json written on start',
  );
  assert(
    JSON.parse(readFileSync(join(world.home, '.chartroom', 'daemon.json'), 'utf8')).port === port,
    'daemon.json written on start',
  );

  await hull.stop();
  await hull.app.close();

  const servicesAfter = JSON.parse(readFileSync(join(world.home, '.suite', 'services.json'), 'utf8'));
  assert(servicesAfter.hull === undefined, 'services.json hull entry cleared on stop');
  assert(!existsSync(join(world.home, '.chartroom', 'daemon.json')), 'daemon.json deleted on stop');
}

async function main() {
  try {
    await phaseA();
    await phaseB();
  } finally {
    for (const dir of scratch) {
      // Scratch temp dirs only -- never repo files (REMOVALS.md policy covers repo files).
      rmSync(dir, { recursive: true, force: true });
    }
  }
  if (failures > 0) {
    console.error(`deck-boot: ${failures} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log('deck-boot: all assertions passed');
}

main().catch((err) => {
  console.error(`deck-boot: fatal: ${err.stack ?? err}`);
  process.exit(1);
});
