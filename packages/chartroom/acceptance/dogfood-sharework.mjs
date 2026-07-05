#!/usr/bin/env node
// Package 01-housekeeping-dogfood acceptance script, proving the package's acceptance line
// against THIS repo (shareWork itself, not a scratch repo):
//
//   "a `git mv` of a suite-design doc self-heals; the changelog directory renders in the viewer."
//
// 1. `chartroom check` exits 0; `.docs/index.json` parses; every changelog entry under
//    suite-design/overnight/changelog/entries/ is present in the index's `docs` map with an id
//    (raw-Read proof -- the spec's north star is that an agent can Read the index directly).
// 2. git-mv self-heal: `git mv` a clean suite-design doc to a new name, `chartroom resolve <id>`
//    returns the NEW path (matchType 'id'), and the raw index.json contains the new path; then
//    `git mv` it back and resolve returns the original path again. Net-zero on the repo; every
//    mutation is restored in `finally`.
// 3. Changelog renders in the viewer: build the real daemon Fastify server in-process (same
//    pattern as acceptance/two-repo-browse.mjs -- app.inject(), the real HTTP route code path)
//    and assert GET /api/repos lists this repo, GET .../docs includes the changelog entries, and
//    GET .../docs/<entry-id> returns 200 with the entry's raw content.
//
// Prerequisite: the package must already be built (dist/*.js present) and `chartroom init` must
// already have been run against this repo (ids assigned, check clean) -- i.e. the dogfood state
// this package commits.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');
const CLI_PATH = join(HERE, '..', 'dist', 'cli.js');
const REPO_STATE_MODULE_PATH = join(HERE, '..', 'dist', 'daemon', 'repo-state.js');
const SERVER_MODULE_PATH = join(HERE, '..', 'dist', 'daemon', 'server.js');

const MV_SOURCE = 'suite-design/Product-Suite_Research-Synthesis.md';
const MV_TARGET = 'suite-design/Product-Suite_Research-Synthesis.tmp-moved.md';
const CHANGELOG_DIR = 'suite-design/overnight/changelog/entries';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
}

function cli(args, { allowFailure = false } = {}) {
  try {
    return { stdout: execFileSync('node', [CLI_PATH, ...args], { cwd: REPO_ROOT, encoding: 'utf8' }), code: 0 };
  } catch (err) {
    if (allowFailure) return { stdout: String(err.stdout ?? ''), code: err.status ?? 1 };
    throw err;
  }
}

function readIndexRaw() {
  return readFileSync(join(REPO_ROOT, '.docs', 'index.json'), 'utf8');
}

