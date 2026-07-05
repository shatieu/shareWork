import type { RepoState } from './repo-state.js';
import { findDoc } from './doc-lookup.js';

/**
 * One "needs you" item within a single repo: an unanswered `:::ask-me` question or an unchecked
 * `:::actions` checklist item. Repo-agnostic on purpose -- `routes/inbox.ts` decorates these with
 * repoId/repoName for the cross-repo inbox, while `routes/repos.ts` only needs `.length` for the
 * per-repo `needsYouCount` stat (wave-2 feature 3). Extracted from the inbox route rather than
 * duplicated so the two surfaces can never disagree about what "needs you" means.
 */
export interface NeedsYouItem {
  /** doc key (`id ?? path`, doc-lookup.ts convention). */
  docKey: string;
  docPath: string;
  kind: 'ask-me' | 'actions';
  directiveId: string;
  label: string;
  /** ask-me only. */
  type?: string;
}

/**
 * Pure in-memory aggregation over `state.interactiveBlocks` (keyed by doc key since wave 2, so
 * unidentified docs' questions/actions count too) -- no re-parsing on any read path.
 */
export function collectNeedsYou(state: RepoState): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];

  for (const [docKey, blocks] of Object.entries(state.interactiveBlocks)) {
    const found = findDoc(state, docKey);
    if (!found) continue;

    for (const question of blocks.askMe) {
      if (question.answered) continue;
      // An ask-me with no `{#id}` attribute can't be addressed by the PATCH ask-me route (it
      // requires a non-empty directiveId), so listing it would create a dead inbox item the user
      // can click but never answer. It still renders inside the doc itself; answering means
      // editing the doc (or giving the block an id).
      if (!question.directiveId) continue;
      items.push({
        docKey,
        docPath: found.entry.path,
        kind: 'ask-me',
        directiveId: question.directiveId,
        label: question.prompt,
        type: question.type,
      });
    }

    for (const action of blocks.actions) {
      if (action.checked) continue;
      items.push({
        docKey,
        docPath: found.entry.path,
        kind: 'actions',
        directiveId: action.directiveId,
        label: action.label,
      });
    }
  }

  return items;
}
