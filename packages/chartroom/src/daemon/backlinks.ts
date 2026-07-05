import type { ChartRoomIndex } from '../index-schema.js';

export interface BacklinkEntry {
  id: string;
  path: string;
  title: string;
}

/**
 * Invert every doc's `outbound[].targetId` into a `{id, path, title}` entry keyed by the target
 * id (plan §6.3). Only links that resolve to a *live* `docs[id]` entry contribute a backlink --
 * a link to a tombstoned or not-found id produces no backlink entry. Only id-keyed docs (i.e.
 * `index.docs`, not `index.unidentified`) can be a backlink *source*, since a `BacklinkEntry`
 * itself requires an `id`.
 */
export function computeBacklinks(index: ChartRoomIndex): Record<string, BacklinkEntry[]> {
  const backlinks: Record<string, BacklinkEntry[]> = {};

  for (const [id, doc] of Object.entries(index.docs)) {
    for (const link of doc.outbound) {
      if (!link.targetId) continue;
      if (!index.docs[link.targetId]) continue; // tombstoned/not-found targets contribute nothing

      const entry: BacklinkEntry = { id, path: doc.path, title: doc.title };
      const list = backlinks[link.targetId];
      if (list) {
        list.push(entry);
      } else {
        backlinks[link.targetId] = [entry];
      }
    }
  }

  return backlinks;
}
