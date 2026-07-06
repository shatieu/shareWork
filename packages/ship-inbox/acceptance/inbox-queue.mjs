#!/usr/bin/env node
// Acceptance: package 06 (Bridge phase 3) -- the deterministic, CI-able form of the
// Ship_Spec §9.3 acceptance line:
//
//   "a vanilla session's permission prompt is answered from the browser; 'always allow' writes
//    a native rule that suppresses the next prompt"
//
// What this drives, end to end, with NOTHING faked:
//   - the REAL spawned `ship serve` bin (hull + chartroom + ship-log + ship-ledger + ship-inbox),
//     isolated HOME/USERPROFILE;
//   - the REAL `plugins/crew/hooks/emit.mjs` fed an R1-shaped Notification payload -- proving
//     agent questions land on the inbox through the one ingest transport;
//   - the REAL `plugins/crew/hooks/permission.mjs` resolver fed the R1-documented
//     PermissionRequest stdin shape, resolved by the SAME HTTP calls the Deck's Inbox page
//     makes -- the whole browser-answers-the-prompt chain minus only Claude Code's interactive
//     event firing (headlessly unverifiable, researcher R1; manual steps in the README);
//   - the "always allow" decision writing a NATIVE rule additively into a scratch project's
//     .claude/settings.local.json with a timestamped backup (pre-seeded deny rule + unknown
//     keys byte-survive);
//   - fail-open: resolver with no hull prints nothing and exits 0.
//
// The live half of the acceptance line (a real `claude -p` run whose permission denial is
// suppressed by the written rule) costs API spend and is executed once as the crew report's
// live proof, not here.
//
// Exit code: non-zero on any failed assertion.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIP_CLI = join(HERE, '..', '..', 'ship', 'dist', 'cli.js');
const EMIT_MJS = join(HERE, '..', '..', '..', 'plugins', 'crew', 'hooks', 'emit.mjs');
const PERMISSION_MJS = join(HERE, '..', '..', '..', 'plugins', 'crew', 'hooks', 'permission.mjs');

const DECK_HEADER = { 'x-ship-deck': '1' };

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

function childEnv(home, extra = {}) {
  return { ...process.env, USERPROFILE: home, HOME: home, ...extra };
}

