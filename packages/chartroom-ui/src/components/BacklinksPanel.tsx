import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react';
import type { BacklinkEntry } from '../api/client.js';

export interface BacklinksPanelProps {
  repoId: string;
  backlinks: BacklinkEntry[];
  onSelectDoc: (docId: string) => void;
}

/** Renders the backlinks list for the current doc (plan §6.3). Real `<a href>`s to the hash route
 * so ctrl/middle-click opens a new tab like any browser link; a plain left click is intercepted
 * for in-app navigation (no page reload). */
export function BacklinksPanel({ repoId, backlinks, onSelectDoc }: BacklinksPanelProps): ReactElement {
  function handleClick(event: ReactMouseEvent<HTMLAnchorElement>, id: string): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onSelectDoc(id);
  }

  return (
    <section className="backlinks-panel">
      <h2>Backlinks</h2>
      {backlinks.length === 0 ? (
        <p className="backlinks-panel__empty">No other docs link here yet.</p>
      ) : (
        <ul>
          {backlinks.map((b) => (
            <li key={b.id}>
              <a
                className="backlinks-panel__link"
                href={`#/repo/${encodeURIComponent(repoId)}/doc/${encodeURIComponent(b.id)}`}
                onClick={(event) => handleClick(event, b.id)}
              >
                {b.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
