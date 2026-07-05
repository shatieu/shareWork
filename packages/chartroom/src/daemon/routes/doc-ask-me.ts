import { readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  applyAskMeAnswer,
  extractInteractiveBlocks,
  formatAnswerLine,
  validateAnswerValue,
  type AskMeAnswerValue,
} from '../../interactive-blocks.js';
import { rebuild } from '../repo-state.js';
import { findDoc } from '../doc-lookup.js';
import type { RepoRuntime } from '../server.js';

function findRepo(repos: RepoRuntime[], repoId: string): RepoRuntime | undefined {
  return repos.find((repo) => repo.id === repoId);
}

interface AskMeBody {
  directiveId?: string;
  value?: unknown;
  author?: string;
}

function isPlausibleValueShape(value: unknown): value is AskMeAnswerValue {
  return typeof value === 'string' || typeof value === 'number' || Array.isArray(value);
}

/** `os.userInfo().username` fallback (plan §3.5/§11 item 4) -- wrapped defensively since some
 * sandboxed/containerized environments can throw rather than return a username. */
function resolveAuthor(clientSupplied: string | undefined): string {
  if (clientSupplied && clientSupplied.trim().length > 0) return clientSupplied.trim();
  try {
    return userInfo().username || 'unknown';
  } catch {
    return 'unknown';
  }
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * `PATCH /api/repos/:repoId/docs/:docId/ask-me` (plan §3.2) -- re-reads the file fresh from disk,
 * locates the `:::ask-me` block by `directiveId`, formats a human-readable answer line (plan §3.6),
 * and splices only that block's own `{start, end}` span (plan §3.5). Rejects a second answer
 * attempt against an already-`answered="true"` block with `409` (plan §3.7) -- kept simple, one
 * question, one answer, rather than silently overwriting or accumulating multiple answer lines.
 */
export function registerDocAskMeRoute(app: FastifyInstance, repos: RepoRuntime[]): void {
  app.patch('/api/repos/:repoId/docs/:docId/ask-me', async (request, reply) => {
    const { repoId, docId } = request.params as { repoId: string; docId: string };
    const repo = findRepo(repos, repoId);
    if (!repo) {
      return reply.code(404).send({ error: `unknown repo '${repoId}'` });
    }

    const state = repo.getState();
    // v1.1: `:docId` is a doc key (`id ?? path`) -- unidentified docs' questions are answerable too.
    const found = findDoc(state, docId);
    if (!found) {
      return reply.code(404).send({ error: `unknown doc '${docId}' in repo '${repoId}'` });
    }

    const body = request.body as AskMeBody | undefined;
    if (!body || typeof body.directiveId !== 'string' || body.directiveId.length === 0 || !('value' in body)) {
      return reply.code(400).send({ error: 'request body must be JSON { directiveId: string, value: <type-shaped>, author?: string }' });
    }
    if (!isPlausibleValueShape(body.value)) {
      return reply.code(400).send({ error: 'value must be a string, number, or array of strings' });
    }

    const absPath = join(repo.absPath, found.entry.path);
    const raw = readFileSync(absPath, 'utf8');

    const { askMe } = extractInteractiveBlocks(raw);
    const matches = askMe.filter((q) => q.directiveId === body.directiveId);
    // `.find()` always resolves to the first match -- against a doc with two `:::ask-me` blocks
    // sharing the same `id` (authoring mistake, or a copy-pasted block never re-numbered), that
    // would silently answer whichever one happens to come first while the second stays forever
    // unreachable via this route. Fail loudly instead of guessing which block the caller meant.
    if (matches.length > 1) {
      return reply.code(409).send({
        error: `ambiguous ask-me directive id '${body.directiveId}': ${matches.length} blocks in doc '${docId}' share this id, refusing to guess which one to answer`,
      });
    }
    const question = matches[0];
    if (!question) {
      return reply.code(404).send({ error: `unknown ask-me directive id '${body.directiveId}' in doc '${docId}'` });
    }
    if (question.answered) {
      return reply.code(409).send({ error: 'this ask-me block has already been answered' });
    }
    if (!validateAnswerValue(question, body.value)) {
      return reply.code(400).send({ error: `value shape does not match question type '${question.type}'` });
    }

    const author = resolveAuthor(body.author);
    const answerLine = formatAnswerLine(question, body.value, todayDate(), author);
    const result = applyAskMeAnswer(raw, body.directiveId, answerLine);
    if (!result) {
      return reply.code(404).send({ error: `unknown ask-me directive id '${body.directiveId}' in doc '${docId}'` });
    }

    writeFileSync(absPath, result.newText, 'utf8');

    const newState = rebuild(repo.absPath);
    repo.setState(newState);

    return { ok: true, answered: true, answerText: answerLine };
  });
}
