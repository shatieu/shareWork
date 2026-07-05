import { describe, expect, it } from 'vitest';
import { emptyIndex, type ChartRoomIndex } from '../../src/index-schema.js';
import type { InteractiveBlocks } from '../../src/interactive-blocks.js';
import type { ToolRepoContext } from '../../src/mcp/repo-context.js';
import {
  resolveTool,
  readDocTool,
  searchTool,
  listUnansweredQuestionsTool,
  answerStatusTool,
} from '../../src/mcp/tools.js';

function fixtureContext(
  index: ChartRoomIndex,
  interactiveBlocks: Record<string, InteractiveBlocks> = {},
  rawByPath: Record<string, string> = {},
): ToolRepoContext {
  return {
    getIndex: () => index,
    getInteractiveBlocks: () => interactiveBlocks,
    readDocRaw: (path: string) => {
      const raw = rawByPath[path];
      if (raw === undefined) throw new Error(`no fixture raw content for path '${path}'`);
      return raw;
    },
  };
}

function buildIndex(overrides: Partial<ChartRoomIndex> = {}): ChartRoomIndex {
  return { ...emptyIndex(), ...overrides };
}

function emptyBlocks(): InteractiveBlocks {
  return { askMe: [], actions: [], checkboxes: [] };
}

describe('resolveTool', () => {
  it('delegates verbatim to resolver.ts::resolve (id match)', () => {
    const index = buildIndex({
      docs: { 'auth-arch': { path: 'docs/auth.md', title: 'Auth Architecture', headings: [], outbound: [] } },
    });
    expect(resolveTool(fixtureContext(index), 'auth-arch')).toEqual({
      matchType: 'id',
      id: 'auth-arch',
      path: 'docs/auth.md',
    });
  });

  it('surfaces a tombstone result verbatim', () => {
    const index = buildIndex({
      deleted: { gone: { lastPath: 'docs/gone.md', deletedAt: '2026-01-01T00:00:00.000Z' } },
    });
    expect(resolveTool(fixtureContext(index), 'gone')).toEqual({
      matchType: 'tombstone',
      id: 'gone',
      lastPath: 'docs/gone.md',
      deletedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('surfaces a not-found result verbatim', () => {
    expect(resolveTool(fixtureContext(buildIndex()), 'nope')).toEqual({ matchType: 'not-found' });
  });
});

describe('readDocTool', () => {
  it('returns the full doc for a live id', () => {
    const index = buildIndex({
      docs: { a: { path: 'a.md', title: 'A Doc', headings: ['A Doc', 'Section'], outbound: [] } },
    });
    const ctx = fixtureContext(index, {}, { 'a.md': '# A Doc\n\nBody text.\n' });
    expect(readDocTool(ctx, 'a')).toEqual({
      matchType: 'found',
      id: 'a',
      path: 'a.md',
      title: 'A Doc',
      headings: ['A Doc', 'Section'],
      raw: '# A Doc\n\nBody text.\n',
    });
  });

  it('returns a tombstone shape for a deleted id, not a thrown error', () => {
    const index = buildIndex({
      deleted: { gone: { lastPath: 'was/here.md', deletedAt: '2026-02-02T00:00:00.000Z' } },
    });
    expect(readDocTool(fixtureContext(index), 'gone')).toEqual({
      matchType: 'tombstone',
      id: 'gone',
      lastPath: 'was/here.md',
      deletedAt: '2026-02-02T00:00:00.000Z',
    });
  });

  it('returns not-found for an unknown id, never a thrown error', () => {
    expect(readDocTool(fixtureContext(buildIndex()), 'unknown-id')).toEqual({
      matchType: 'not-found',
      id: 'unknown-id',
    });
  });
});

describe('searchTool', () => {
  it('ranks a strong title match above a weaker heading-only match', () => {
    const index = buildIndex({
      docs: {
        strong: { path: 'strong.md', title: 'Payments Gateway Integration', headings: ['Payments Gateway Integration'], outbound: [] },
        weak: { path: 'weak.md', title: 'Unrelated Doc', headings: ['A brief mention of payments'], outbound: [] },
      },
    });
    const results = searchTool(fixtureContext(index), 'payments gateway');
    expect(results[0].id).toBe('strong');
    expect(results.map((r) => r.id)).toContain('weak');
    expect(results[0].score).toBeGreaterThan(results.find((r) => r.id === 'weak')!.score);
  });

  it('returns an empty result for an empty/whitespace query, never a crash', () => {
    const index = buildIndex({ docs: { a: { path: 'a.md', title: 'A', headings: [], outbound: [] } } });
    expect(searchTool(fixtureContext(index), '')).toEqual([]);
    expect(searchTool(fixtureContext(index), '   ')).toEqual([]);
  });

  it('respects the limit option', () => {
    const docs: ChartRoomIndex['docs'] = {};
    for (let i = 0; i < 5; i += 1) {
      docs[`doc-${i}`] = { path: `doc-${i}.md`, title: 'Widget Configuration Guide', headings: [], outbound: [] };
    }
    const index = buildIndex({ docs });
    const results = searchTool(fixtureContext(index), 'widget configuration', 2);
    expect(results).toHaveLength(2);
  });
});

describe('listUnansweredQuestionsTool', () => {
  it('surfaces only unanswered ask-me questions, never :::actions items', () => {
    const index = buildIndex({
      docs: {
        a: { path: 'a.md', title: 'A', headings: [], outbound: [] },
        b: { path: 'b.md', title: 'B', headings: [], outbound: [] },
      },
    });
    const blocks: Record<string, InteractiveBlocks> = {
      a: {
        askMe: [
          { directiveId: 'q1', type: 'yesno', prompt: 'Ship it?', answered: false, blockRange: { start: 0, end: 0 } },
          { directiveId: 'q2', type: 'text', prompt: 'Already answered', answered: true, answerText: 'yes', blockRange: { start: 0, end: 0 } },
        ],
        actions: [{ directiveId: 'act1', label: 'Do a thing', checked: false, blockRange: { start: 0, end: 0 } }],
        checkboxes: [],
      },
      b: {
        askMe: [{ directiveId: 'q3', type: 'text', prompt: 'Second repo question', answered: false, blockRange: { start: 0, end: 0 } }],
        actions: [],
        checkboxes: [],
      },
    };

    const results = listUnansweredQuestionsTool(fixtureContext(index, blocks));
    expect(results).toEqual([
      { docId: 'a', docPath: 'a.md', directiveId: 'q1', prompt: 'Ship it?', type: 'yesno' },
      { docId: 'b', docPath: 'b.md', directiveId: 'q3', prompt: 'Second repo question', type: 'text' },
    ]);
    expect(results.some((r) => r.directiveId === 'act1')).toBe(false);
    expect(results.some((r) => r.directiveId === 'q2')).toBe(false);
  });

  it('returns an empty array when nothing is unanswered', () => {
    const index = buildIndex({ docs: { a: { path: 'a.md', title: 'A', headings: [], outbound: [] } } });
    const blocks: Record<string, InteractiveBlocks> = { a: emptyBlocks() };
    expect(listUnansweredQuestionsTool(fixtureContext(index, blocks))).toEqual([]);
  });
});

describe('answerStatusTool', () => {
  it('found + answered: true, with answer text', () => {
    const index = buildIndex({ docs: { a: { path: 'a.md', title: 'A', headings: [], outbound: [] } } });
    const blocks: Record<string, InteractiveBlocks> = {
      a: {
        askMe: [{ directiveId: 'q1', type: 'yesno', prompt: 'Ship it?', answered: true, answerText: 'Yes', blockRange: { start: 0, end: 0 } }],
        actions: [],
        checkboxes: [],
      },
    };
    expect(answerStatusTool(fixtureContext(index, blocks), 'q1')).toEqual({
      matchType: 'found',
      answered: true,
      answerText: 'Yes',
      docId: 'a',
      docPath: 'a.md',
    });
  });

  it('found + answered: false, no answer text', () => {
    const index = buildIndex({ docs: { a: { path: 'a.md', title: 'A', headings: [], outbound: [] } } });
    const blocks: Record<string, InteractiveBlocks> = {
      a: {
        askMe: [{ directiveId: 'q1', type: 'yesno', prompt: 'Ship it?', answered: false, blockRange: { start: 0, end: 0 } }],
        actions: [],
        checkboxes: [],
      },
    };
    expect(answerStatusTool(fixtureContext(index, blocks), 'q1')).toEqual({
      matchType: 'found',
      answered: false,
      answerText: undefined,
      docId: 'a',
      docPath: 'a.md',
    });
  });

  it('not-found for an unknown directive id', () => {
    const index = buildIndex({ docs: { a: { path: 'a.md', title: 'A', headings: [], outbound: [] } } });
    const blocks: Record<string, InteractiveBlocks> = { a: emptyBlocks() };
    expect(answerStatusTool(fixtureContext(index, blocks), 'no-such-id')).toEqual({ matchType: 'not-found' });
  });

  it('ambiguous when 2+ docs share the same directive id -- fails loudly, never guesses', () => {
    const index = buildIndex({
      docs: {
        a: { path: 'a.md', title: 'A', headings: [], outbound: [] },
        b: { path: 'b.md', title: 'B', headings: [], outbound: [] },
      },
    });
    const blocks: Record<string, InteractiveBlocks> = {
      a: { askMe: [{ directiveId: 'dup', type: 'yesno', prompt: 'A?', answered: false, blockRange: { start: 0, end: 0 } }], actions: [], checkboxes: [] },
      b: { askMe: [{ directiveId: 'dup', type: 'yesno', prompt: 'B?', answered: false, blockRange: { start: 0, end: 0 } }], actions: [], checkboxes: [] },
    };
    expect(answerStatusTool(fixtureContext(index, blocks), 'dup')).toEqual({
      matchType: 'ambiguous',
      matches: [
        { docId: 'a', docPath: 'a.md' },
        { docId: 'b', docPath: 'b.md' },
      ],
    });
  });
});
