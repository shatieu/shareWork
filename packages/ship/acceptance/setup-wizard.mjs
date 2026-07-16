#!/usr/bin/env node
// Acceptance: Deck onboarding wizard, API level (plan deck-onboarding-wizard.md §API 1-3).
//
//   "The Deck's setup wizard audits any registered repo's ship-framework setup, applies the
//    selected auto items idempotently, and the folder picker browses real directories."
//
// The wizard is a pure client over `GET /api/fs/list`, `GET/POST /api/repos/:id/setup` (and
// `POST .../setup/run`, which opens a real terminal -- deliberately NOT exercised here; it is
// covered by chartroom's route tests through the SpawnLike seam). This script spawns the REAL
// `ship` CLI over a scratch home and replays the wizard's fetch sequence against the live socket:
//
//   1. boot a hull on a free port (never the live Deck's 4317 -- port-walk handles collisions),
//      live-register a scratch repo through the modal's POST.
//   2. folder picker: GET /api/fs/list roots view, then the scratch repo's parent -- the repo
//      shows up as a directory entry with isGitRepo: true.
//   3. wizard phase 1: GET .../setup audits the full 12-item checklist, auto items missing,
//      human items carrying server-generated command strings.
//   4. wizard phase 2: POST .../setup applies an auto subset -> every result ok, files really
//      appear in the repo; re-audit shows those items present.
//   5. idempotency: the same POST again -> all ok, .gitignore byte-identical (no duplicates).
//   6. negatives: human id in apply -> 400; missing x-ship-deck header -> 403 on both GETs.
//
// Teardown kills the spawned hull by pid and removes only this script's scratch directories.
// Prerequisite: `pnpm --filter ship build` + `build:ui-bundle` (dist/cli.js + dist/public).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIP_CLI = join(HERE, '..', 'dist', 'cli.js');
const UI_INDEX = join(HERE, '..', 'dist', 'public', 'index.html');

const AUTO_SUBSET = ['chartroomignore', 'gitignore-entries', 'ship-scrutiny', 'lookout-init'];
const ALL_ITEM_IDS = [
  'chartroom-init',
  'chartroom-skill',
  'agent-hook',
  'chartroomignore',
  'claude-md-section',
  'gitignore-entries',
  'ship-scrutiny',
  'lookout-init',
  'plugin-marketplace-add',
  'plugin-install',
  'mcp-ship-ledger',
  'mcp-ship-log',
];

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

