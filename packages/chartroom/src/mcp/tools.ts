// Plan §3: five pure, independently-testable tool-implementation functions against a
// `ToolRepoContext` (repo-context.ts). `mcp/server.ts`'s `registerTool` callbacks are thin wrappers
// around these -- the same "thin route/registration layer over a pure, testable function" split
// this project has used consistently since phase 1 (`check.ts`/`resolver.ts` are the same shape
// one layer down).

import { resolve, type ResolveResult, tokenize, diceCoefficient } from '../resolver.js';
import type { AskMeQuestion } from '../interactive-blocks.js';
import type { ToolRepoContext } from './repo-context.js';

/** 3.1 `resolve(query)` -- thin wrapper over `resolver.ts::resolve`, unmodified (plan §3.1). No
 * reshaping: `ResolveResult`'s own `matchType` union is returned verbatim, the same vocabulary the
 * CLI's own `--json` output already presents. */
export function resolveTool(ctx: ToolRepoContext, query: string): ResolveResult {
  return resolve(ctx.getIndex(), query);
}

/** 3.2 `read_doc(id)` result shape -- a structured answer for every case (found / tombstone /
 * not-found), never a thrown MCP tool error, matching the project's "never a silent 404, always a
 * structured answer" philosophy applied at the MCP layer too (plan §3.2). */
export type ReadDocResult =
  | { matchType: 'found'; id: string; path: string; title: string; headings: string[]; raw: string }
  | { matchType: 'tombstone'; id: string; lastPath: string; deletedAt: string }
  | { matchType: 'not-found'; id: string };

/**
 * `read_doc(id)` -- id lookup only (plan §3.2), not the full 5-step resolver; an agent calling this
 * is expected to already have a specific id (typically from a prior `resolve`/`search` call, or a
 * link's own `title="id:..."` attribute).
 */
export function readDocTool(ctx: ToolRepoContext, id: string): ReadDocResult {
  const index = ctx.getIndex();
  const doc = index.docs[id];
  if (doc) {
    const raw = ctx.readDocRaw(doc.path);
    return { matchType: 'found', id, path: doc.path, title: doc.title, headings: doc.headings, raw };
  }
  const deleted = index.deleted[id];
  if (deleted) {
    return { matchType: 'tombstone', id, lastPath: deleted.lastPath, deletedAt: deleted.deletedAt };
  }
  return { matchType: 'not-found', id };
}

export interface SearchResultItem {
  id: string;
  path: string;
  title: string;
  score: number;
}

/**
 * 3.3 `search(query, limit)` -- discovery over title/headings only, not full-text body search
 * (plan §3.3, a deliberate scope decision: `Grep` already covers body search per the project's own
 * "every mechanism must work for an agent using nothing but Read and Grep" north star). Reuses
 * `resolver.ts`'s own Dice-coefficient token-overlap heuristic, scored against a doc's `title` and
 * each of its `headings[]`, taking the best of the two per doc. Ties are broken by `id` for a
 * deterministic, test-stable ordering.
 */
export function searchTool(ctx: ToolRepoContext, query: string, limit = 10): SearchResultItem[] {
  const index = ctx.getIndex();
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) return [];

  const scored: SearchResultItem[] = [];
  for (const [id, doc] of Object.entries(index.docs)) {
    const titleScore = diceCoefficient(queryTokens, tokenize(doc.title));
    let bestHeadingScore = 0;
    for (const heading of doc.headings) {
      const score = diceCoefficient(queryTokens, tokenize(heading));
      if (score > bestHeadingScore) bestHeadingScore = score;
    }
    const score = Math.max(titleScore, bestHeadingScore);
    if (score > 0) scored.push({ id, path: doc.path, title: doc.title, score });
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, Math.max(0, limit));
}

export interface UnansweredQuestion {
  docId: string;
  docPath: string;
  directiveId: string;
  prompt: string;
  type: string;
}

/**
 * 3.4 `list_unanswered_questions()` -- scoped to `:::ask-me` questions only, never `:::actions`
 * checklist items (plan §3.4: a deliberate reading of the tool's own name and its sibling tool's
 * singular "question" vocabulary -- `:::actions` items have no per-item "answer", only a
 * checked/unchecked boolean, a structurally different shape). Thin wrapper over phase 4's own
 * `interactive-blocks.ts` extraction, already computed by the context (`getInteractiveBlocks()`).
 */
export function listUnansweredQuestionsTool(ctx: ToolRepoContext): UnansweredQuestion[] {
  const index = ctx.getIndex();
  const blocksById = ctx.getInteractiveBlocks();
  const results: UnansweredQuestion[] = [];

  for (const [docId, blocks] of Object.entries(blocksById)) {
    const doc = index.docs[docId];
    if (!doc) continue;
    for (const question of blocks.askMe) {
      if (question.answered) continue;
      results.push({
        docId,
        docPath: doc.path,
        directiveId: question.directiveId,
        prompt: question.prompt,
        type: question.type,
      });
    }
  }
  return results;
}

export type AnswerStatusResult =
  | { matchType: 'found'; answered: boolean; answerText?: string; docId: string; docPath: string }
  | { matchType: 'ambiguous'; matches: Array<{ docId: string; docPath: string }> }
  | { matchType: 'not-found' };

/**
 * 3.5 `answer_status(question_id)` -- read-only status *check*, never an answer-*submission* tool
 * (plan §3.5: there is no MCP tool to submit an answer -- posting a question is a plain file edit
 * an agent already knows how to do, and answering is deliberately a human-in-the-browser action,
 * phase 4, never duplicated as an agent-triggerable MCP tool). Locates the `:::ask-me` directive
 * with `directiveId === questionId` across every doc in the repo; if 2+ directives anywhere in the
 * repo share the same author-chosen id, returns `{ matchType: 'ambiguous' }` rather than guessing
 * which one the caller meant (mirrors phase 4's own `doc-ask-me.ts` route's "fail loudly, don't
 * guess" precedent for the same underlying ambiguity, applied across docs rather than within one).
 */
export function answerStatusTool(ctx: ToolRepoContext, questionId: string): AnswerStatusResult {
  const index = ctx.getIndex();
  const blocksById = ctx.getInteractiveBlocks();

  const matches: Array<{ docId: string; docPath: string; question: AskMeQuestion }> = [];
  for (const [docId, blocks] of Object.entries(blocksById)) {
    const doc = index.docs[docId];
    if (!doc) continue;
    for (const question of blocks.askMe) {
      if (question.directiveId === questionId) {
        matches.push({ docId, docPath: doc.path, question });
      }
    }
  }

  if (matches.length === 0) return { matchType: 'not-found' };
  if (matches.length > 1) {
    return { matchType: 'ambiguous', matches: matches.map((m) => ({ docId: m.docId, docPath: m.docPath })) };
  }

  const [match] = matches;
  return {
    matchType: 'found',
    answered: match.question.answered,
    answerText: match.question.answerText,
    docId: match.docId,
    docPath: match.docPath,
  };
}
