import type { ReactElement } from 'react';
import type { ActivityEvent } from '../api/client.js';

export interface LatestPanelProps {
  events: ActivityEvent[];
  onOpen: (event: ActivityEvent) => void;
}

export function relativeTime(ts: string | number, now = Date.now()): string {
  const then = typeof ts === 'number' ? ts : Date.parse(ts);
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(then).toISOString().slice(0, 10);
}

function iconFor(event: ActivityEvent): { glyph: string; className: string } {
  switch (event.kind) {
    case 'save':
      return { glyph: '✎', className: 'latest__icon' };
    case 'repair':
      // Repair events are how the user learns the fixer touched their files -- visually distinct.
      return { glyph: '⇄', className: 'latest__icon latest__icon--repair' };
    case 'rebuild':
      return { glyph: '⟳', className: 'latest__icon' };
    case 'session':
      return { glyph: '❯', className: 'latest__icon' };
    case 'check': {
      const failed = /fail|[1-9]\d*\s*(broken|stale)/i.test(`${event.summary} ${event.detail ?? ''}`);
      return failed
        ? { glyph: '✗', className: 'latest__icon latest__icon--bad' }
        : { glyph: '✓', className: 'latest__icon latest__icon--ok' };
    }
    default:
      return { glyph: '·', className: 'latest__icon' };
  }
}

const MAX_SHOWN = 12;

/** LATEST (design 2a, right column): the newest-first fixer/save/check feed. Rows carrying a
 * docKey deep-link into the reader. */
export function LatestPanel({ events, onOpen }: LatestPanelProps): ReactElement {
  return (
    <section aria-label="Latest activity">
      <div className="context-panel__section-head">
        <h2 className="panel__label">Latest</h2>
      </div>
      {events.length === 0 ? (
        <p className="latest__empty">No activity yet.</p>
      ) : (
        <div className="latest__list">
          {events.slice(0, MAX_SHOWN).map((event, i) => {
            const { glyph, className } = iconFor(event);
            const sub = [event.detail, relativeTime(event.ts)].filter(Boolean).join(' · ');
            const body = (
              <>
                <span className={className} aria-hidden="true">
                  {glyph}
                </span>
                <div>
                  <div className="latest__title">{event.summary}</div>
                  <div className="latest__sub">{sub}</div>
                </div>
              </>
            );
            return event.docKey ? (
              <button
                key={`${event.ts}-${i}`}
                type="button"
                className="latest__row latest__row--link"
                onClick={() => onOpen(event)}
                title={event.path ?? event.docKey}
              >
                {body}
              </button>
            ) : (
              <div key={`${event.ts}-${i}`} className="latest__row">
                {body}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