/** The wizard's fetches, byte-for-byte: x-ship-deck on every call (all four routes are guarded). */
function deckFetch(url, { method = 'GET', body, omitDeckHeader = false } = {}) {
  const headers = {};
  if (!omitDeckHeader) headers['x-ship-deck'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
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

async function main() {
  assert(existsSync(SHIP_CLI), `ship CLI built at ${SHIP_CLI} (run \`pnpm --filter ship build\`)`);
  assert(existsSync(UI_INDEX), `Deck bundle present at ${UI_INDEX} (run \`pnpm --filter ship build:ui-bundle\`)`);
  if (failures > 0) {
    process.exit(1);
  }

  const home = scratchDir('setup-wizard-home-');
  const repo = scratchDir('setup-wizard-repo-');
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(repo, 'docs'), { recursive: true });
  writeFileSync(join(repo, 'docs', 'guide.md'), '---\nid: guide-doc\n---\n\n# Guide\n', 'utf8');

  mkdirSync(join(home, '.chartroom'), { recursive: true });
  writeFileSync(join(home, '.chartroom', 'repos.json'), JSON.stringify({ repos: [] }, null, 2), 'utf8');

  // A live Deck may own 4317 in this session -- start the walk well away from it and NEVER touch
  // the running instance; we only ever kill the child we spawned.
  const child = spawn(process.execPath, [SHIP_CLI, 'serve', '--port', '4517'], {
    env: { ...process.env, USERPROFILE: home, HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (c) => (stdout += String(c)));
  child.stderr.on('data', (c) => (stdout += String(c)));

  try {
    const port = await waitFor(() => {
      const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout);
      return m ? Number(m[1]) : undefined;
    }, 'ship serve to print its URL');
    const base = `http://127.0.0.1:${port}`;
    console.log(`  hull up on port ${port} (pid ${child.pid})`);
    await waitFor(() => deckFetch(`${base}/api/repos`).then((r) => r.ok), 'repos API to answer');

    // 1. Live-register the scratch repo (the wizard is reachable for registered repos).
    const registered = await (
      await deckFetch(`${base}/api/repos/register`, { method: 'POST', body: { path: repo } })
    ).json();
    assert(typeof registered.id === 'string' && registered.alreadyRegistered === false, 'scratch repo registered live');
    const repoId = encodeURIComponent(registered.id);

    // 2. Folder picker: roots view, then the repo's parent directory.
    const rootsRes = await deckFetch(`${base}/api/fs/list`);
    const roots = await rootsRes.json();
    assert(
      rootsRes.ok && roots.path === null && roots.parent === null && Array.isArray(roots.entries) &&
        roots.entries.length > 0,
      'GET /api/fs/list (no path) serves the roots view',
    );
    const parentDir = dirname(repo);
    const listing = await (await deckFetch(`${base}/api/fs/list?path=${encodeURIComponent(parentDir)}`)).json();
    const repoEntry = (listing.entries ?? []).find((e) => e.path === repo);
    assert(
      listing.path === parentDir && repoEntry !== undefined && repoEntry.isGitRepo === true,
      'the scratch repo appears in its parent listing with isGitRepo: true',
    );

    // 3. Wizard phase 1: the audit. Full checklist, auto subset missing, human commands present.
    const audit1 = await (await deckFetch(`${base}/api/repos/${repoId}/setup`)).json();
    assert(
      audit1.repoId === registered.id &&
        Array.isArray(audit1.items) &&
        JSON.stringify(audit1.items.map((i) => i.id)) === JSON.stringify(ALL_ITEM_IDS),
      'GET setup audits the canonical 12-item checklist in order',
    );
    assert(
      AUTO_SUBSET.every((id) => audit1.items.find((i) => i.id === id)?.state === 'missing'),
      'fresh repo: the auto subset audits as missing',
    );
    assert(
      audit1.items
        .filter((i) => i.kind === 'human')
        .every((i) => typeof i.command === 'string' && i.command.startsWith('claude ')),
      'human items carry server-generated `claude ...` command strings',
    );

    // 4. Wizard phase 2: apply the auto subset; files really land in the repo.
    const applied = await (
      await deckFetch(`${base}/api/repos/${repoId}/setup`, { method: 'POST', body: { apply: AUTO_SUBSET } })
    ).json();
    assert(
      Array.isArray(applied.results) &&
        applied.results.length === AUTO_SUBSET.length &&
        applied.results.every((r) => r.ok === true),
      `POST setup applies ${AUTO_SUBSET.join(', ')} -> every result ok`,
    );
    assert(existsSync(join(repo, '.chartroomignore')), '.chartroomignore was written');
    assert(
      readFileSync(join(repo, '.gitignore'), 'utf8').includes('.ship-crew/'),
      '.gitignore carries the ship entries',
    );
    assert(existsSync(join(repo, '.ship', 'lookout', 'config.json')), 'lookout state was initialized');

    const audit2 = await (await deckFetch(`${base}/api/repos/${repoId}/setup`)).json();
    assert(
      AUTO_SUBSET.every((id) => audit2.items.find((i) => i.id === id)?.state === 'present'),
      're-audit shows the applied items present',
    );

    // 5. Idempotency: the same apply again -> all ok, no duplicate gitignore lines.
    const gitignoreBefore = readFileSync(join(repo, '.gitignore'), 'utf8');
    const reapplied = await (
      await deckFetch(`${base}/api/repos/${repoId}/setup`, { method: 'POST', body: { apply: AUTO_SUBSET } })
    ).json();
    assert(reapplied.results.every((r) => r.ok === true), 'second apply is all-ok (idempotent)');
    assert(readFileSync(join(repo, '.gitignore'), 'utf8') === gitignoreBefore, '.gitignore is byte-identical after re-apply');

    // 6. Negatives.
    const humanApply = await deckFetch(`${base}/api/repos/${repoId}/setup`, {
      method: 'POST',
      body: { apply: ['plugin-install'] },
    });
    const humanBody = await humanApply.json().catch(() => ({}));
    assert(
      humanApply.status === 400 && typeof humanBody.error === 'string',
      `human item id in apply -> 400 with readable error ("${humanBody.error ?? ''}")`,
    );
    const noHeaderAudit = await deckFetch(`${base}/api/repos/${repoId}/setup`, { omitDeckHeader: true });
    assert(noHeaderAudit.status === 403, 'GET setup without x-ship-deck -> 403 (CSRF guard)');
    const noHeaderFs = await deckFetch(`${base}/api/fs/list`, { omitDeckHeader: true });
    assert(noHeaderFs.status === 403, 'GET /api/fs/list without x-ship-deck -> 403 (CSRF guard)');
  } finally {
    const exited = new Promise((resolvePromise) => child.once('exit', resolvePromise));
    try {
      process.kill(child.pid);
      console.log(`  teardown: killed spawned hull pid ${child.pid}`);
    } catch {
      console.log(`  teardown: hull pid ${child.pid} already gone`);
    }
    // Wait for the child to release its scratch-home handles before rmSync (Windows EPERM race).
    await Promise.race([exited, sleep(5000)]);
    for (const dir of scratch) {
      try {
        // Scratch temp dirs only -- never repo files.
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch (err) {
        console.log(`  teardown: could not remove scratch ${dir} (${err.code ?? err.message})`);
      }
    }
  }

  if (failures > 0) {
    console.error(`setup-wizard: ${failures} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log('setup-wizard: all assertions passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
