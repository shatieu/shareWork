#!/usr/bin/env node
// Phase-4 acceptance script (plan §8.4) proving the literal Build Order §8 item 4 acceptance line:
// "agent writes an ask-me block via file edit; human answers in browser; answer lands in the doc;
// agent reads it back." Four clauses, proven in sequence, same structure as every prior phase's own
// acceptance script (e.g. `editor-round-trip.mjs`'s own git-mv/self-heal proof).
//
// "human answers in browser" is proven at the API/data layer here (driving the real daemon route
// via `.inject()`), same honest "no real browser" caveat every prior phase's acceptance script has
// carried (plan §9 risk #6) -- the rendering/interaction layer itself is covered separately by
// `chartroom-ui`'s own component test suite (AskMeBlock/question-widget tests).
//
// Prerequisite: the package must already be built (dist/daemon/*.js present), e.g. via
// `npx tsc -p packages/chartroom/tsconfig.json` or `npm run build` from packages/chartroom/.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_STATE_MODULE_PATH = join(HERE, '..', 'dist', 'daemon', 'repo-state.js');
const SERVER_MODULE_PATH = join(HERE, '..', 'dist', 'daemon', 'server.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function main() {
  for (const p of [REPO_STATE_MODULE_PATH, SERVER_MODULE_PATH]) {
    if (!existsSync(p)) {
      throw new Error(
        `built module not found (expected ${p}) -- run "npx tsc -p packages/chartroom/tsconfig.json" ` +
          `(or "npm run build" from packages/chartroom/) before running this acceptance script.`,
      );
    }
  }

  const { rebuild } = await import(pathToFileURL(REPO_STATE_MODULE_PATH).href);
  const { buildServer } = await import(pathToFileURL(SERVER_MODULE_PATH).href);

  const scratchDir = mkdtempSync(join(tmpdir(), 'chartroom-ask-me-acceptance-'));
  try {
    // --- Step 1: "agent writes an ask-me block via file edit" -- a plain file write, no Chart Room
    //     tooling involved, matching the spec's own "works via Read/Grep/edit alone" north star. ---
    const docPath = join(scratchDir, 'decision.md');
    const original = [
      '---',
      'id: doc-decision',
      '---',
      '',
      '# Auth strategy',
      '',
      'Some context the agent already wrote.',
      '',
      ':::ask-me{id="q-03" type="choice"}',
      'How should we authenticate?',
      '',
      '- [ ] PAT tokens',
      '- [ ] OAuth 2.1',
      '- [ ] Both',
      ':::',
      '',
      'Unrelated trailing content, must stay untouched.',
      '',
    ].join('\n');
    writeFileSync(docPath, original, 'utf8');

    let state = rebuild(scratchDir);
    const repoRuntime = {
      id: 'repo-a',
      name: 'repo-a',
      absPath: scratchDir,
      getState: () => state,
      setState: (next) => {
        state = next;
      },
    };
    const app = buildServer([repoRuntime], { uiDistDir: join(scratchDir, 'no-such-ui-dist') });

    assert(state.index.docs['doc-decision'], 'expected the scratch doc to be indexed by id');
    const unanswered = state.interactiveBlocks['doc-decision']?.askMe.find((q) => q.directiveId === 'q-03');
    assert(unanswered, 'expected an unanswered ask-me question to be extracted from the scratch doc');
    assert(unanswered.answered === false, 'expected the question to start unanswered');
    assert(unanswered.type === 'single-select', 'expected type="choice" to alias-normalize to single-select');

    // --- Step 2: "human answers in browser" -- driven at the API layer via .inject(), the daemon's
    //     own real PATCH route (buildServer()'s registered handler), same as every daemon-route
    //     .inject() test elsewhere in this suite. ---
    const answerResponse = await app.inject({
      method: 'PATCH',
      url: '/api/repos/repo-a/docs/doc-decision/ask-me',
      payload: { directiveId: 'q-03', value: 'both', author: 'Acceptance Script' },
    });
    assert(answerResponse.statusCode === 200, `expected the ask-me PATCH to succeed, got ${answerResponse.statusCode}`);

    // --- Step 3: "answer lands in the doc" -- the file on disk now carries answered="true" and the
    //     formatted answer blockquote, with everything else byte-identical. ---
    const afterAnswer = readFileSync(docPath, 'utf8');
    assert(afterAnswer.includes(':::ask-me{id="q-03" type="choice" answered="true"}'), 'expected answered="true" on the fence line');
    assert(/> \*\*Answer\*\* \(\d{4}-\d{2}-\d{2}, Acceptance Script\): Both/.test(afterAnswer), 'expected a formatted answer blockquote line');
    assert(afterAnswer.includes('Some context the agent already wrote.'), 'expected content before the block to be untouched');
    assert(afterAnswer.includes('Unrelated trailing content, must stay untouched.'), 'expected content after the block to be untouched');

    // A second answer attempt against the now-answered block is rejected (plan §3.7), proving the
    // in-doc record really is treated as a durable, single-answer decision record.
    const secondAttempt = await app.inject({
      method: 'PATCH',
      url: '/api/repos/repo-a/docs/doc-decision/ask-me',
      payload: { directiveId: 'q-03', value: 'pat', author: 'Someone Else' },
    });
    assert(secondAttempt.statusCode === 409, `expected a second answer attempt to be rejected with 409, got ${secondAttempt.statusCode}`);
    assert(readFileSync(docPath, 'utf8') === afterAnswer, 'expected the rejected second attempt to leave the file untouched');

    // --- Step 4: "agent reads it back" -- deliberately a plain readFileSync, no daemon/API
    //     involved for this last step, matching the literal wording. ---
    const finalRaw = readFileSync(docPath, 'utf8');
    assert(finalRaw.includes('Both'), 'expected the agent to be able to read the answer back with a plain file read');

    console.log('chartroom acceptance: ask-me-round-trip -- ALL ASSERTIONS PASSED');
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
