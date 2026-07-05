import type { DocEntry } from '../index-schema.js';
import type { RepoState } from './repo-state.js';

/**
 * The doc "key" convention shared with the UI (wave-2 API contract): a doc is addressed by
 * `key = id ?? path`. Identified docs keep their frontmatter id as the canonical key; id-less
 * ("unidentified") docs -- the overwhelming majority of real-world repos -- are addressed by their
 * repo-root-relative, forward-slash path instead, so they are just as openable/editable as
 * identified docs.
 */
export interface DocLookupResult {
  /** frontmatter id if this doc has one, else null. */
  id: string | null;
  /** canonical key: `id ?? path` -- what the UI should use in URLs regardless of how the caller
   * addressed the doc (an identified doc looked up *by path* still canonicalizes to its id). */
  key: string;
  entry: DocEntry;
}

/**
 * Resolve a route's `:docId` param to a doc, by the strict two-step lookup order (wave-2 contract):
 *
 *  1. exact id match in `index.docs`;
 *  2. exact repo-relative path match (backslashes normalized) across `index.docs` AND
 *     `index.unidentified`;
 *  3. give up -- return undefined.
 *
 * Deliberately **no** fuzzy fallback here (unlike `resolver.ts::resolve`'s 5-step algorithm): a
 * route param is a machine-generated address, not a human query, and silently opening the *wrong*
 * doc is strictly worse than a 404 the UI can render honestly.
 */
export function findDoc(state: RepoState, key: string): DocLookupResult | undefined {
  const byId = state.index.docs[key];
  if (byId) {
    return { id: key, key, entry: byId };
  }

  const normalizedPath = key.split('\\').join('/');
  for (const [id, entry] of Object.entries(state.index.docs)) {
    if (entry.path === normalizedPath) {
      return { id, key: id, entry };
    }
  }
  for (const entry of state.index.unidentified) {
    if (entry.path === normalizedPath) {
      return { id: null, key: entry.path, entry };
    }
  }

  return undefined;
}
