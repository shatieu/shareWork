import { useMemo, type ReactElement } from 'react';
import type { DocSummary } from '../api/client.js';
import { extractToc } from '../toc/extractToc.js';

export interface SidebarProps {
  docs: DocSummary[];
  activeDocId?: string;
  onSelectDoc: (docId: string) => void;
  /** current doc's raw markdown (frontmatter included, extractToc doesn't care) -- used to derive
   * the "on this page" TOC outline; undefined when no doc is open yet. */
  raw?: string;
}

/**
 * Doc list + TOC (plan §3, consuming §1.6's `extractToc` pre-pass output). TOC anchor links
 * deliberately don't mutate `window.location.hash` (that fragment is already the app's own
 * route -- `#/repo/<repoId>/doc/<docId>`, plan §1.7); instead they scroll the matching heading
 * element into view directly, using the exact same slug `rehype-slug` assigned as that heading's
 * `id` during DocView's render, so TOC links and in-document anchors always agree (plan §6.2)
 * without clobbering the route hash.
 */
export function Sidebar({ docs, activeDocId, onSelectDoc, raw }: SidebarProps): ReactElement {
  const toc = useMemo(() => (raw ? extractToc(raw) : []), [raw]);

  return (
    <nav className="sidebar" aria-label="Doc navigation">
      <h2 className="sidebar__heading">Docs</h2>
      <ul className="sidebar__doc-list">
        {docs
          .filter((doc): doc is DocSummary & { id: string } => doc.id !== null)
          .map((doc) => (
            <li key={doc.id}>
              <button
                type="button"
                className={
                  doc.id === activeDocId ? 'sidebar__doc-link sidebar__doc-link--active' : 'sidebar__doc-link'
                }
                onClick={() => onSelectDoc(doc.id)}
              >
                {doc.title}
              </button>
            </li>
          ))}
      </ul>

      {toc.length > 0 && (
        <>
          <h2 className="sidebar__heading">On this page</h2>
          <ul className="sidebar__toc">
            {toc.map((entry, i) => (
              <li key={`${entry.slug}-${i}`} style={{ paddingLeft: `${(entry.depth - 1) * 12}px` }}>
                <a
                  href={`#${entry.slug}`}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(entry.slug)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  {entry.text}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </nav>
  );
}
