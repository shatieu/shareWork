#!/usr/bin/env node
/**
 * Loads the Sea Chest migration files into a THROWAWAY dockerized Postgres and runs the RLS
 * behavior checks (95-rls-checks.sql). Zero contact with any live Supabase project -- this
 * is the "SQL syntax-checked locally" gate for a package that must never apply migrations.
 *
 * Usage: node supabase/local-check/run-local-check.mjs   (requires a local docker daemon)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const name = `seachest-sqlcheck-${Date.now()}`;
const image = 'postgres:16-alpine';

function docker(args, input) {
  const res = spawnSync('docker', args, {
    input,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return res;
}

function fail(msg, res) {
  console.error(`FAIL: ${msg}`);
  if (res) console.error(res.stdout, res.stderr);
  docker(['rm', '-f', name]);
  process.exit(1);
}

console.log(`starting ${image} as ${name} ...`);
let res = docker(['run', '--rm', '-d', '--name', name, '-e', 'POSTGRES_PASSWORD=pg', image]);
if (res.status !== 0) fail('could not start postgres container (is docker running?)', res);

// Wait for readiness.
let ready = false;
for (let i = 0; i < 60; i++) {
  res = docker(['exec', name, 'pg_isready', '-U', 'postgres']);
  if (res.status === 0) {
    ready = true;
    break;
  }
  execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 500)']); // ~0.5s sleep
}
if (!ready) fail('postgres never became ready');
// pg_isready can flip green a moment before the post-init restart completes; settle briefly.
execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 1500)']);

const migrationsDir = join(here, '..', 'migrations');
const files = [
  join(here, '00-shim.sql'),
  ...readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(migrationsDir, f)),
  join(here, '90-grants.sql'),
  join(here, '95-rls-checks.sql'),
];

for (const file of files) {
  const sql = readFileSync(file, 'utf8');
  res = docker(
    ['exec', '-i', name, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    sql,
  );
  if (res.status !== 0) fail(`${file} did not load cleanly`, res);
  console.log(`ok: ${file.split(/[\\/]/).pop()}`);
}

docker(['rm', '-f', name]);
console.log('LOCAL SQL CHECK PASSED: migrations load cleanly and RLS behaves as specified.');
