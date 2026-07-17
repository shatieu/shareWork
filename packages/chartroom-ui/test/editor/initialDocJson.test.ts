// Regression pin for the wave2-A "edit makes all text disappear" bug (root cause:
// `.ship-crew/exchange/wave2-a/findings.md`): the document built for the editor from segmented
// blocks must survive a strict `Node.fromJSON(schema, doc.toJSON())` pass. Before the fix, any
// doc containing a list threw
// `RangeError: Expected value of type boolean for attribute spread on type list_item, got string`
// — Milkdown's own preset parser writes list `spread` attrs as strings while the stock schema
// declared strict boolean validation, and `DocEditor` shipped the doc across exactly that strict
// JSON path. The contract is now guaranteed by `listAttrCompat.ts` (validation relaxed to accept
// Milkdown's real output — values untouched, so serialization bytes cannot change), and pinned
// here so it holds whichever way the editor hands its initial document over in the future.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Node } from '@milkdown/kit/prose/model';
import { buildDocNodeFromBlocks, createHeadlessEngine } from '../../src/editor/roundTrip.js';
import { segmentDocument } from '../../src/editor/segmentBlocks.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, 'fixtures');

/** Every list-bearing fixture in the suite — the exact block family that crashed the editor. */
const LIST_FIXTURES = [
  'bullet-dash.md',
  'bullet-plus.md',
  'bullet-star.md',
  'ordered-list.md',
  'gfm-tasklist.md',
  'nested-list.md',
  'list-loose.md',
  'list-tight.md',
  'combined.md',
];

describe('initial-doc JSON handoff contract (wave2-A regression)', () => {
  for (const file of LIST_FIXTURES) {
    it(`Node.fromJSON(schema, builtDoc.toJSON()) does not throw for ${file}`, async () => {
      const raw = readFileSync(join(FIXTURES_DIR, file), 'utf8');
      const engine = await createHeadlessEngine();
      try {
        const doc = buildDocNodeFromBlocks(engine, segmentDocument(raw).blocks);
        expect(() => Node.fromJSON(engine.schema, doc.toJSON())).not.toThrow();
      } finally {
        await engine.destroy();
      }
    });
  }

  it('still rejects genuinely invalid spread values (validation relaxed, not removed)', async () => {
    const engine = await createHeadlessEngine();
    try {
      const doc = buildDocNodeFromBlocks(engine, segmentDocument('- one\n- two\n').blocks);
      const json = doc.toJSON() as { content: Array<{ attrs: Record<string, unknown> }> };
      json.content[0].attrs.spread = 'sideways';
      expect(() => Node.fromJSON(engine.schema, json)).toThrow(/spread/);
    } finally {
      await engine.destroy();
    }
  });
});
