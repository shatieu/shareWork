import type { ReactElement } from 'react';
import type { BacklinkEntry } from '../api/client.js';

export interface BacklinksPanelProps {
  repoId: string;
  backlinks: BacklinkEntry[];
  onSelectDoc: (docId: string) => void;
}

/** Renders the backlinks list for the current doc (plan §6.3) -- clicking a backlink navigates
 * within the same repo via the app's hash-route dispatch (no page reload). */
export function BacklinksPanel({ repoId: _repoId, backlinks, onSelectDoc }: BacklinksPanelProps): ReactElement {
  return (
    <section className="backlinks-panel">
      <h2>Backlinks</h2>
      {backlinks.length === 0 ? (
        <p className="backlinks-panel__empty">No other docs link here yet.</p>
      ) : (
        <ul>
          {backlinks.map((b) => (
            <li key={b.id}>
              <button type="button" className="backlinks-panel__link" onClick={() => onSelectDoc(b.id)}>
                {b.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