async function main() {
  for (const p of [CLI_PATH, REPO_STATE_MODULE_PATH, SERVER_MODULE_PATH]) {
    if (!existsSync(p)) {
      throw new Error(`built module not found (${p}) -- run the build for packages/chartroom first.`);
    }
  }

  // --- Step 1: check clean + raw index proof for the changelog directory. ---
  const check = cli(['check'], { allowFailure: true });
  assert(check.code === 0, `expected 'chartroom check' to exit 0, got ${check.code}:\n${check.stdout}`);

  const index = JSON.parse(readIndexRaw());
  assert(index.version === 1 && index.docs && typeof index.docs === 'object', 'index.json parses with docs map');

  const entryFiles = readdirSync(join(REPO_ROOT, CHANGELOG_DIR)).filter((f) => f.endsWith('.md'));
  assert(entryFiles.length >= 8, `expected >= 8 changelog entries on disk, got ${entryFiles.length}`);
  const docsByPath = new Map(Object.entries(index.docs).map(([id, d]) => [d.path, id]));
  const entryIds = [];
  for (const f of entryFiles) {
    const rel = `${CHANGELOG_DIR}/${f}`;
    const id = docsByPath.get(rel);
    assert(typeof id === 'string' && id.length > 0, `changelog entry ${rel} is id-keyed in index.docs`);
    entryIds.push(id);
  }
  console.log(`step 1 OK: check clean; ${entryFiles.length} changelog entries id-keyed in raw index.json`);

  // --- Step 2: git mv self-heal (restored in finally). ---
  const sourceId = docsByPath.get(MV_SOURCE);
  assert(typeof sourceId === 'string', `${MV_SOURCE} is id-keyed in the index (got ${sourceId})`);

  let moved = false;
  try {
    git(['mv', MV_SOURCE, MV_TARGET]);
    moved = true;

    const resolved = JSON.parse(cli(['resolve', sourceId, '--json']).stdout);
    assert(
      resolved.matchType === 'id' && resolved.path === MV_TARGET,
      `after git mv, resolve '${sourceId}' -> matchType 'id' at ${MV_TARGET}, got: ${JSON.stringify(resolved)}`,
    );
    assert(
      readIndexRaw().includes(MV_TARGET),
      `raw .docs/index.json contains the NEW path ${MV_TARGET} (plain-read proof, no CLI needed)`,
    );

    git(['mv', MV_TARGET, MV_SOURCE]);
    moved = false;

    const resolvedBack = JSON.parse(cli(['resolve', sourceId, '--json']).stdout);
    assert(
      resolvedBack.matchType === 'id' && resolvedBack.path === MV_SOURCE,
      `after moving back, resolve '${sourceId}' -> ${MV_SOURCE}, got: ${JSON.stringify(resolvedBack)}`,
    );
    console.log(`step 2 OK: git mv self-heals -- '${sourceId}' resolved at both paths, index followed`);
  } finally {
    if (moved) {
      git(['mv', MV_TARGET, MV_SOURCE]);
      cli(['index'], { allowFailure: true });
    }
  }

  // --- Step 3: the changelog directory renders through the real daemon routes. ---
  const { rebuild } = await import(pathToFileURL(REPO_STATE_MODULE_PATH).href);
  const { buildServer } = await import(pathToFileURL(SERVER_MODULE_PATH).href);
  const state = rebuild(REPO_ROOT);
  const app = buildServer(
    [{ id: 'sharework', name: 'sharework', absPath: REPO_ROOT, getState: () => state }],
    { uiDistDir: join(REPO_ROOT, 'no-such-ui-dist') },
  );

  const reposResponse = await app.inject({ method: 'GET', url: '/api/repos' });
  assert(reposResponse.statusCode === 200, `GET /api/repos -> 200, got ${reposResponse.statusCode}`);
  assert(
    reposResponse.json().some((r) => r.id === 'sharework'),
    'GET /api/repos lists the sharework repo',
  );

  const docsResponse = await app.inject({ method: 'GET', url: '/api/repos/sharework/docs' });
  assert(docsResponse.statusCode === 200, `GET .../docs -> 200, got ${docsResponse.statusCode}`);
  const docList = docsResponse.json();
  const changelogDocs = docList.filter((d) => d.path.startsWith(`${CHANGELOG_DIR}/`));
  assert(
    changelogDocs.length === entryFiles.length && changelogDocs.every((d) => typeof d.id === 'string'),
    `docs list carries all ${entryFiles.length} changelog entries with ids, got ${changelogDocs.length}`,
  );

  const sampleId = entryIds[entryIds.length - 1];
  const docResponse = await app.inject({ method: 'GET', url: `/api/repos/sharework/docs/${sampleId}` });
  assert(docResponse.statusCode === 200, `GET .../docs/${sampleId} -> 200, got ${docResponse.statusCode}`);
  const docBody = docResponse.json();
  assert(
    typeof docBody.raw === 'string' && docBody.raw.includes(`id: ${sampleId}`) && docBody.doc.path.startsWith(CHANGELOG_DIR),
    `doc detail for '${sampleId}' returns the entry's raw content and path`,
  );
  console.log(`step 3 OK: changelog directory renders via daemon routes (${changelogDocs.length} entries; sampled '${sampleId}')`);

  console.log('chartroom acceptance: dogfood-sharework -- ALL ASSERTIONS PASSED');
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
