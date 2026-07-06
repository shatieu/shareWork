#!/usr/bin/env node
// Acceptance: package 05 (Bridge phase 2) -- the deterministic, CI-able form of the
// Ship_Spec §9.2 acceptance line:
//
//   "an agent creates/updates ledger items via MCP; native team tasks appear as mirrored items"
//
// What this drives, end to end, with NOTHING faked:
//   - the REAL `ship-ledger mcp` stdio server as a child process, driven by the REAL
//     @modelcontextprotocol/sdk Client -- the same protocol path a Claude Code agent takes
//     (the live-proof half swaps this client for an actual `claude -p --mcp-config` session;
//     evidence in the crew report);
//   - the REAL spawned `ship serve` bin (hull + chartroom + ship-log + ship-ledger), isolated
//     HOME/USERPROFILE (report 02 R5) -- proving HTTP reads see the MCP process's writes (one
//     WAL store, two processes);
//   - the REAL `plugins/crew/hooks/emit.mjs` emitter fed the empirically verified TaskCreated/
//     TaskCompleted stdin payloads (report 04 R1) -- proving native tasks land as
//     source='native-mirror' items via ship-log's ingest fan-out;
//   - the spool path: hull down -> task event spools (emitter exits 0) -> restarted hull drains
//     it into the ledger (mirroring delayed, never lost).
//
// Exit code: non-zero on any failed assertion.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LEDGER_CLI = join(HERE, '..', 'dist', 'cli.js');
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
  };
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

async function waitForPort(state) {
  return waitFor(() => {
    const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(state.output);
    return m ? Number(m[1]) : undefined;
  }, 'ship serve to print its URL');
}

/** Pipe one raw Claude-Code-shaped hook payload (report 04 R1 field names) through the REAL
 * emitter, exactly as a live TaskCreate/TaskUpdate tool call would. */
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

function taskPayload(event, sessionId, taskId, cwd, extra = {}) {
  return {
    session_id: sessionId,
    prompt_id: 'p-1',
    transcript_path: join(cwd, 'transcript.jsonl'),
    cwd,
    hook_event_name: event,
    task_id: taskId,
    ...extra,
  };
}

function firstTextJson(result) {
  const content = result.content ?? [];
  if (content[0]?.type !== 'text') throw new Error('tool result has no text content');
  return JSON.parse(content[0].text);
}

