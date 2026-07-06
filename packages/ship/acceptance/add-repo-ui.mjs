#!/usr/bin/env node
// Acceptance: package 15 (Add repo + repos-overview landing).
//
//   "The Deck's Add-repo modal registers a local git repo with the running hull and the repo
//    appears in Docs immediately; the bare route's overview renders every tracked repo."
//
// The modal is a pure client over TWO endpoints -- `POST /api/repos/register` (submit) and
// `GET /api/repos` (the overview's card data + the shell's refresh after success). This script
// spawns the REAL `ship` CLI over a scratch home and replays the modal's EXACT fetches
// (method, headers, body -- see chartroom-ui/src/api/client.ts registerRepoRequest) against the
// live socket, then asserts what the overview and the tree render is really in the payload:
//
//   1. boot: one pre-registered scratch repo -> GET /api/repos lists it; GET / serves the Deck.
//   2. register a SECOND scratch repo through the modal's fetch, addressed by a NESTED folder
//      -- the daemon must resolve the git root itself (the modal never browses the filesystem).
//   3. the new repo appears in GET /api/repos with stats and its doc is served immediately
//      (live registration: no restart).
//   4. re-registering is a readable no-op (`alreadyRegistered: true`).
//   5. a non-repo path -> 400 with a readable `{error}` body (what the modal shows as role=alert).
//   6. the CSRF guard holds: the same POST without `x-ship-deck` -> 403.
//
// Teardown kills the spawned hull by pid and removes only this script's scratch directories.
// Prerequisite: `pnpm --filter ship build` + `build:ui-bundle` (dist/cli.js + dist/public).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

/** The modal's submit, byte-for-byte (chartroom-ui client.ts registerRepoRequest). */
function modalRegisterFetch(base, path, { omitDeckHeader = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (!omitDeckHeader) headers['x-ship-deck'] = '1';
  return fetch(`${base}/api/repos/register`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path }),
    signal: AbortSignal.timeout(10000),
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

function makeScratchRepo(tag, docName, docId, title) {
  const repo = scratchDir(`add-repo-ui-${tag}-`);
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(repo, 'docs'), { recursive: true });
  writeFileSync(join(repo, 'docs', docName), `---\nid: ${docId}\n---\n\n# ${title}\n`, 'utf8');
  return repo;
}

async function main() {
  assert(existsSync(SHIP_CLI), `ship CLI built at ${SHIP_CLI} (run \`pnpm --filter ship build\`)`);
  assert(existsSync(UI_INDEX), `Deck bundle present at ${UI_INDEX} (run \`pnpm --filter ship build:ui-bundle\`)`);
  if (failures > 0) {
    process.exit(1);
  }

  const home = scratchDir('add-repo-ui-home-');
  const repoOne = makeScratchRepo('repo1', 'alpha.md', 'alpha-doc', 'Alpha');
  const repoTwo = makeScratchRepo('repo2', 'beta.md', 'beta-doc', 'Beta');
  const notARepo = scratchDir('add-repo-ui-notrepo-'); // no .git anywhere under tmp scratch

  mkdirSync(join(home, '.chartroom'), { recursive: true });
  writeFileSync(
    join(home, '.chartroom', 'repos.json'),
    JSON.stringify({ repos: [{ id: 'repo-one', absPath: repoOne, addedAt: new Date().toISOString() }] }, null, 2),
    'utf8',
  );

  const child = spawn(process.execPath, [SHIP_CLI, 'serve'], {
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
    await waitFor(() => getJson(`${base}/api/repos`), 'repos API to answer');

    // 1. The overview's data source before: exactly the boot-registered repo, with card stats.
    const before = await getJson(`${base}/api/repos`);
    assert(
      before.length === 1 && before[0].id === 'repo-one' && before[0].docCount === 1 &&
        typeof before[0].absPath === 'string' && typeof before[0].brokenLinkCount === 'number' &&
        typeof before[0].needsYouCount === 'number',
      'GET /api/repos serves the overview card data (name/path/docCount/badge counts) for the boot repo',
    );
    const html = await (await fetch(`${base}/`, { signal: AbortSignal.timeout(3000) })).text();
    assert(html.toLowerCase().includes('<!doctype html'), 'GET / (the overview landing route) serves the Deck UI');

    // 2. The modal's exact submit, addressed by a NESTED path -- server resolves the git root.
    const nested = join(repoTwo, 'docs');
    const registerRes = await modalRegisterFetch(base, nested);
    assert(registerRes.ok, `modal POST /api/repos/register (nested path) -> ${registerRes.status}`);
    const registered = await registerRes.json();
    assert(
      registered.absPath === repoTwo && registered.alreadyRegistered === false &&
        typeof registered.id === 'string' && typeof registered.name === 'string',
      'registration resolved the nested path to the repo git root and reports a fresh registration',
    );

    // 3. Appears everywhere immediately: /api/repos (overview + tree) and the doc itself.
    const after = await getJson(`${base}/api/repos`);
    const newEntry = after.find((r) => r.id === registered.id);
    assert(after.length === 2 && newEntry !== undefined, 'GET /api/repos now lists both repos (overview refresh)');
    assert(newEntry !== undefined && newEntry.docCount === 1, 'the new repo card carries its doc count');
    const doc = await getJson(`${base}/api/repos/${encodeURIComponent(registered.id)}/docs/beta-doc`);
    assert(doc.doc.title === 'Beta', 'the new repo serves its doc immediately (live registration, no restart)');

    // 4. Idempotent re-registration -- the modal's "Already registered" pane.
    const again = await (await modalRegisterFetch(base, repoTwo)).json();
    assert(again.alreadyRegistered === true && again.id === registered.id, 're-registering is a readable no-op');

    // 5. The modal's error path: non-repo path -> 400 with a readable {error} body.
    const badRes = await modalRegisterFetch(base, notARepo);
    const badBody = await badRes.json().catch(() => ({}));
    assert(
      badRes.status === 400 && typeof badBody.error === 'string' && badBody.error.length > 0,
      `non-repo path -> 400 with readable error ("${badBody.error ?? ''}")`,
    );
    const stillTwo = await getJson(`${base}/api/repos`);
    assert(stillTwo.length === 2, 'the failed registration registered nothing');

    // 6. CSRF guard: the same POST without the x-ship-deck header is refused.
    const csrfRes = await modalRegisterFetch(base, repoTwo, { omitDeckHeader: true });
    assert(csrfRes.status === 403, 'POST /api/repos/register without x-ship-deck -> 403 (CSRF guard)');
  } finally {
    const exited = new Promise((resolvePromise) => child.once('exit', resolvePromise));
    try {
      process.kill(child.pid);
      console.log(`  teardown: killed spawned hull pid ${child.pid}`);
    } catch {
      console.log(`  teardown: hull pid ${child.pid} already gone`);
    }
    // Wait for the child to actually release its handles (repos.json/daemon.json under the
    // scratch home) -- on Windows an immediate rmSync races TerminateProcess and EPERMs.
    await Promise.race([exited, sleep(5000)]);
    for (const dir of scratch) {
      try {
        // Scratch temp dirs only -- never repo files (REMOVALS.md policy covers repo files).
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch (err) {
        // Leftover tmp scratch is harmless; never fail the acceptance on cleanup.
        console.log(`  teardown: could not remove scratch ${dir} (${err.code ?? err.message})`);
      }
    }
  }

  if (failures > 0) {
    console.error(`add-repo-ui: ${failures} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log('add-repo-ui: all assertions passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
