#!/usr/bin/env node
// v1.1 acceptance script (plan §6 d+e, non-registry half): proves `chartroom open <file>` against
// REAL spawned daemons with a fully isolated fake home (USERPROFILE + HOME overridden per
// researcher R5 -- Node's os.homedir() honors them), so the real ~/.chartroom is never touched.
//
//   Scenario 1 -- cold start: never-registered scratch repo, NO daemon running.
//     `chartroom open <file> --print-url` must: register the repo, spawn a background daemon,
//     write ~/.chartroom/daemon.json, and print a key-addressed doc URL whose API twin
//     (GET /api/repos/:id/docs/:key) serves exactly that doc.
//   Scenario 2 -- warm daemon: a SECOND never-registered scratch repo while that daemon is
//     still running. `open --print-url` must live-register it (POST /api/repos/register under
//     the hood) and the SAME daemon (same port, same pid, no restart) must serve the new doc.
//
// The registry (`chartroom associate`) half of the acceptance line is unit/integration-tested
// separately (test/associate.test.ts, test/associate-registry.win32.test.ts) and demonstrated
// once for real on the Captain's machine -- this script stays registry-free so it can run in any
// sandbox and in CI.
//
// Teardown kills the spawned daemon by pid (process kill, not file deletion) and removes only
// this script's own scratch directories.
//
// Prerequisite: `npm run build` in packages/chartroom (dist/cli.js present).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_JS = join(HERE, '..', 'dist', 'cli.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function initScratchRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'acceptance@chartroom.test']);
  git(dir, ['config', 'user.name', 'Chart Room Acceptance']);
  return dir;
}

/** Runs the real CLI with the isolated fake home (R5: set BOTH vars, in the child env). */
function chartroom(fakeHome, cwd, args) {
  const result = spawnSync(process.execPath, [CLI_JS, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, USERPROFILE: fakeHome, HOME: fakeHome },
    timeout: 60_000,
  });
  return result;
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  assert(response.ok, `GET ${url} -> ${response.status}`);
  return response.json();
}

