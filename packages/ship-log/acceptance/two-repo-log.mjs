#!/usr/bin/env node
// Acceptance: package 04 (Bridge phase 1), plan §6.1 -- the deterministic, CI-able half of the
// Ship_Spec §9.1 acceptance line:
//
//   "with the Crew plugin's hooks installed, two sessions in two different scratch repos each
//    produce a create-only changelog fragment in their own repo plus a SQLite entry, and one
//    daily rollup digest covers both"
//
// What this drives, end to end, with NOTHING faked except the summarizer (env seam, see below):
//   - the REAL spawned `ship serve` bin (hull + chartroom + ship-log stations), isolated
//     HOME/USERPROFILE (report 02 R5: os.homedir() honors the override);
//   - the REAL `plugins/crew/hooks/emit.mjs` emitter as a child process per hook event, fed the
//     raw Claude Code stdin payload shapes verified in report 04 R1 -- it discovers the hull via
//     the scratch home's ~/.suite/services.json exactly like a live install;
//   - two scratch git repos with real commits (git delta is real), fragments written by the
//     real capture pipeline, rollup built + served over the real HTTP routes.
// Summarizer: `SHIP_LOG_FAKE_SUMMARIZER=1` + `NODE_ENV=test` (src/summarize.ts seam, refused
// outside NODE_ENV=test) -- deterministic digests, zero spend. The live-proof half of the
// acceptance line (two real `claude -p` sessions, real Haiku summaries) is run manually per
// plugins/crew/README.md; evidence in the crew report.
//
// Bonus proof (plan §6.1 step "kill hull"): hull down -> emit.mjs spools -> next `ship serve`
// drains the spool into a third entry (capture delayed, never lost), drained file renamed (not
// deleted), spoolPending back to 0.
//
// Exit code: non-zero on any failed assertion.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIP_CLI = join(HERE, '..', '..', 'ship', 'dist', 'cli.js');
const EMIT_MJS = join(HERE, '..', '..', '..', 'plugins', 'crew', 'hooks', 'emit.mjs');

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

const scratch = [];
function scratchDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function childEnv(home) {
  return {
    ...process.env,
    USERPROFILE: home, // Windows homedir()
    HOME: home, // POSIX homedir()
    NODE_ENV: 'test',
    SHIP_LOG_FAKE_SUMMARIZER: '1', // summarize.ts seam -- deterministic, zero spend
  };
}

function git(repo, ...args) {
  const result = spawnSync(
    'git',
    ['-c', 'user.email=acceptance@ship.test', '-c', 'user.name=ship-acceptance', ...args],
    { cwd: repo, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${repo}: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function makeScratchRepo(tag) {
  const repo = scratchDir(`two-repo-${tag}-`);
  git(repo, 'init', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), `# scratch ${tag}\n`, 'utf8');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', `chore: init scratch ${tag}`);
  return repo;
}

/** Pipe one raw Claude-Code-shaped hook payload (report 04 R1 field names) through the REAL
 * emitter, exactly as a live hook invocation would. Resolves with the exit code. */
function emitEvent(home, payload) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [EMIT_MJS], {
      env: childEnv(home),
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c) => {
      stderr += String(c);
    });
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (stderr.trim()) console.error(`  emit.mjs stderr: ${stderr.trim()}`);
      resolvePromise(code);
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function makeTranscript(home, sessionId, text) {
  const path = join(home, `${sessionId}-transcript.jsonl`);
  const lines = [
    JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: `please ${text}` }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `done: ${text}` }] } }),
  ];
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
  return path;
}

/** One synthetic session: SessionStart -> real commit in the repo -> Stop -> SessionEnd, every
 * event through the real emitter. Payload shapes are R1's empirically captured stdin JSON. */
async function runSyntheticSession(home, repo, sessionId, changeTag) {
  const transcriptPath = makeTranscript(home, sessionId, changeTag);
  const common = { session_id: sessionId, transcript_path: transcriptPath, cwd: repo };

  assert(
    (await emitEvent(home, { ...common, hook_event_name: 'SessionStart', source: 'startup' })) === 0,
    `emit SessionStart (${sessionId.slice(0, 8)}) exits 0`,
  );

  writeFileSync(join(repo, `${changeTag}.md`), `work: ${changeTag}\n`, 'utf8');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', `feat: ${changeTag}`);

  assert(
    (await emitEvent(home, {
      ...common,
      hook_event_name: 'Stop',
      prompt_id: 'p-1',
      permission_mode: 'default',
      stop_hook_active: false,
    })) === 0,
    `emit Stop (${sessionId.slice(0, 8)}) exits 0`,
  );
  assert(
    (await emitEvent(home, { ...common, hook_event_name: 'SessionEnd', prompt_id: 'p-1', reason: 'other' })) === 0,
    `emit SessionEnd (${sessionId.slice(0, 8)}) exits 0`,
  );
}

