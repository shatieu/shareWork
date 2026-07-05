import type { ReactElement } from 'react';
import type { DocDetail } from '../api/client.js';

export interface FrontmatterPanelProps {
  detail: DocDetail | null;
}

/** Extracts simple scalar frontmatter pairs (`key: value`) worth showing -- no YAML dependency,
 * just the flat lines; nested/complex values are skipped on purpose (keep it simple). */
function scalarFrontmatter(raw: string): Array<[string, string]> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!match) return [];
  const out: Array<[string, string]> = [];
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.+)$/.exec(line);
    if (pair && !['id', 'title'].includes(pair[1])) out.push([pair[1], pair[2].trim()]);
  }
  return out.slice(0, 6);
}

/** FRONTMATTER (design 2a, right column): the current doc's stable coordinates. */
export function FrontmatterPanel({ detail }: FrontmatterPanelProps): ReactElement {
  const id = detail?.id ?? null;
  const extras = detail ? scalarFrontmatter(detail.raw) : [];

  return (
    <section aria-label="Frontmatter">
      <div className="context-panel__section-head">
        <h2 className="panel__label">Frontmatter</h2>
      </div>
      {!detail ? (
        <p className="latest__empty">No doc open.</p>
      ) : (
        <div className="frontmatter__rows">
          <div>
            <span className="frontmatter__key">id</span>
            {id ? id : <span className="frontmatter__none">— none</span>}
          </div>
          <div>
            <span className="frontmatter__key">path</span>
            {detail.doc.path}
          </div>
          <div>
            <span className="frontmatter__key">title</span>
            {detail.doc.title}
          </div>
          {extras.map(([key, value]) => (
            <div key={key}>
              <span className="frontmatter__key">{key}</span>
              {value}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