async function main() {
  assert(existsSync(CLI_JS), `build first: ${CLI_JS} missing`);

  const fakeHome = mkdtempSync(join(tmpdir(), 'chartroom-open-e2e-home-'));
  const repoOne = initScratchRepo('chartroom-open-e2e-repo1-');
  const repoTwo = initScratchRepo('chartroom-open-e2e-repo2-');
  let daemonPid;

  try {
    // Repo 1: one id-carrying doc and one id-less doc; never registered (fresh fake home).
    mkdirSync(join(repoOne, 'docs'), { recursive: true });
    writeFileSync(join(repoOne, 'docs', 'alpha.md'), '---\nid: alpha-doc\n---\n\n# Alpha One\n', 'utf8');
    writeFileSync(join(repoOne, 'note.md'), '# Bare Note\n', 'utf8');
    git(repoOne, ['add', '.']);
    git(repoOne, ['commit', '-q', '-m', 'docs']);

    // ---- Scenario 1: cold start ----------------------------------------------------------
    const daemonJsonPath = join(fakeHome, '.chartroom', 'daemon.json');
    assert(!existsSync(daemonJsonPath), 'precondition: no daemon.json in the fake home');

    const run1 = chartroom(fakeHome, repoOne, ['open', join(repoOne, 'note.md'), '--print-url']);
    assert(run1.status === 0, `open exited ${run1.status}: ${run1.stderr}\n${run1.stdout}`);
    const url1 = run1.stdout.trim().split(/\r?\n/).at(-1);
    console.log(`scenario 1: open printed ${url1}`);

    assert(existsSync(daemonJsonPath), 'daemon.json was written by the spawned daemon');
    const info = JSON.parse(readFileSync(daemonJsonPath, 'utf8'));
    daemonPid = info.pid;
    assert(Number.isInteger(info.port), 'daemon.json carries a port');

    const registry = JSON.parse(readFileSync(join(fakeHome, '.chartroom', 'repos.json'), 'utf8'));
    assert(registry.repos.length === 1, 'repo 1 was auto-registered');
    const repoOneId = registry.repos[0].id;

    const match1 = new RegExp(`^http://127\\.0\\.0\\.1:${info.port}/#/repo/${encodeURIComponent(repoOneId)}/doc/(.+)$`).exec(url1);
    assert(match1, `printed URL addresses the registered repo: ${url1}`);
    const key1 = decodeURIComponent(match1[1]);
    assert(key1 === 'note.md', `id-less doc is path-keyed (got '${key1}')`);

    // API twin of the printed URL serves exactly that doc.
    const detail1 = await getJson(`http://127.0.0.1:${info.port}/api/repos/${encodeURIComponent(repoOneId)}/docs/${match1[1]}`);
    assert(detail1.id === null && detail1.key === 'note.md', 'doc detail: id null, key = path');
    assert(detail1.raw === '# Bare Note\n', 'doc detail raw matches the file');
    console.log('scenario 1 PASSED: cold start -> daemon spawned, repo registered, path-keyed doc served');

    // Identified doc resolves to its id-keyed URL against the SAME daemon.
    const run1b = chartroom(fakeHome, repoOne, ['open', join(repoOne, 'docs', 'alpha.md'), '--print-url']);
    assert(run1b.status === 0, `open (identified doc) exited ${run1b.status}: ${run1b.stderr}`);
    const url1b = run1b.stdout.trim().split(/\r?\n/).at(-1);
    assert(url1b.endsWith(`/doc/alpha-doc`), `identified doc is id-keyed: ${url1b}`);
    console.log('scenario 1b PASSED: identified doc addressed by id on the running daemon');

    // ---- Scenario 2: warm daemon, second never-registered repo ---------------------------
    writeFileSync(join(repoTwo, 'readme.md'), '# Repo Two Readme\n', 'utf8');
    git(repoTwo, ['add', '.']);
    git(repoTwo, ['commit', '-q', '-m', 'docs']);

    const run2 = chartroom(fakeHome, repoTwo, ['open', join(repoTwo, 'readme.md'), '--print-url']);
    assert(run2.status === 0, `open (repo 2) exited ${run2.status}: ${run2.stderr}\n${run2.stdout}`);
    const url2 = run2.stdout.trim().split(/\r?\n/).at(-1);
    console.log(`scenario 2: open printed ${url2}`);

    const infoAfter = JSON.parse(readFileSync(daemonJsonPath, 'utf8'));
    assert(infoAfter.pid === daemonPid && infoAfter.port === info.port, 'SAME daemon (pid+port) -- no restart');

    const registryAfter = JSON.parse(readFileSync(join(fakeHome, '.chartroom', 'repos.json'), 'utf8'));
    assert(registryAfter.repos.length === 2, 'repo 2 live-registered into the registry');
    const repoTwoId = registryAfter.repos.find((r) => r.id !== repoOneId).id;

    const repos = await getJson(`http://127.0.0.1:${info.port}/api/repos`);
    assert(repos.some((r) => r.id === repoTwoId), 'running daemon serves the live-registered repo');

    const match2 = new RegExp(`/doc/(.+)$`).exec(url2);
    const detail2 = await getJson(`http://127.0.0.1:${info.port}/api/repos/${encodeURIComponent(repoTwoId)}/docs/${match2[1]}`);
    assert(detail2.raw === '# Repo Two Readme\n', 'live-registered repo doc served without restart');

    // And its raw assets flow through the dynamic raw route immediately too.
    const rawResp = await fetch(`http://127.0.0.1:${info.port}/api/repos/${encodeURIComponent(repoTwoId)}/raw/readme.md`, {
      signal: AbortSignal.timeout(3000),
    });
    assert(rawResp.ok, `dynamic raw route serves the live repo (got ${rawResp.status})`);
    console.log('scenario 2 PASSED: warm daemon live-registered and served a brand-new repo, no restart');

    console.log('\nALL ASSERTIONS PASSED (open find-or-start + live registration e2e)');
  } finally {
    if (daemonPid) {
      try {
        process.kill(daemonPid);
        console.log(`teardown: killed spawned daemon pid ${daemonPid}`);
      } catch {
        console.log(`teardown: daemon pid ${daemonPid} already gone`);
      }
    }
    for (const dir of [fakeHome, repoOne, repoTwo]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows can hold locks briefly (watcher handles); scratch dirs in tmp are harmless.
      }
    }
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exitCode = 1;
});
