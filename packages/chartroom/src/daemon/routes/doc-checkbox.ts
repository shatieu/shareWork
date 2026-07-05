import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { applyCheckboxToggle, type CheckboxScope } from '../../interactive-blocks.js';
import { rebuild } from '../repo-state.js';
import { findDoc } from '../doc-lookup.js';
import type { RepoRuntime } from '../server.js';

function findRepo(repos: RepoRuntime[], repoId: string): RepoRuntime | undefined {
  return repos.find((repo) => repo.id === repoId);
}

interface CheckboxBody {
  scope?: { directiveId?: string | null; index?: number };
  checked?: boolean;
  expectedCurrent?: boolean;
}

function isValidBody(body: unknown): body is Required<Pick<CheckboxBody, 'checked' | 'expectedCurrent'>> & {
  scope: CheckboxScope;
} {
  if (!body || typeof body !== 'object') return false;
  const b = body as CheckboxBody;
  if (typeof b.checked !== 'boolean' || typeof b.expectedCurrent !== 'boolean') return false;
  if (!b.scope || typeof b.scope !== 'object') return false;
  if (b.scope.directiveId !== null && typeof b.scope.directiveId !== 'string') return false;
  if (typeof b.scope.index !== 'number' || !Number.isInteger(b.scope.index) || b.scope.index < 0) return false;
  return true;
}

/**
 * `PATCH /api/repos/:repoId/docs/:docId/checkbox` (plan §3.2) -- a narrow, server-side single-
 * checkbox splice. The client sends only a stable *address* (`scope`) plus the desired new value;
 * this route re-reads the file fresh from disk, re-parses it via `interactive-blocks.ts`, locates
 * the exact checkbox, and (only on an `expectedCurrent` match) writes a minimal one-character
 * splice -- never a client-trusted whole-file replacement (plan §3.2, rejecting a reuse of phase
 * 3's client-side `roundTrip.ts` reconstruction path for this purpose).
 *
 * Covers both a bare, undirected GFM checklist item (`scope.directiveId: null`) and a `:::actions`
 * item (`scope.directiveId` = that directive's own `id`) with the same addressing scheme and zero
 * special-casing between them (plan §3.2).
 */
export function registerDocCheckboxRoute(app: FastifyInstance, repos: RepoRuntime[]): void {
  app.patch('/api/repos/:repoId/docs/:docId/checkbox', async (request, reply) => {
    const { repoId, docId } = request.params as { repoId: string; docId: string };
    const repo = findRepo(repos, repoId);
    if (!repo) {
      return reply.code(404).send({ error: `unknown repo '${repoId}'` });
    }

    const state = repo.getState();
    // v1.1: `:docId` is a doc key (`id ?? path`) -- unidentified docs' checkboxes toggle too.
    const found = findDoc(state, docId);
    if (!found) {
      return reply.code(404).send({ error: `unknown doc '${docId}' in repo '${repoId}'` });
    }

    if (!isValidBody(request.body)) {
      return reply.code(400).send({
        error: 'request body must be JSON { scope: { directiveId: string|null, index: number }, checked: boolean, expectedCurrent: boolean }',
      });
    }
    const body = request.body as { scope: CheckboxScope; checked: boolean; expectedCurrent: boolean };

    const absPath = join(repo.absPath, found.entry.path);
    const raw = readFileSync(absPath, 'utf8');

    const result = applyCheckboxToggle(raw, body.scope, body.checked);
    if (!result) {
      return reply.code(404).send({ error: 'no checkbox found at the given scope' });
    }
    if (result.before !== body.expectedCurrent) {
      return reply.code(409).send({ error: 'checkbox state changed since it was last read', current: result.before });
    }

    writeFileSync(absPath, result.newText, 'utf8');

    const newState = rebuild(repo.absPath);
    repo.setState(newState);

    return { ok: true, checked: body.checked };
  });
}
