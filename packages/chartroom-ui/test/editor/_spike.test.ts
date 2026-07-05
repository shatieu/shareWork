import { describe, expect, it } from 'vitest';
import { buildDocNodeFromBlocks, canonicalizeBlock, createHeadlessEngine, extractCurrentBlocks, reconstructFile } from '../../src/editor/roundTrip.js';
import { segmentDocument } from '../../src/editor/segmentBlocks.js';

describe('spike: does the headless Milkdown engine actually mount and round-trip', () => {
  it('parses and serializes a trivial paragraph', async () => {
    const engine = await createHeadlessEngine();
    try {
      const out = canonicalizeBlock(engine, 'Hello world.');
      console.log('canonicalize paragraph ->', JSON.stringify(out));
      expect(typeof out).toBe('string');
    } finally {
      await engine.destroy();
    }
  });

  it('builds a doc from segmented blocks and extracts them back out unedited', async () => {
    const engine = await createHeadlessEngine();
    try {
      const raw = '# Hello\n\nSome *text* here.\n\n- one\n- two\n';
      const doc = segmentDocument(raw);
      const pmDoc = buildDocNodeFromBlocks(engine, doc.blocks);
      console.log('pmDoc childCount', pmDoc.childCount, pmDoc.toJSON());
      const current = extractCurrentBlocks(engine, pmDoc);
      console.log('current blocks', JSON.stringify(current, null, 2));
      expect(current).toHaveLength(doc.blocks.length);
    } finally {
      await engine.destroy();
    }
  });

  it('full no-op round trip: unmatched bullet-marker/tightness canonicalization still yields byte-identical output', async () => {
    const engine = await createHeadlessEngine();
    try {
      const raw = '# Title\n\n- one\n- two\n';
      const doc = segmentDocument(raw);
      const pmDoc = buildDocNodeFromBlocks(engine, doc.blocks);
      const current = extractCurrentBlocks(engine, pmDoc);
      console.log('canonicalize(original list) ->', JSON.stringify(canonicalizeBlock(engine, '- one\n- two\n')));
      console.log('current[1].text (list) ->', JSON.stringify(current[1].text));
      const result = reconstructFile(engine, doc, current);
      console.log('reconstructed ->', JSON.stringify(result));
      expect(result).toBe(raw);
    } finally {
      await engine.destroy();
    }
  });

  it('directive block round-trips byte-identical (opaque passthrough)', async () => {
    const engine = await createHeadlessEngine();
    try {
      const raw = '# Title\n\n:::llm{model="opus"}\nDo the thing.\n:::\n\nAfter text.\n';
      const doc = segmentDocument(raw);
      const pmDoc = buildDocNodeFromBlocks(engine, doc.blocks);
      const current = extractCurrentBlocks(engine, pmDoc);
      const result = reconstructFile(engine, doc, current);
      expect(result).toBe(raw);
    } finally {
      await engine.destroy();
    }
  });

  it('a single-block edit changes only that block, everything else byte-identical', async () => {
    const engine = await createHeadlessEngine();
    try {
      const raw = '# Title\n\nFirst para.\n\nSecond para.\n\n- one\n- two\n';
      const doc = segmentDocument(raw);
      const pmDoc = buildDocNodeFromBlocks(engine, doc.blocks);
      const current = extractCurrentBlocks(engine, pmDoc);
      // Simulate editing the second paragraph only (text excludes its own trailing terminator,
      // same convention extractCurrentBlocks itself now produces).
      current[2] = { ...current[2], text: 'Second para EDITED.' };
      const result = reconstructFile(engine, doc, current);
      console.log('edited reconstruction ->', JSON.stringify(result));
      expect(result).toBe('# Title\n\nFirst para.\n\nSecond para EDITED.\n\n- one\n- two\n');
    } finally {
      await engine.destroy();
    }
  });
});