async function fetchItems(base, query = '') {
  const res = await fetch(`${base}/api/ship-ledger/items${query}`, {
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) return undefined;
  return res.json();
}

async function main() {
  assert(existsSync(LEDGER_CLI), `ship-ledger CLI built at ${LEDGER_CLI} (run \`pnpm --filter ship-ledger build\`)`);
  assert(existsSync(SHIP_CLI), `ship CLI built at ${SHIP_CLI} (run \`pnpm --filter ship build\`)`);
  assert(existsSync(EMIT_MJS), `emitter present at ${EMIT_MJS}`);
  if (failures > 0) process.exit(1);

  const home = scratchDir('ledger-mcp-home-');
  const fakeProjectDir = scratchDir('ledger-mirror-proj-');

  let ship = startShip(home);
  let mcpClient;
  try {
    // --- Phase 1: the hull is up with the ledger station mounted ---
    console.log('--- Phase 1: hull up, ledger station mounted ---');
    const port = await waitForPort(ship);
    const base = `http://127.0.0.1:${port}`;
    console.log(`  ship serve up on port ${port} (pid ${ship.child.pid})`);
    await waitFor(
      () => fetch(`${base}/api/ship-ledger/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok),
      'ship-ledger health to answer',
    );
    const services = JSON.parse(readFileSync(join(home, '.suite', 'services.json'), 'utf8'));
    assert(
      services.hull?.stations?.includes('ship-ledger') && services.hull?.stations?.includes('ship-log'),
      'services.json registers the hull with ship-ledger + ship-log stations',
    );
    const bare = await fetch(`${base}/api/ship-ledger/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
      signal: AbortSignal.timeout(2000),
    });
    assert(bare.status === 403, 'POST /api/ship-ledger/items without x-ship-deck -> 403');

    // --- Phase 2: an MCP client creates/updates items through the real stdio server, while the
    // hull is running (two processes, one WAL store) ---
    console.log('--- Phase 2: real MCP client over stdio against the real ship-ledger mcp bin ---');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [LEDGER_CLI, 'mcp'],
      env: childEnv(home),
    });
    mcpClient = new Client({ name: 'ledger-acceptance-client', version: '0.0.0' });
    await mcpClient.connect(transport);

    const tools = (await mcpClient.listTools()).tools.map((t) => t.name).sort();
    assert(
      JSON.stringify(tools) === JSON.stringify(['ledger_create', 'ledger_get', 'ledger_list', 'ledger_update']),
      `MCP server lists the four ledger tools (${tools.join(', ')})`,
    );

    const created = firstTextJson(
      await mcpClient.callTool({
        name: 'ledger_create',
        arguments: {
          title: 'Chart the reef',
          spec_md: 'Sound the depths before the fleet passes.',
          project: 'acceptance-project',
          session_id: 'mcp-agent-session-1',
          difficulty: 'M',
          remaining_guess_h: 3,
        },
      }),
    );
    assert(
      created.source === 'agent' && created.status === 'open' && created.stageProgress === 0,
      'ledger_create returns an agent-sourced open item',
    );

    const updated = firstTextJson(
      await mcpClient.callTool({
        name: 'ledger_update',
        arguments: { id: created.id, status: 'in_progress', remaining_guess_h: 2 },
      }),
    );
    assert(
      updated.status === 'in_progress' && updated.stageProgress === 40 && updated.remainingGuessH === 2,
      'ledger_update advances status; stage_progress recomputes deterministically (40)',
    );

    const listed = firstTextJson(await mcpClient.callTool({ name: 'ledger_list', arguments: {} }));
    assert(listed.length === 1 && listed[0].id === created.id, 'ledger_list sees the item');

    // The running hull's HTTP API reads the MCP process's writes -- one store, WAL.
    const viaHttp = await fetchItems(base);
    assert(
      viaHttp?.length === 1 && viaHttp[0].id === created.id && viaHttp[0].status === 'in_progress',
      'hull HTTP API serves the item the separate MCP process wrote (WAL, one ledger.db)',
    );

    // --- Phase 3: native task events mirror in through the real emitter + fan-out ---
    console.log('--- Phase 3: TaskCreated/TaskCompleted mirror through emit.mjs -> hull ---');
    const sessionT = 'dddd4444-acceptance-task-sess';
    assert(
      (await emitEvent(home, taskPayload('TaskCreated', sessionT, '1', fakeProjectDir, {
        task_subject: 'Native: fix the rigging',
        task_description: 'Agent-team task created natively.',
      }))) === 0,
      'emit TaskCreated exits 0',
    );
    const mirrored = await waitFor(async () => {
      const rows = await fetchItems(base, '?source=native-mirror');
      return rows?.length === 1 ? rows : undefined;
    }, 'TaskCreated to appear as a native-mirror item');
    assert(
      mirrored[0].title === 'Native: fix the rigging' &&
        mirrored[0].status === 'open' &&
        mirrored[0].nativeSessionId === sessionT &&
        mirrored[0].nativeTaskId === '1' &&
        mirrored[0].project === basename(fakeProjectDir),
      'mirrored item carries subject/description/project and native identity',
    );

    assert(
      (await emitEvent(home, taskPayload('TaskCompleted', sessionT, '1', fakeProjectDir, {
        task_subject: 'Native: fix the rigging',
      }))) === 0,
      'emit TaskCompleted exits 0',
    );
    const done = await waitFor(async () => {
      const rows = await fetchItems(base, '?source=native-mirror');
      return rows?.[0]?.status === 'done' ? rows : undefined;
    }, 'mirrored item to flip to done');
    assert(
      done.length === 1 && done[0].stageProgress === 100,
      'TaskCompleted marks the SAME item done / stage 100 (no duplicate)',
    );

    // --- Phase 4: hull down -> task event spools -> restart drains it into the ledger ---
    console.log('--- Phase 4: spool proof (mirroring delayed, never lost) ---');
    process.kill(ship.child.pid);
    await waitFor(async () => {
      try {
        await fetch(`${base}/api/ship-ledger/health`, { signal: AbortSignal.timeout(500) });
        return undefined;
      } catch {
        return true;
      }
    }, 'hull to go down');

    assert(
      (await emitEvent(home, taskPayload('TaskCreated', sessionT, '2', fakeProjectDir, {
        task_subject: 'Native: spooled while hull was down',
      }))) === 0,
      'emit TaskCreated with hull down exits 0 (fail-open)',
    );
    const spoolFile = join(home, '.ship', 'spool', 'events.jsonl');
    assert(existsSync(spoolFile), 'task event landed in ~/.ship/spool/events.jsonl');

    ship = startShip(home);
    const port2 = await waitForPort(ship);
    const base2 = `http://127.0.0.1:${port2}`;
    const drained = await waitFor(async () => {
      const rows = await fetchItems(base2, '?source=native-mirror');
      return rows?.length === 2 ? rows : undefined;
    }, 'restarted hull to drain the spooled task event into the ledger');
    assert(
      drained.some((i) => i.nativeTaskId === '2' && i.title === 'Native: spooled while hull was down'),
      'spooled TaskCreated mirrored after restart (delayed, not lost)',
    );
  } finally {
    try {
      await mcpClient?.close();
    } catch {
      /* transport already gone */
    }
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
    console.error(`ledger-mcp-mirror: ${failures} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log('ledger-mcp-mirror: all assertions passed');
}

main().catch((err) => {
  console.error(`ledger-mcp-mirror: fatal: ${err.stack ?? err}`);
  process.exit(1);
});