function startShip(home) {
  const child = spawn(process.execPath, [SHIP_CLI, 'serve'], {
    cwd: home, // no suite-design/overnight/progress.json here -> voyage off
    env: childEnv(home),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { child, output: '' };
  child.stdout.on('data', (c) => {
    state.output += String(c);
  });
  child.stderr.on('data', (c) => {
    state.output += String(c);
  });
  return state;
}

async function waitForPort(state) {
  return waitFor(() => {
    const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(state.output);
    return m ? Number(m[1]) : undefined;
  }, 'ship serve to print its URL');
}

function fragmentsDir(repo) {
  return join(repo, 'changelog', 'entries');
}

function listFragments(repo) {
  const dir = fragmentsDir(repo);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
}

async function main() {
  assert(existsSync(SHIP_CLI), `ship CLI built at ${SHIP_CLI} (run \`pnpm --filter ship build\`)`);
  assert(existsSync(EMIT_MJS), `emitter present at ${EMIT_MJS}`);
  if (failures > 0) {
    process.exit(1);
  }

  const home = scratchDir('two-repo-home-');
  const repoA = makeScratchRepo('a');
  const repoB = makeScratchRepo('b');
  const sessionA = 'aaaa1111-acceptance-session-a';
  const sessionB = 'bbbb2222-acceptance-session-b';
  const sessionC = 'cccc3333-acceptance-session-c';

  let ship = startShip(home);
  try {
    // --- Phase 1: two sessions, two repos, one fragment + one entry each ---
    console.log('--- Phase 1: two synthetic sessions through the real emitter + real hull ---');
    const port = await waitForPort(ship);
    const base = `http://127.0.0.1:${port}`;
    console.log(`  ship serve up on port ${port} (pid ${ship.child.pid})`);
    await waitFor(
      () => fetch(`${base}/api/ship-log/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok),
      'ship-log health to answer',
    );

    const services = JSON.parse(readFileSync(join(home, '.suite', 'services.json'), 'utf8'));
    assert(services.hull?.port === port && services.hull?.stations?.includes('ship-log'),
      'services.json registers the hull with the ship-log station (emitter discovery path)');

    // CSRF posture: the ingest route refuses a bare POST without the local-client header.
    const bare = await fetch(`${base}/api/ship-log/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(2000),
    });
    assert(bare.status === 403, 'POST /api/ship-log/events without x-ship-deck -> 403');

    await runSyntheticSession(home, repoA, sessionA, 'alpha-work');
    await runSyntheticSession(home, repoB, sessionB, 'beta-work');

    const entries = await waitFor(async () => {
      const res = await fetch(`${base}/api/ship-log/entries`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return undefined;
      const rows = await res.json();
      return rows.length === 2 && rows.every((r) => r.fragmentPath) ? rows : undefined;
    }, 'both sessions captured into entries with fragments');

    const projA = basename(repoA);
    const projB = basename(repoB);
    assert(
      new Set(entries.map((e) => e.project)).size === 2 &&
        entries.some((e) => e.project === projA) &&
        entries.some((e) => e.project === projB),
      'two SQLite entries, one per project',
    );
    assert(
      entries.every((e) => e.summaryModel === 'fake-test-seam' && e.summary.includes('[fake-summary]')),
      'summaries came through the injected fake summarizer seam',
    );

    for (const [repo, sessionId, tag] of [
      [repoA, sessionA, 'alpha-work'],
      [repoB, sessionB, 'beta-work'],
    ]) {
      const frags = listFragments(repo);
      const session8 = sessionId.slice(0, 8);
      assert(frags.length === 1, `${basename(repo)}: exactly one fragment (${frags.join(', ')})`);
      const name = frags[0] ?? '';
      assert(
        /^\d{4}-\d{2}-\d{2}--.+--[a-z0-9]{8}\.md$/.test(name) && name.includes(session8),
        `${basename(repo)}: fragment name has date--slug--session8 shape (${name})`,
      );
      if (frags.length === 1) {
        const body = readFileSync(join(fragmentsDir(repo), name), 'utf8');
        assert(
          body.includes(`id: log-${session8}`) && body.includes(`feat: ${tag}`),
          `${basename(repo)}: fragment has the Chart-Room id + the session's real commit`,
        );
      }
    }

    // --- Phase 2: rollup covers both projects ---
    console.log('--- Phase 2: one daily rollup digest covers both projects ---');
    const date = entries[0].date;
    const built = await fetch(`${base}/api/ship-log/rollup/${date}`, {
      method: 'POST',
      headers: { 'x-ship-deck': '1' },
      signal: AbortSignal.timeout(10000),
    });
    assert(built.ok, `POST /api/ship-log/rollup/${date} builds a rollup`);
    const stored = await fetch(`${base}/api/ship-log/rollup/${date}`, { signal: AbortSignal.timeout(2000) });
    const rollup = stored.ok ? await stored.json() : undefined;
    assert(
      rollup?.entry_count === 2 && rollup.digest_md.includes(projA) && rollup.digest_md.includes(projB),
      'GET rollup serves a stored digest covering both projects',
    );

    // --- Phase 3: hull down -> spool -> restart drains into a third entry ---
    console.log('--- Phase 3: spool-drain proof (capture delayed, never lost) ---');
    process.kill(ship.child.pid);
    await waitFor(async () => {
      try {
        await fetch(`${base}/api/ship-log/health`, { signal: AbortSignal.timeout(500) });
        return undefined; // still answering
      } catch {
        return true;
      }
    }, 'hull to go down');
    console.log(`  hull pid ${ship.child.pid} down (services.json left stale on purpose -- hard kill)`);

    const transcriptC = makeTranscript(home, sessionC, 'gamma-work');
    const commonC = { session_id: sessionC, transcript_path: transcriptC, cwd: repoA };
    assert(
      (await emitEvent(home, { ...commonC, hook_event_name: 'SessionStart', source: 'startup' })) === 0,
      'emit SessionStart with hull down exits 0 (fail-open)',
    );
    assert(
      (await emitEvent(home, { ...commonC, hook_event_name: 'SessionEnd', prompt_id: 'p-1', reason: 'other' })) === 0,
      'emit SessionEnd with hull down exits 0 (fail-open)',
    );

    const spoolFile = join(home, '.ship', 'spool', 'events.jsonl');
    const spooledLines = readFileSync(spoolFile, 'utf8').trim().split('\n');
    assert(spooledLines.length === 2, `both events spooled to ~/.ship/spool/events.jsonl (${spooledLines.length} lines)`);

    ship = startShip(home);
    const port2 = await waitForPort(ship);
    const base2 = `http://127.0.0.1:${port2}`;
    const drained = await waitFor(async () => {
      const res = await fetch(`${base2}/api/ship-log/entries`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return undefined;
      const rows = await res.json();
      return rows.length === 3 ? rows : undefined;
    }, 'restarted hull to drain the spool into a third entry');
    assert(
      drained.some((e) => e.sessionId === sessionC),
      'third entry is the spooled session (capture was delayed, not lost)',
    );

    const spoolDirFiles = readdirSync(join(home, '.ship', 'spool'));
    assert(!existsSync(spoolFile), 'live spool file consumed');
    assert(
      spoolDirFiles.some((f) => /^events\.drained\..+\.jsonl$/.test(f)),
      'drained spool renamed to events.drained.<ts>.jsonl (never deleted)',
    );
    const health = await (await fetch(`${base2}/api/ship-log/health`, { signal: AbortSignal.timeout(2000) })).json();
    assert(health.ok === true && health.spoolPending === false, 'health reports ok with nothing pending in the spool');
  } finally {
    try {
      process.kill(ship.child.pid);
      console.log(`  teardown: killed ship pid ${ship.child.pid}`);
    } catch {
      console.log(`  teardown: ship pid ${ship.child.pid} already gone`);
    }
    await sleep(300); // let the process release scratch-file handles before cleanup
    for (const dir of scratch) {
      // Scratch temp dirs only -- never repo files (REMOVALS.md policy covers repo files).
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* Windows file-lock stragglers in %TEMP% are harmless */
      }
    }
  }

  if (failures > 0) {
    console.error(`two-repo-log: ${failures} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log('two-repo-log: all assertions passed');
}

main().catch((err) => {
  console.error(`two-repo-log: fatal: ${err.stack ?? err}`);
  process.exit(1);
});
