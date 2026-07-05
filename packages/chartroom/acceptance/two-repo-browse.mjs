#!/usr/bin/env node
// Phase-2 acceptance script (plan §8.2) proving the phase-2 acceptance line: "browse two
// registered repos in one UI; broken link shows tombstone info."
//
// Deliberately does NOT use a real browser/Playwright (plan §9 risk #1 -- see DECISIONS-NEEDED.md:
// a manual browser QA pass happens separately during review). This script proves the *data* half
// end-to-end through the real HTTP route/plugin code path, for real registered repos, via
// Fastify's app.inject() (no real TCP listener) -- mirroring phase-1's disposable-scratch-repo
// acceptance pattern (acceptance/git-mv-resolution.mjs).
//
// Prerequisite: the package must already be built (dist/daemon/*.js present), e.g. via
// `npm run build` from packages/chartroom/.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY_MODULE_PATH = join(HERE, '..', 'dist', 'daemon', 'registry.js');
const REPO_STATE_MODULE_PATH = join(HERE, '..', 'dist', 'daemon', 'repo-state.js');
const SERVER_MODULE_PATH = join(HERE, '..', 'dist', 'daemon', 'server.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
}

function writeDoc(scratchDir, relPath, content) {
  const abs = join(scratchDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function initScratchRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'acceptance@chartroom.test']);
  git(dir, ['config', 'user.name', 'Chart Room Acceptance']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  return dir;
}

async function main() {
  for (const p of [REGISTRY_MODULE_PATH, REPO_STATE_MODULE_PATH, SERVER_MODULE_PATH]) {
    if (!existsSync(p)) {
      throw new Error(
        `built daemon module not found (expected ${p}) -- run "npm run build" from ` +
          `packages/chartroom/ before running this acceptance script.`,
      );
    }
  }

  const { registerRepo, listRepos } = await import(pathToFileURL(REGISTRY_MODULE_PATH).href);
  const { rebuild } = await import(pathToFileURL(REPO_STATE_MODULE_PATH).href);
  const { buildServer } = await import(pathToFileURL(SERVER_MODULE_PATH).href);

  // Temp-HOME-scoped registry directory -- never touches the real user's ~/.chartroom/repos.json.
  const fakeHome = mkdtempSync(join(tmpdir(), 'chartroom-acceptance-home-'));
  let repoA;
  let repoB;
  try {
    // --- Step 1: two throwaway scratch repos, each with a couple of docs. ---
    repoA = initScratchRepo('chartroom-acceptance-repo-a-');
    writeDoc(repoA, 'docs/gone.md', '---\nid: gone\n---\n\n# Gone\n');
    writeDoc(
      repoA,
      'docs/linker.md',
      '---\nid: linker\n---\n\n# Linker\n\nSee [Gone](gone.md "id:gone") for details.\n',
    );
    git(repoA, ['add', '-A']);
    git(repoA, ['commit', '-q', '-m', 'initial docs (repo A)']);

    repoB = initScratchRepo('chartroom-acceptance-repo-b-');
    writeDoc(repoB, 'docs/x.md', '---\nid: doc-x\n---\n\n# X\n');
    writeDoc(repoB, 'docs/y.md', '---\nid: doc-y\n---\n\n# Y\n\nSee [X](x.md "id:doc-x").\n');
    git(repoB, ['add', '-A']);
    git(repoB, ['commit', '-q', '-m', 'initial docs (repo B)']);

    // --- Step 2: build repo A's initial index (no tombstone yet), then delete the linked doc and
    //     rebuild -- this is what produces a real tombstone entry (same mechanism as phase-1's own
    //     acceptance script / indexer.test.ts). ---
    rebuild(repoA);
    git(repoA, ['rm', '-q', 'docs/gone.md']);
    if (existsSync(join(repoA, 'docs/gone.md'))) {
      unlinkSync(join(repoA, 'docs/gone.md'));
    }
    const repoAState = rebuild(repoA);
    assert(
      repoAState.index.deleted['gone']?.lastPath === 'docs/gone.md',
      `expected repo A's index to tombstone 'gone' at docs/gone.md, got: ${JSON.stringify(repoAState.index.deleted)}`,
    );

    const repoBState = rebuild(repoB);

    // --- Step 3: register both repos into the temp-HOME-scoped registry. ---
    const entryA = registerRepo(repoA, fakeHome);
    const entryB = registerRepo(repoB, fakeHome);
    const registered = listRepos(fakeHome);
    assert(registered.length === 2, `expected 2 registered repos, got ${registered.length}`);

    // --- Step 4: build the Fastify server and drive it entirely through app.inject() (no real
    //     port) -- asserts (a) GET /api/repos lists both scratch repos. ---
    const app = buildServer(
      [
        { id: entryA.id, name: entryA.id, absPath: repoA, getState: () => repoAState },
        { id: entryB.id, name: entryB.id, absPath: repoB, getState: () => repoBState },
      ],
      { uiDistDir: join(fakeHome, 'no-such-ui-dist') },
    );

    const reposResponse = await app.inject({ method: 'GET', url: '/api/repos' });
    assert(reposResponse.statusCode === 200, `expected 200 from GET /api/repos, got ${reposResponse.statusCode}`);
    const reposBody = reposResponse.json();
    assert(reposBody.length === 2, `expected /api/repos to list 2 repos, got ${reposBody.length}`);
    assert(
      reposBody.some((r) => r.id === entryA.id) && reposBody.some((r) => r.id === entryB.id),
      `expected /api/repos to include both registered repo ids, got: ${JSON.stringify(reposBody)}`,
    );

    // --- (b) the doc-with-the-broken-link's GET .../docs/:docId response includes a brokenLinks
    //     entry with matchType 'tombstone' and the correct lastPath. ---
    const docResponse = await app.inject({
      method: 'GET',
      url: `/api/repos/${entryA.id}/docs/linker`,
    });
    assert(
      docResponse.statusCode === 200,
      `expected 200 from GET /api/repos/${entryA.id}/docs/linker, got ${docResponse.statusCode}`,
    );
    const docBody = docResponse.json();
    assert(
      docBody.brokenLinks.length === 1 &&
        docBody.brokenLinks[0].matchType === 'tombstone' &&
        docBody.brokenLinks[0].lastPath === 'docs/gone.md' &&
        docBody.brokenLinks[0].targetId === 'gone',
      `expected exactly one tombstone brokenLinks entry for 'gone' at docs/gone.md, got: ${JSON.stringify(docBody.brokenLinks)}`,
    );

    console.log('chartroom acceptance: two-repo-browse -- ALL ASSERTIONS PASSED');
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
    if (repoA) rmSync(repoA, { recursive: true, force: true });
    if (repoB) rmSync(repoB, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
