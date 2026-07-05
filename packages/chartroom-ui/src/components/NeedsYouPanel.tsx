import type { ReactElement } from 'react';
import type { InboxItem } from '../api/client.js';

export interface NeedsYouPanelProps {
  items: InboxItem[];
  /** ask-me card "Answer →": deep-links to The Ask screen with this item selected. */
  onAnswer: (item: InboxItem) => void;
  /** actions checklist row: opens the doc in the reader to check it off in context. */
  onOpenDoc: (item: InboxItem) => void;
  onViewAll: () => void;
}

const MAX_SHOWN = 5;

/** NEEDS YOU (design 2a, right column): unanswered ask-me questions as rust-bordered cards plus
 * unchecked actions as checklist rows, capped at 5 with a "view all →" into The Ask screen. */
export function NeedsYouPanel({ items, onAnswer, onOpenDoc, onViewAll }: NeedsYouPanelProps): ReactElement {
  const shown = items.slice(0, MAX_SHOWN);
  let firstAskSeen = false;

  return (
    <section aria-label="Needs you">
      <div className="context-panel__section-head">
        <h2 className="panel__label">Needs you</h2>
        <span className="context-panel__spacer" />
        {items.length > 0 && <span className="badge-count">{items.length}</span>}
      </div>
      {items.length === 0 ? (
        <p className="needs-you__empty">Nothing needs your attention.</p>
      ) : (
        <div className="needs-you__list">
          {shown.map((item) => {
            if (item.kind === 'ask-me') {
              const hot = !firstAskSeen;
              firstAskSeen = true;
              return (
                <div
                  key={`${item.repoId}-${item.docId}-${item.directiveId}`}
                  className={hot ? 'needs-you__card needs-you__card--hot' : 'needs-you__card'}
                >
                  <div className="needs-you__from">✦ claude · {item.repoName}</div>
                  <div className="needs-you__q">{item.label}</div>
                  <button type="button" className="needs-you__answer" onClick={() => onAnswer(item)}>
                    Answer →
                  </button>
                </div>
              );
            }
            return (
              <button
                key={`${item.repoId}-${item.docId}-${item.directiveId}`}
                type="button"
                className="needs-you__action"
                onClick={() => onOpenDoc(item)}
                title={item.docPath}
              >
                <span className="needs-you__action-cb" aria-hidden="true" />
                Action: {item.label}
              </button>
            );
          })}
          {items.length > MAX_SHOWN && (
            <button type="button" className="needs-you__view-all" onClick={onViewAll}>
              view all {items.length} →
            </button>
          )}
          {items.length > 0 && items.length <= MAX_SHOWN && (
            <button type="button" className="needs-you__view-all" onClick={onViewAll}>
              view all →
            </button>
          )}
        </div>
      )}
    </section>
  );
}
