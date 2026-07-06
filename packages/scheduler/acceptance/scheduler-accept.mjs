// Acceptance: the productized Lookout runs the overnight mission's proven loop
// deterministically -- NO network, NO real Task Scheduler/cron registration
// (registration is the documented per-machine step in the README), NO real
// claude spawns (spawn is captured). Simulates usage.json sequences including
// the field-observed resets_at jitter and asserts:
//   1. sensor signal lifecycle: ok -> ALERT -> PAUSE -> self-clear on reset;
//   2. exactly ONE resurrection decision per usage window across jittered polls;
//   3. the resurrect command is session-pinned (--resume, never --continue)
//      with CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0;
//   4. guard refuses without a pinned session id;
//   5. mission lock: acquire, refuse-while-live, stale-reap, release-not-unlink.
//
// Run: pnpm test:acceptance (builds first via turbo, or `pnpm build` manually).
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_THRESHOLDS, evaluateSignals, PRINT_BG_CEILING_ENV } from 'reset-detector';
import {
  acquireLock,
  DEFAULT_CONFIG,
  initConfig,
  lockLiveness,
  readLock,
  releaseLock,
  resurrectionMarkerKeys,
  runGuardOnce,
  runSensorOnce,
  statePaths,
} from 'scheduler';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(['PASS', name]);
  } catch (err) {
    results.push(['FAIL', `${name} -- ${err.message}`]);
  }
}

const stateDir = mkdtempSync(join(tmpdir(), 'lookout-accept-'));
const paths = statePaths(stateDir);

// ---------------------------------------------------------------------------
// 1. Sensor lifecycle over a simulated usage sequence (fake source, no network).
const sequence = [
  { pct: 50, resets_at: '2026-07-06T06:30:00Z', expect: 'ok' },
  { pct: 85, resets_at: '2026-07-06T06:30:00Z', expect: 'ALERT' },
  { pct: 97, resets_at: '2026-07-06T06:29:59.900Z', expect: 'PAUSE' }, // jitter begins
  { pct: 100, resets_at: '2026-07-06T06:30:00.100Z', expect: 'PAUSE' }, // jitter across boundary
  { pct: 3, resets_at: '2026-07-06T11:30:00Z', expect: 'ok' }, // window reset
];
for (const step of sequence) {
  const snapshot = {
    five_hour_pct: step.pct,
    seven_day_pct: 11,
    resets_at: step.resets_at,
    checked_at: '2026-07-06T06:00:00Z',
    source: 'oauth',
  };
  const result = await runSensorOnce({
    source: { read: async () => ({ snapshot, fromCache: false }) },
    stateDir,
    thresholds: DEFAULT_THRESHOLDS,
    mode: 'pause',
  });
  check(`sensor: pct ${step.pct} -> ${step.expect}`, () =>
    assert.equal(result.status, step.expect),
  );
}
check('sensor: ALERT and PAUSE self-cleared after the window reset', () => {
  assert.equal(existsSync(paths.alertFile), false);
  assert.equal(existsSync(paths.pauseFile), false);
});
check('sensor: usage.json keeps the prototype shape', () => {
  const raw = JSON.parse(readFileSync(paths.usageFile, 'utf8'));
  for (const key of ['five_hour_pct', 'seven_day_pct', 'resets_at', 'checked_at']) {
    assert.ok(key in raw, `missing ${key}`);
  }
});
check('spend mode suppresses PAUSE at 100%', () => {
  assert.deepEqual(evaluateSignals(100, DEFAULT_THRESHOLDS, 'spend'), {
    alert: true,
    pause: false,
  });
});

// ---------------------------------------------------------------------------
// 2+3. Guard: jittered resets_at across polls => ONE resurrection decision.
initConfig(stateDir, { cwd: stateDir, mintUuid: () => 'accept-session-uuid' });
const config = {
  ...structuredClone(DEFAULT_CONFIG),
  sessionId: 'accept-session-uuid',
  repoRoot: stateDir,
};
const NOW = () => new Date('2026-07-06T11:40:00Z');
const spawned = [];
const guardDeps = {
  now: NOW,
  spawnDetached: (req) => spawned.push(req),
  lastCommitTime: () => new Date('2026-07-06T10:30:00Z'), // 70 min idle
  log: () => {},
};

function writeUsage(resetsAt, checkedAt) {
  writeFileSync(
    paths.usageFile,
    JSON.stringify({
      five_hour_pct: 3,
      seven_day_pct: 11,
      resets_at: resetsAt,
      checked_at: checkedAt,
    }),
  );
  utimesSync(paths.usageFile, new Date(checkedAt), new Date(checkedAt));
}

