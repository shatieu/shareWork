import { useEffect, useState, type ReactElement } from 'react';
import { fetchInbox, type InboxItem } from '../api/client.js';

export interface InboxPageProps {
  /** Deep-links an inbox item to `#/repo/<repoId>/doc/<docId>` (plan §6.2), reusing `App.tsx`'s
   * existing hash-navigation mechanism verbatim -- no new router dependency. */
  onNavigate: (repoId: string, docId: string) => void;
}

function groupByRepo(items: InboxItem[]): Map<string, InboxItem[]> {
  const groups = new Map<string, InboxItem[]>();
  for (const item of items) {
    const existing = groups.get(item.repoId);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(item.repoId, [item]);
    }
  }
  return groups;
}

/**
 * The cross-repo human-action inbox page (plan §6.2) -- a flat `GET /api/inbox` result, grouped by
 * repo for display. Clicking an item deep-links directly to the doc containing the unanswered
 * question/unchecked action (no auto-scroll-to-directive in this phase, plan §6.2's own named gap).
 */
export function InboxPage({ onNavigate }: InboxPageProps): ReactElement {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchInbox()
      .then(setItems)
      .catch((err: unknown) => setError(String(err)));
  }, []);

  if (error) {
    return <p className="app-shell__error">{error}</p>;
  }
  if (!items) {
    return <p className="inbox-page__loading">Loading inbox…</p>;
  }
  if (items.length === 0) {
    return (
      <div className="inbox-page">
        <h1>Inbox</h1>
        <p className="inbox-page__empty">Nothing needs your attention right now.</p>
      </div>
    );
  }

  const groups = groupByRepo(items);

  return (
    <div className="inbox-page">
      <h1>Inbox</h1>
      {[...groups.entries()].map(([repoId, repoItems]) => (
        <section key={repoId} className="inbox-page__group">
          <h2 className="inbox-page__repo-name">{repoItems[0].repoName}</h2>
          <ul className="inbox-page__list">
            {repoItems.map((item) => (
              <li key={`${item.docId}-${item.directiveId}`} className="inbox-page__item">
                <button type="button" className="inbox-page__item-button" onClick={() => onNavigate(item.repoId, item.docId)}>
                  <span className={`inbox-page__kind inbox-page__kind--${item.kind}`}>
                    {item.kind === 'ask-me' ? 'Question' : 'Action'}
                  </span>
                  <span className="inbox-page__label">{item.label}</span>
                  <span className="inbox-page__doc-path">{item.docPath}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
