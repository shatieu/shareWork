#!/usr/bin/env node
// Standalone acceptance script (plan §11.2) proving the Chart Room phase-1 acceptance line
// end-to-end: "git mv a doc -> an agent resolves it via CLI, and via raw index Read; a staged
// commit normalizes only staged files; no repair ever creates a commit."
//
// Operates entirely inside a disposable fs.mkdtempSync scratch directory with its own throwaway
// `git init` -- this script NEVER touches the real repo tree it lives in.
//
// Prerequisite: the package must already be built (dist/cli.js, dist/hook.js present), e.g. via
// `npx tsc -p packages/chartroom/tsconfig.json` or `npm run build` from packages/chartroom/.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(HERE, '..', 'dist', 'cli.js');
const HOOK_MODULE_PATH = join(HERE, '..', 'dist', 'hook.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function git(cwd, args, input) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', input, maxBuffer: 1024 * 1024 * 64 });
}

function runCli(cwd, args) {
  return execFileSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });
}

function writeDoc(scratchDir, relPath, content) {
  const abs = join(scratchDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

async function main() {
  if (!existsSync(CLI_PATH) || !existsSync(HOOK_MODULE_PATH)) {
    throw new Error(
      `built CLI not found (expected ${CLI_PATH} and ${HOOK_MODULE_PATH}) -- run ` +
        `"npx tsc -p packages/chartroom/tsconfig.json" (or "npm run build" from packages/chartroom/) ` +
        `before running this acceptance script.`,
    );
  }

  const scratchDir = mkdtempSync(join(tmpdir(), 'chartroom-acceptance-'));
  try {
    // --- Step 1: scaffold a scratch git repo with docs, each already carrying an id, one linking
    //     to another via the `[text](path "id:target-id")` format. ---
    git(scratchDir, ['init', '-q']);
    git(scratchDir, ['config', 'user.email', 'acceptance@chartroom.test']);
    git(scratchDir, ['config', 'user.name', 'Chart Room Acceptance']);
    git(scratchDir, ['config', 'core.autocrlf', 'false']);

    writeDoc(scratchDir, 'docs/a.md', '---\nid: doc-a\n---\n\n# A\n');
    writeDoc(scratchDir, 'docs/b.md', '---\nid: doc-b\n---\n\n# B\n\nSee [A](a.md "id:doc-a") for details.\n');
    writeDoc(scratchDir, 'docs/c.md', '---\nid: doc-c\n---\n\n# C\n');
    writeDoc(scratchDir, 'docs/d.md', '---\nid: doc-d\n---\n\n# D\n');
    git(scratchDir, ['add', '-A']);
    git(scratchDir, ['commit', '-q', '-m', 'initial docs']);

    // --- Step 2: `chartroom index` via the built CLI; assert .docs/index.json exists and is
    //     well-formed. ---
    runCli(scratchDir, ['index']);
    const indexPath = join(scratchDir, '.docs', 'index.json');
    assert(existsSync(indexPath), 'expected .docs/index.json to exist after `chartroom index`');
    const indexAfterBuild = JSON.parse(readFileSync(indexPath, 'utf8'));
    assert(indexAfterBuild.version === 1, 'expected index.json version === 1');
    assert(indexAfterBuild.docs['doc-a']?.path === 'docs/a.md', 'expected doc-a indexed at docs/a.md');
    assert(indexAfterBuild.docs['doc-b']?.path === 'docs/b.md', 'expected doc-b indexed at docs/b.md');

    // --- Step 3: real `git mv`, staged automatically by git. ---
    mkdirSync(join(scratchDir, 'docs', 'sub'), { recursive: true });
    git(scratchDir, ['mv', 'docs/a.md', 'docs/sub/a.md']);

    // --- Step 4: `chartroom resolve doc-a --json` via the built CLI. ---
    const resolveOut = runCli(scratchDir, ['resolve', 'doc-a', '--json']);
    const resolveResult = JSON.parse(resolveOut);
    assert(resolveResult.matchType === 'id', `expected matchType 'id', got '${resolveResult.matchType}'`);
    assert(
      resolveResult.path === 'docs/sub/a.md',
      `expected resolved path 'docs/sub/a.md', got '${resolveResult.path}'`,
    );

    // --- Step 5: raw Read of .docs/index.json (no CLI involved), confirming the on-disk copy is
    //     fresh too (the "always-fresh" rule writes the refreshed index back as a side effect). ---
    const indexAfterMove = JSON.parse(readFileSync(indexPath, 'utf8'));
    assert(
      indexAfterMove.docs['doc-a']?.path === 'docs/sub/a.md',
      'expected raw-read index.json to reflect the post-mv path for doc-a',
    );

    // --- Step 6: stage an unrelated third doc's edit, plus doc B's link to doc A (stale since the
    //     move, left untouched) -- stage doc B too. Leave a fourth doc entirely untouched. ---
    const dBefore = readFileSync(join(scratchDir, 'docs/d.md'), 'utf8');

    const cRaw = readFileSync(join(scratchDir, 'docs/c.md'), 'utf8');
    writeFileSync(join(scratchDir, 'docs/c.md'), cRaw + '\nUnrelated update to C.\n', 'utf8');

    const bRaw = readFileSync(join(scratchDir, 'docs/b.md'), 'utf8');
    writeFileSync(join(scratchDir, 'docs/b.md'), bRaw + '\nSome additional context.\n', 'utf8');

    git(scratchDir, ['add', 'docs/c.md', 'docs/b.md']);

    const commitCountBefore = git(scratchDir, ['rev-list', '--count', 'HEAD']).trim();

    // --- Step 7: invoke the pre-commit hook logic directly (executePreCommitHook, the
    //     non-process-exiting core -- `runPreCommitHook` calls `process.exit` and would kill this
    //     script), so intermediate state can be inspected without a real `git commit`. ---
    const hookModule = await import(pathToFileURL(HOOK_MODULE_PATH).href);
    const hookResult = hookModule.executePreCommitHook({ repoRoot: scratchDir });

    assert(hookResult.ok === true, `expected hook result.ok === true, got error: ${hookResult.error}`);

    const bStagedAfter = git(scratchDir, ['show', ':docs/b.md']);
    assert(
      bStagedAfter.includes('(sub/a.md "id:doc-a")'),
      `expected doc B's staged blob to reference the corrected path sub/a.md, got:\n${bStagedAfter}`,
    );
    assert(
      !bStagedAfter.includes('(a.md "id:doc-a")'),
      "expected the stale pre-move href to no longer be present in doc B's staged blob",
    );

    const dAfter = readFileSync(join(scratchDir, 'docs/d.md'), 'utf8');
    assert(dAfter === dBefore, "expected doc D's working-tree bytes to be untouched by the hook");
    assert(
      !hookResult.files.some((f) => f.path === 'docs/d.md'),
      'expected doc D to never be part of the staged-file set the hook processed',
    );

    const commitCountAfter = git(scratchDir, ['rev-list', '--count', 'HEAD']).trim();
    assert(commitCountAfter === commitCountBefore, 'expected the hook to never create a commit');

    console.log('chartroom acceptance: git-mv-resolution -- ALL ASSERTIONS PASSED');
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