// Guard tick 1: fresh window, idle repo, resets_at just UNDER the minute.
writeUsage('2026-07-06T16:29:59.900Z', '2026-07-06T11:38:00Z');
const tick1 = await runGuardOnce(config, stateDir, guardDeps);
check('guard tick 1: resurrects', () => assert.equal(tick1.action.kind, 'resurrect'));
check('guard: resurrect command is session-pinned --resume (never --continue/-c)', () => {
  assert.deepEqual(tick1.spawned.argv, [
    'claude',
    '--resume',
    'accept-session-uuid',
    '-p',
    readFileSync(join(stateDir, 'resume-prompt.txt'), 'utf8').trim(),
    '--permission-mode',
    'bypassPermissions',
  ]);
  assert.ok(!tick1.spawned.argv.includes('--continue'));
  assert.ok(!tick1.spawned.argv.includes('-c'));
});
check('guard: spawn env carries the print-mode bg-kill ceiling = 0', () =>
  assert.equal(tick1.spawned.env[PRINT_BG_CEILING_ENV], '0'),
);

// Guard ticks 2-4: same window, resets_at jittering across the minute
// boundary between polls (the exact 2026-07-06 field failure: 5 resurrections
// in one window under exact-string dedup).
for (const [i, jitter] of [
  '2026-07-06T16:30:00.100Z',
  '2026-07-06T16:29:59.500Z',
  '2026-07-06T16:30:00.900Z',
].entries()) {
  writeUsage(jitter, '2026-07-06T11:39:00Z');
  const tick = await runGuardOnce(config, stateDir, guardDeps);
  check(`guard tick ${i + 2} (jitter ${jitter.slice(11, 23)}): no second resurrection`, () =>
    assert.equal(tick.action.kind, 'none'),
  );
}
check('guard: exactly ONE spawn across 4 jittered ticks in one window', () =>
  assert.equal(spawned.length, 1),
);
check('guard: exactly ONE window marker on disk', () =>
  assert.deepEqual(resurrectionMarkerKeys(stateDir), ['20260706-1630']),
);

// A genuinely NEW window may fire again.
writeUsage('2026-07-06T21:30:00Z', '2026-07-06T11:39:30Z');
const tickNew = await runGuardOnce(config, stateDir, guardDeps);
check('guard: a genuinely new window resurrects again', () =>
  assert.equal(tickNew.action.kind, 'resurrect'),
);

// 4. Refusal without a pinned session id.
const noSession = { ...config, sessionId: null };
writeUsage('2026-07-07T02:30:00Z', '2026-07-06T11:39:45Z');
const refused = await runGuardOnce(noSession, stateDir, guardDeps);
check('guard: refuses without a pinned sessionId (no -c fallback)', () => {
  assert.equal(refused.action.kind, 'refuse');
  assert.match(refused.action.reason, /sessionId/);
});

// ---------------------------------------------------------------------------
// 5. Mission lock semantics.
const lockPath = paths.lockFile;
const a1 = acquireLock(lockPath, { sessionId: 's1', pid: 111, now: NOW, isPidAlive: () => true });
check('lock: first acquire succeeds', () => assert.equal(a1.ok, true));
const a2 = acquireLock(lockPath, { sessionId: 's2', pid: 222, now: NOW, isPidAlive: () => true });
check('lock: second acquire refused while holder is live', () => {
  assert.equal(a2.ok, false);
  assert.match(a2.message, /mission already owned by PID 111/);
});
const a3 = acquireLock(lockPath, { sessionId: 's3', pid: 333, now: NOW, isPidAlive: () => false });
check('lock: stale (dead PID) lock is reaped', () => {
  assert.equal(a3.ok, true);
  assert.equal(a3.reaped.pid, 111);
});
const rel = releaseLock(lockPath, { pid: 333 });
check('lock: release marks released but never unlinks the file', () => {
  assert.equal(rel.ok, true);
  assert.equal(existsSync(lockPath), true);
  assert.equal(lockLiveness(readLock(lockPath)), 'released');
});

// ---------------------------------------------------------------------------
let failed = 0;
for (const [verdict, name] of results) {
  if (verdict === 'FAIL') failed += 1;
  console.log(`${verdict}  ${name}`);
}
console.log(
  `\n${failed === 0 ? 'ACCEPTANCE PASS' : 'ACCEPTANCE FAIL'}: ${results.length - failed}/${results.length} checks` +
    ' (deterministic: zero network, zero scheduler registration, zero real spawns)',
);
process.exit(failed === 0 ? 0 : 1);
