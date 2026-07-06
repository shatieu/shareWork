import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  ackShipQuestion,
  decideShipPermission,
  fetchShipInboxItems,
  type InboxItem,
  type ShipInboxItems,
  type ShipPermissionRequest,
} from '../api/client.js';
import { PermissionCard } from './PermissionCard.js';

export interface ShipInboxPageProps {
  /** Deep-links a Chart Room item to `#/repo/<repoId>/doc/<docId>` -- same mechanism as the
   * standalone InboxPage. */
  onNavigate: (repoId: string, docId: string) => void;
  /** Lets the shell refresh its inbox badge after an action here changes the counts. */
  onChanged?: () => void;
}

function groupByRepo(items: InboxItem[]): Map<string, InboxItem[]> {
  const groups = new Map<string, InboxItem[]>();
  for (const item of items) {
    const existing = groups.get(item.repoId);
    if (existing) existing.push(item);
    else groups.set(item.repoId, [item]);
  }
  return groups;
}

/**
 * The Deck's Inbox tab (Ship_Spec §5): ONE page aggregating everything that needs a human --
 * the permission queue (approve/deny/always-allow, resolved live into waiting sessions via the
 * resolver hook's long-poll), agent questions from Notification hooks, and Chart Room's
 * unanswered ask-me / open actions items (deep-linked to their docs; answering stays on the doc
 * page).
 */
export function ShipInboxPage({ onNavigate, onChanged }: ShipInboxPageProps): ReactElement {
  const [items, setItems] = useState<ShipInboxItems | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchShipInboxItems()
      .then((next) => {
        setItems(next);
        setError(null);
      })
      .catch((err: unknown) => setError(String(err)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const afterAction = useCallback(() => {
    setActionError(null);
    refresh();
    onChanged?.();
  }, [refresh, onChanged]);

  const handleDecide = useCallback(
    (request: ShipPermissionRequest, behavior: 'allow' | 'deny', alwaysAllowRule?: string) => {
      decideShipPermission(request.id, { behavior, alwaysAllowRule })
        .then(afterAction)
        .catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)));
    },
    [afterAction],
  );

  const handleAck = useCallback(
    (id: string) => {
      ackShipQuestion(id)
        .then(afterAction)
        .catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)));
    },
    [afterAction],
  );

  if (error) {
    return <p className="app-shell__error">{error}</p>;
  }
  if (!items) {
    return <p className="inbox-page__loading">Loading inbox…</p>;
  }

  const empty = items.permissions.length === 0 && items.questions.length === 0 && items.docs.length === 0;
  const docGroups = groupByRepo(items.docs);

  return (
    <div className="inbox-page ship-inbox">
      <h1>Inbox</h1>
      {actionError && (
        <p className="app-shell__error" role="alert">
          {actionError}
        </p>
      )}
      {empty && <p className="inbox-page__empty">Nothing needs your attention right now.</p>}

      {items.permissions.length > 0 && (
        <section className="inbox-page__group" aria-label="Permission requests">
          <h2 className="inbox-page__repo-name">Permission requests</h2>
          <ul className="inbox-page__list">
            {items.permissions.map((request) => (
              <li key={request.id} className="inbox-page__item">
                <PermissionCard request={request} onDecide={handleDecide} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {items.questions.length > 0 && (
        <section className="inbox-page__group" aria-label="Agent questions">
          <h2 className="inbox-page__repo-name">Agent questions</h2>
          <ul className="inbox-page__list">
            {items.questions.map((question) => (
              <li key={question.id} className="inbox-page__item ship-inbox__question">
                <div className="ship-inbox__question-body">
                  <span className={`inbox-page__kind ship-inbox__kind--${question.kind}`}>{question.kind}</span>
                  <span className="inbox-page__label">{question.message || '(no message)'}</span>
                  <span className="inbox-page__doc-path">
                    {question.project ?? question.cwd} · session {question.sessionId.slice(0, 8)}
                  </span>
                </div>
                <button
                  type="button"
                  className="ship-inbox__btn"
                  onClick={() => handleAck(question.id)}
                  aria-label={`Dismiss question ${question.message}`}
                >
                  dismiss
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {items.docs.length > 0 && (
        <section className="inbox-page__group" aria-label="Docs needing you">
          <h2 className="inbox-page__repo-name">Docs needing you</h2>
          {[...docGroups.entries()].map(([repoId, repoItems]) => (
            <div key={repoId}>
              <h3 className="ship-inbox__repo">{repoItems[0].repoName}</h3>
              <ul className="inbox-page__list">
                {repoItems.map((item) => (
                  <li key={`${item.docId}-${item.directiveId}`} className="inbox-page__item">
                    <button
                      type="button"
                      className="inbox-page__item-button"
                      onClick={() => onNavigate(item.repoId, item.docId)}
                    >
                      <span className={`inbox-page__kind inbox-page__kind--${item.kind}`}>
                        {item.kind === 'ask-me' ? 'Question' : 'Action'}
                      </span>
                      <span className="inbox-page__label">{item.label}</span>
                      <span className="inbox-page__doc-path">{item.docPath}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
