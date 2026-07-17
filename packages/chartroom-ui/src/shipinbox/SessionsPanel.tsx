import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  fetchSessionsOverview,
  sendTextToSession,
  setSessionWatched,
  type InboxConsoleOverview,
  type InboxConsoleSession,
} from '../api/inboxClient.js';

export interface SessionsPanelProps {
  /** Lets the shell refresh badges after a watch flip. */
  onChanged?: () => void;
}

interface SessionRowProps {
  session: InboxConsoleSession;
  onSend: (sessionId: string, text: string) => Promise<void>;
  onWatch: (sessionId: string, watched: boolean) => void;
}

function SessionRow({ session, onSend, onWatch }: SessionRowProps): ReactElement {
  const [messageOpen, setMessageOpen] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSend(): Promise<void> {
    setSending(true);
    setError(null);
    try {
      await onSend(session.sessionId, text.trim());
      setNote('Sent to the session’s transcript — picked up when it next resumes, not mid-task.');
      setText('');
      setMessageOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="ship-inbox__session">
      <div className="ship-inbox__question-body">
        <span className="inbox-page__label">
          {session.name} <span className="inbox-page__kind">{session.state}</span>
        </span>
        <span className="inbox-page__doc-path">
          {session.cwd ?? '(unknown cwd)'} · session {session.sessionId.slice(0, 8)}
        </span>
        {note && (
          <span className="ship-inbox__always-note" role="status">
            {note}
          </span>
        )}
      </div>
      <div className="ship-inbox__actions">
        {session.watched ? (
          <>
            <button
              type="button"
              className="ship-inbox__btn"
              aria-expanded={messageOpen}
              onClick={() => setMessageOpen((open) => !open)}
            >
              message…
            </button>
            <button
              type="button"
              className="ship-inbox__btn"
              onClick={() => onWatch(session.sessionId, false)}
              aria-label={`Unwatch session ${session.name}`}
            >
              unwatch
            </button>
          </>
        ) : (
          <button
            type="button"
            className="ship-inbox__btn"
            onClick={() => onWatch(session.sessionId, true)}
            aria-label={`Rewatch session ${session.name}`}
          >
            rewatch
          </button>
        )}
      </div>
      {messageOpen && (
        <div className="ship-inbox__always">
          <label className="ship-inbox__always-label">
            message to {session.name}
            <textarea
              className="ship-inbox__rule-input"
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-label={`Message to session ${session.name}`}
              rows={3}
            />
          </label>
          <button
            type="button"
            className="ship-inbox__btn ship-inbox__btn--allow"
            disabled={text.trim().length === 0 || sending}
            onClick={() => void handleSend()}
          >
            {sending ? 'sending…' : 'send'}
          </button>
          <p className="ship-inbox__always-note">
            Lands on the session&#8217;s transcript (a resume turn), not inside the running task.
          </p>
          {error && (
            <p className="app-shell__error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Tracked sessions on the inbox page (wave2-E, defect D4): a session-shaped surface -- free-text
 * send to ANY tracked session plus the unwatch/rewatch affordance backed by ship-log's persisted
 * flag. Renders nothing when no console station is mounted (fetch fails) -- the inbox's other
 * sections must never depend on it.
 */
export function SessionsPanel({ onChanged }: SessionsPanelProps): ReactElement | null {
  const [overview, setOverview] = useState<InboxConsoleOverview | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchSessionsOverview()
      .then((next) => {
        setOverview(next);
        setUnavailable(false);
      })
      .catch(() => setUnavailable(true));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleWatch = useCallback(
    (sessionId: string, watched: boolean) => {
      setActionError(null);
      setSessionWatched(sessionId, watched)
        .then(() => {
          refresh();
          onChanged?.();
        })
        .catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)));
    },
    [refresh, onChanged],
  );

  const handleSend = useCallback(async (sessionId: string, text: string) => {
    await sendTextToSession(sessionId, text);
  }, []);

  if (unavailable || overview === null) return null;
  if (overview.sessions.length === 0 && overview.hidden.length === 0) return null;

  return (
    <section className="inbox-page__group ship-inbox__sessions" aria-label="Tracked sessions">
      <h2 className="inbox-page__repo-name">Tracked sessions</h2>
      {actionError && (
        <p className="app-shell__error" role="alert">
          {actionError}
        </p>
      )}
      <ul className="inbox-page__list">
        {overview.sessions.map((session) => (
          <li key={session.sessionId} className="inbox-page__item">
            <SessionRow session={session} onSend={handleSend} onWatch={handleWatch} />
          </li>
        ))}
      </ul>
      {overview.hidden.length > 0 && (
        <div className="ship-inbox__hidden">
          <button
            type="button"
            className="ship-inbox__btn"
            aria-expanded={showHidden}
            onClick={() => setShowHidden((open) => !open)}
          >
            {showHidden ? 'hide' : 'show'} unwatched ({overview.hidden.length})
          </button>
          {showHidden && (
            <ul className="inbox-page__list">
              {overview.hidden.map((session) => (
                <li key={session.sessionId} className="inbox-page__item">
                  <SessionRow session={session} onSend={handleSend} onWatch={handleWatch} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
