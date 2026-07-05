// Pure function for the Ctrl+K link picker's insertion format (plan §7). Deliberately independent
// of the modal's DOM/keyboard-interaction plumbing (`LinkPickerModal.tsx`) so the insertion format
// itself gets a plain unit test, matching phase 2's own "DocView.test.tsx does DOM-level
// assertions, extractToc.test.ts does pure logic" split (plan §9.3).

import { computeExpectedHref } from 'chartroom/link-paths';
import type { DocSummary } from '../api/client.js';

/**
 * Computes the exact markdown link string to insert for "link the currently-open doc at
 * `currentDocPath` to `targetDoc`" — reuses phase-1's own `computeExpectedHref` (the same function
 * `fix-links.ts`/the indexer's own outbound-link staleness check use) so the freshly inserted link
 * is, by construction, never itself "stale" the moment it's inserted (plan §7).
 *
 * Link text: `selectedText` if the user had text selected at Ctrl+K time (standard "select text,
 * Ctrl+K to linkify" UX), otherwise the target doc's own title.
 *
 * Format matches phase 1's id-carrying link convention exactly (spec §2.2):
 * `[<link text>](<href> "id:<targetId>")` — a doc with no `id` (an `unidentified` entry) can still
 * be linked to by path, just without the `"id:..."` title attribute (there is no id to carry), so
 * the freshly-inserted link is a plain `[<link text>](<href>)` in that case.
 */
export function insertLink(currentDocPath: string, targetDoc: DocSummary, selectedText?: string): string {
  const href = computeExpectedHref(currentDocPath, targetDoc.path);
  const text = selectedText && selectedText.trim().length > 0 ? selectedText : targetDoc.title;
  if (targetDoc.id) {
    return `[${text}](${href} "id:${targetDoc.id}")`;
  }
  return `[${text}](${href})`;
}
