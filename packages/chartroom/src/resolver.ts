import { basename } from 'node:path';
import type { ChartRoomIndex } from './index-schema.js';

export type ResolveResult =
  | { matchType: 'id'; id: string; path: string }
  | { matchType: 'path'; id?: string; path: string }
  | { matchType: 'filename'; id?: string; path: string }
  | { matchType: 'fuzzy'; id?: string; path: string; guess: true }
  | { matchType: 'tombstone'; id: string; lastPath: string; deletedAt: string }
  | { matchType: 'not-found' };

/** Conservative fuzzy-match thresholds (plan §6.1 step 4 / §10 risk #2): the winner must clear an
 * absolute floor, and beat the runner-up by a meaningful margin, or we don't guess at all. */
const FUZZY_MIN_SCORE = 0.5;
const FUZZY_MIN_MARGIN = 0.15;

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, '') // strip file extension if present
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0),
  );
}

/** Dice coefficient over lowercased word-token sets — small, dependency-free fuzzy heuristic
 * (plan §1.4/§6.1 step 4: no new fuzzy-matching dependency). */
function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection += 1;
  }
  return (2 * intersection) / (a.size + b.size);
}

/**
 * The 5-step resolution algorithm, exactly per spec §2.4 / plan §6.1, as a pure function over an
 * in-memory index. Caller is responsible for keeping the index fresh (plan §6.3 "always-fresh" rule).
 */
export function resolve(index: ChartRoomIndex, query: string): ResolveResult {
  // Step 1: id lookup.
  if (Object.prototype.hasOwnProperty.call(index.docs, query)) {
    return { matchType: 'id', id: query, path: index.docs[query].path };
  }

  // Step 2: path as written (exact match against a doc's current path).
  const normalizedQuery = query.split('\\').join('/');
  for (const [id, doc] of Object.entries(index.docs)) {
    if (doc.path === normalizedQuery) {
      return { matchType: 'path', id, path: doc.path };
    }
  }

  // Step 3: unique filename match — ambiguous (2+ matches) falls through, does not match.
  const queryBase = basename(normalizedQuery);
  const filenameMatches = Object.entries(index.docs).filter(([, doc]) => basename(doc.path) === queryBase);
  if (filenameMatches.length === 1) {
    const [id, doc] = filenameMatches[0];
    return { matchType: 'filename', id, path: doc.path };
  }

  // Step 4: fuzzy title match — conservative threshold + unambiguous margin required.
  const queryTokens = tokenize(basename(normalizedQuery, '.md'));
  const scored = Object.entries(index.docs)
    .map(([id, doc]) => ({ id, doc, score: diceCoefficient(queryTokens, tokenize(doc.title)) }))
    .sort((a, b) => b.score - a.score);
  if (scored.length > 0 && scored[0].score >= FUZZY_MIN_SCORE) {
    const runnerUpScore = scored.length > 1 ? scored[1].score : 0;
    if (scored[0].score - runnerUpScore >= FUZZY_MIN_MARGIN) {
      return { matchType: 'fuzzy', id: scored[0].id, path: scored[0].doc.path, guess: true };
    }
  }

  // Step 5: tombstone / not-found.
  if (Object.prototype.hasOwnProperty.call(index.deleted, query)) {
    const deleted = index.deleted[query];
    return { matchType: 'tombstone', id: query, lastPath: deleted.lastPath, deletedAt: deleted.deletedAt };
  }
  return { matchType: 'not-found' };
}