function startShip(home) {
  const child = spawn(process.execPath, [SHIP_CLI, 'serve'], {
    cwd: home,
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

/** Spawn one of the REAL crew hook scripts with the given stdin payload; resolves with
 * { code, stdout } once it exits. */
function runHook(script, home, payload, env = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [script], {
      env: childEnv(home, env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += String(c)));
    child.stderr.on('data', (c) => (stderr += String(c)));
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (stderr.trim()) console.error(`  ${script.split(/[\\/]/).pop()} stderr: ${stderr.trim()}`);
      resolvePromise({ code, stdout });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function permissionStdin(sessionId, cwd, toolName, toolInput) {
  // The R1-documented PermissionRequest hook stdin shape (interactive-only event).
  return {
    session_id: sessionId,
    transcript_path: join(cwd, 'transcript.jsonl'),
    cwd,
    hook_event_name: 'PermissionRequest',
    tool_name: toolName,
    tool_input: toolInput,
  };
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) return undefined;
  return res.json();
}

async function postJson(url, body) {
  // No content-type on body-less POSTs: fastify 400s an empty application/json body.
  const res = await fetch(url, {
    method: 'POST',
    headers: body === undefined ? DECK_HEADER : { 'content-type': 'application/json', ...DECK_HEADER },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });
  return res;
}

async function main() {
  assert(existsSync(SHIP_CLI), `ship CLI built at ${SHIP_CLI} (run \`pnpm --filter ship build\`)`);
  assert(existsSync(EMIT_MJS), `emitter present at ${EMIT_MJS}`);
  assert(existsSync(PERMISSION_MJS), `resolver present at ${PERMISSION_MJS}`);
  if (failures > 0) process.exit(1);

  const home = scratchDir('inbox-accept-home-');
  const projectDir = scratchDir('inbox-accept-proj-');

  // Pre-seed the scratch project's settings.local.json: the always-allow write must preserve
  // this deny rule and unknown key VERBATIM (the additive-only non-negotiable).
  mkdirSync(join(projectDir, '.claude'), { recursive: true });
  const seededSettings = {
    permissions: { allow: ['Read'], deny: ['WebSearch'] },
    someUnknownKey: { keep: ['me', 'intact'] },
  };
  writeFileSync(join(projectDir, '.claude', 'settings.local.json'), JSON.stringify(seededSettings, null, 2), 'utf8');

  const ship = startShip(home);
  try {
    // --- Phase 1: hull up with the inbox station + Inbox Deck tab ---
    console.log('--- Phase 1: hull up, ship-inbox mounted with the Inbox tab ---');
    const port = await waitFor(() => {
      const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(ship.output);
      return m ? Number(m[1]) : undefined;
    }, 'ship serve to print its URL');
    const base = `http://127.0.0.1:${port}`;
    console.log(`  ship serve up on port ${port} (pid ${ship.child.pid})`);
    await waitFor(() => getJson(`${base}/api/ship-inbox/health`), 'ship-inbox health to answer');

    const stations = await getJson(`${base}/api/hull/stations`);
    const inboxStation = stations.find((s) => s.name === 'ship-inbox');
    assert(
      stations.length === 4 && inboxStation?.tab?.id === 'inbox' && inboxStation.tab.title === 'Inbox',
      'hull lists 4 stations; ship-inbox owns the Inbox Deck tab',
    );
    const bare = await fetch(`${base}/api/ship-inbox/permissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's', cwd: projectDir, toolName: 'Bash' }),
      signal: AbortSignal.timeout(2000),
    });
    assert(bare.status === 403, 'POST /api/ship-inbox/permissions without x-ship-deck -> 403');

    // --- Phase 2: Notification through the REAL emitter -> agent question -> ack ---
    console.log('--- Phase 2: Notification (R1 shape) through emit.mjs -> open question -> ack ---');
    const notif = await runHook(EMIT_MJS, home, {
      session_id: 'accept-sess-1',
      transcript_path: join(projectDir, 't.jsonl'),
      cwd: projectDir,
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      message: 'Claude needs your permission to use Bash',
    });
    assert(notif.code === 0, 'emit.mjs Notification exits 0');
    const questions = await waitFor(async () => {
      const rows = await getJson(`${base}/api/ship-inbox/questions?status=open`);
      return rows?.length === 1 ? rows : undefined;
    }, 'Notification to appear as an open agent question');
    assert(
      questions[0].kind === 'permission_prompt' &&
        questions[0].message === 'Claude needs your permission to use Bash' &&
        questions[0].sessionId === 'accept-sess-1',
      'question carries notification_type/message/session',
    );
    const acked = await postJson(`${base}/api/ship-inbox/questions/${questions[0].id}/ack`);
    assert(acked.ok, 'question acknowledged from the (browser) HTTP API');

    // --- Phase 3: allow decided from the browser API reaches the REAL resolver's stdout ---
    console.log('--- Phase 3: permission.mjs long-poll resolved by the browser decision (allow) ---');
    const allowRun = runHook(PERMISSION_MJS, home, permissionStdin('accept-sess-2', projectDir, 'Bash', {
      command: 'git push origin main',
    }), { SHIP_INBOX_WAIT_MS: '15000' });
    const pendingA = await waitFor(async () => {
      const rows = await getJson(`${base}/api/ship-inbox/permissions?status=pending`);
      return rows?.length === 1 ? rows : undefined;
    }, 'resolver to enqueue the pending permission request');
    assert(
      pendingA[0].toolName === 'Bash' && pendingA[0].source === 'resolver' && pendingA[0].cwd === projectDir,
      'pending request carries tool/source/cwd',
    );
    const decideA = await postJson(`${base}/api/ship-inbox/permissions/${pendingA[0].id}/decision`, {
      behavior: 'allow',
    });
    assert(decideA.status === 200, 'decision POST (the Inbox page call) answers 200');
    const allowResult = await allowRun;
    assert(allowResult.code === 0, 'resolver exits 0 after the allow');
    let allowDecision;
    try {
      allowDecision = JSON.parse(allowResult.stdout);
    } catch {
      allowDecision = undefined;
    }
    assert(
      allowDecision?.hookSpecificOutput?.hookEventName === 'PermissionRequest' &&
        allowDecision.hookSpecificOutput.decision?.behavior === 'allow',
      'resolver stdout is the documented allow decision JSON',
    );

    // --- Phase 4: deny path ---
    console.log('--- Phase 4: deny from the browser API ---');
    const denyRun = runHook(PERMISSION_MJS, home, permissionStdin('accept-sess-3', projectDir, 'WebFetch', {
      url: 'https://example.com',
    }), { SHIP_INBOX_WAIT_MS: '15000' });
    const pendingB = await waitFor(async () => {
      const rows = await getJson(`${base}/api/ship-inbox/permissions?status=pending`);
      return rows?.length === 1 ? rows : undefined;
    }, 'second pending request');
    await postJson(`${base}/api/ship-inbox/permissions/${pendingB[0].id}/decision`, {
      behavior: 'deny',
      message: 'not today',
    });
    const denyResult = await denyRun;
    assert(
      denyResult.code === 0 && JSON.parse(denyResult.stdout).hookSpecificOutput.decision.behavior === 'deny',
      'resolver stdout is the documented deny decision JSON',
    );

    // --- Phase 5: always-allow writes the NATIVE rule additively, with backup ---
    console.log('--- Phase 5: always-allow -> native rule in settings.local.json (additive + backup) ---');
    const alwaysRun = runHook(PERMISSION_MJS, home, permissionStdin('accept-sess-4', projectDir, 'Bash', {
      command: 'git push origin main',
    }), { SHIP_INBOX_WAIT_MS: '15000' });
    const pendingC = await waitFor(async () => {
      const rows = await getJson(`${base}/api/ship-inbox/permissions?status=pending`);
      return rows?.length === 1 ? rows : undefined;
    }, 'third pending request');
    const decideC = await postJson(`${base}/api/ship-inbox/permissions/${pendingC[0].id}/decision`, {
      behavior: 'allow',
      alwaysAllowRule: 'Bash(git push:*)',
    });
    assert(decideC.status === 200, 'always-allow decision answers 200');
    const decideCBody = await decideC.json();
    assert(
      typeof decideCBody.ruleBackupPath === 'string' && decideCBody.ruleBackupPath.includes('.bak-'),
      'decision response records the timestamped backup path',
    );
    const alwaysResult = await alwaysRun;
    assert(
      JSON.parse(alwaysResult.stdout).hookSpecificOutput.decision.behavior === 'allow',
      'resolver resolves the prompt with allow',
    );

    const settingsAfter = JSON.parse(readFileSync(join(projectDir, '.claude', 'settings.local.json'), 'utf8'));
    assert(
      JSON.stringify(settingsAfter.permissions.allow) === JSON.stringify(['Read', 'Bash(git push:*)']),
      'allow list = original + the one new rule, in order',
    );
    assert(
      JSON.stringify(settingsAfter.permissions.deny) === JSON.stringify(['WebSearch']) &&
        JSON.stringify(settingsAfter.someUnknownKey) === JSON.stringify(seededSettings.someUnknownKey),
      'pre-seeded deny rule + unknown key survive verbatim (additive-only)',
    );
    assert(existsSync(decideCBody.ruleBackupPath), 'backup file exists beside settings.local.json');
    assert(
      readFileSync(decideCBody.ruleBackupPath, 'utf8') === JSON.stringify(seededSettings, null, 2),
      'backup contains the ORIGINAL pre-decision bytes',
    );
    const leftovers = readdirSync(join(projectDir, '.claude')).filter((f) => f.includes('.tmp-'));
    assert(leftovers.length === 0, 'no tmp files left behind by the atomic replace');

    // The one page reflects reality afterwards: nothing pending.
    const page = await getJson(`${base}/api/ship-inbox/items`);
    assert(
      page.permissions.length === 0 && page.questions.length === 0 && Array.isArray(page.docs),
      'one-page aggregation is clean after all decisions',
    );

    // --- Phase 6: fail-open without a hull ---
    console.log('--- Phase 6: resolver with NO hull -> silent, exit 0 (native dialog untouched) ---');
    const lonelyHome = scratchDir('inbox-accept-lonely-');
    const lonely = await runHook(PERMISSION_MJS, lonelyHome, permissionStdin('accept-sess-5', projectDir, 'Bash', {}));
    assert(lonely.code === 0 && lonely.stdout === '', 'no hull: exit 0, empty stdout');
  } finally {
    try {
      process.kill(ship.child.pid);
      console.log(`  teardown: killed ship pid ${ship.child.pid}`);
    } catch {
      console.log(`  teardown: ship pid ${ship.child.pid} already gone`);
    }
    await sleep(300);
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
    console.error(`inbox-queue: ${failures} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log('inbox-queue: all assertions passed');
}

main().catch((err) => {
  console.error(`inbox-queue: fatal: ${err.stack ?? err}`);
  process.exit(1);
});
