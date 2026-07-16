import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ChapelApiError,
  chapelConfess,
  chapelOpenSession,
  fetchChapelBrief,
  fetchChapelProject,
  fetchChapelProjects,
  type ChapelBrief,
  type ChapelProjectDetail,
  type ChapelProjectSummary,
} from '../api/client.js';
import './chapel.css';

function formatTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

interface ChapelToast {
  kind: 'ok' | 'error';
  text: string;
}

const TOAST_DISMISS_MS = 4_000;

/** Bare ReactMarkdown+remarkGfm, the CompareQuestion precedent -- deliberately NOT DocView's
 * directive pipeline; the Chaplain's files are plain markdown, not Chart Room docs. */
function ChapelMarkdown({ children }: { children: string }): ReactElement {
  return (
    <div className="chapel-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

/**
 * Chapel tab: the Chaplain's standing brief and per-project dossiers, a confession drop-box,
 * and a button that opens a live chaplain terminal session. Everything degrades independently:
 * a missing brief is a friendly empty pane (the confession box still works), and a hull without
 * the spawn contract turns the session button into its 501 explanation.
 */
export function ChapelPage(): ReactElement {
  const [brief, setBrief] = useState<ChapelBrief | null>(null);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ChapelProjectSummary[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [dossier, setDossier] = useState<ChapelProjectDetail | null>(null);
  const [dossierError, setDossierError] = useState<string | null>(null);

  const [confessionText, setConfessionText] = useState('');
  const [confessionProject, setConfessionProject] = useState('');
  const [confessPending, setConfessPending] = useState(false);

  const [sessionPending, setSessionPending] = useState(false);
  /** The session route's 501 `{error}` message -- set once, the button stays disabled with it. */
  const [sessionUnavailable, setSessionUnavailable] = useState<string | null>(null);

  const [toast, setToast] = useState<ChapelToast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((next: ChapelToast) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_DISMISS_MS);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetchChapelBrief()
      .then((next) => {
        if (!cancelled) {
          setBrief(next);
          setBriefError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setBriefError(err instanceof Error ? err.message : String(err));
      });
    fetchChapelProjects()
      .then((next) => {
        if (!cancelled) {
          setProjects(next.projects);
          setProjectsError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setProjectsError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenDossier = useCallback((id: string) => {
    setDossierError(null);
    fetchChapelProject(id)
      .then(setDossier)
      .catch((err: unknown) => setDossierError(err instanceof Error ? err.message : String(err)));
  }, []);

  const handleConfess = useCallback(() => {
    const text = confessionText.trim();
    if (!text) return;
    setConfessPending(true);
    chapelConfess(text, confessionProject === '' ? undefined : confessionProject)
      .then(() => {
        setConfessionText('');
        showToast({ kind: 'ok', text: 'Confession delivered to the Chaplain' });
      })
      .catch((err: unknown) =>
        showToast({ kind: 'error', text: `Confession failed: ${err instanceof Error ? err.message : String(err)}` }),
      )
      .finally(() => setConfessPending(false));
  }, [confessionText, confessionProject, showToast]);

  const handleOpenSession = useCallback(() => {
    setSessionPending(true);
    chapelOpenSession()
      .then(() => showToast({ kind: 'ok', text: 'Chaplain session opened' }))
      .catch((err: unknown) => {
        if (err instanceof ChapelApiError && err.status === 501) {
          setSessionUnavailable(err.message);
        } else {
          showToast({
            kind: 'error',
            text: `Chaplain session failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      })
      .finally(() => setSessionPending(false));
  }, [showToast]);

  const briefUpdated = formatTimestamp(brief?.updatedAt);

  let briefPane: ReactElement;
  if (briefError !== null) {
    briefPane = (
      <p className="chapel__error" role="alert">
        Brief unavailable: {briefError}
      </p>
    );
  } else if (brief === null) {
    briefPane = <p className="chapel__loading">Loading brief…</p>;
  } else if (brief.brief === null) {
    briefPane = (
      <div className="chapel-brief__empty">
        <p className="chapel-brief__empty-title">The Chaplain has not kept his brief yet.</p>
        <p className="chapel-brief__empty-hint">
          Drop a confession below anyway — it lands in his inbox and shapes the first brief.
        </p>
      </div>
    );
  } else {
    briefPane = <ChapelMarkdown>{brief.brief}</ChapelMarkdown>;
  }

  let dossierPane: ReactElement;
  if (dossier !== null) {
    const dossierUpdated = formatTimestamp(dossier.updatedAt);
    dossierPane = (
      <div className="chapel-dossier">
        <div className="chapel-dossier__head">
          <button type="button" className="chapel-dossier__back" onClick={() => setDossier(null)}>
            ← all dossiers
          </button>
          <span className="chapel-dossier__id">{dossier.id}</span>
          {dossierUpdated && <span className="chapel-dossier__updated">{dossierUpdated}</span>}
        </div>
        <ChapelMarkdown>{dossier.content}</ChapelMarkdown>
      </div>
    );
  } else if (projectsError !== null) {
    dossierPane = (
      <p className="chapel__error" role="alert">
        Dossiers unavailable: {projectsError}
      </p>
    );
  } else if (projects === null) {
    dossierPane = <p className="chapel__loading">Loading dossiers…</p>;
  } else if (projects.length === 0) {
    dossierPane = <p className="chapel__empty">No dossiers yet.</p>;
  } else {
    dossierPane = (
      <ul className="chapel-dossier-list">
        {projects.map((project) => (
          <li key={project.id}>
            <button
              type="button"
              className="chapel-dossier-list__item"
              onClick={() => handleOpenDossier(project.id)}
            >
              <span className="chapel-dossier-list__id">{project.id}</span>
              {formatTimestamp(project.updatedAt) && (
                <span className="chapel-dossier-list__updated">{formatTimestamp(project.updatedAt)}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="chapel">
      <div className="chapel__head">
        <h1 className="chapel__title">Chapel</h1>
        {briefUpdated && <span className="chapel__updated">brief updated {briefUpdated}</span>}
        <div className="chapel__spacer" />
        <button
          type="button"
          className="chapel__session-btn"
          onClick={handleOpenSession}
          disabled={sessionPending || sessionUnavailable !== null}
        >
          {sessionPending ? 'session opening…' : 'Open Chaplain session'}
        </button>
      </div>
      {sessionUnavailable !== null && (
        <p className="chapel__session-note" role="alert">
          {sessionUnavailable}
        </p>
      )}
      <div className="chapel__body">
        <section className="chapel-brief" aria-label="Chaplain's brief">
          <h2 className="chapel__section-title">Brief</h2>
          {briefPane}
        </section>
        <div className="chapel__rail">
          <section className="chapel-dossiers" aria-label="Dossiers">
            <h2 className="chapel__section-title">Dossiers</h2>
            {dossierError !== null && (
              <p className="chapel__error" role="alert">
                {dossierError}
              </p>
            )}
            {dossierPane}
          </section>
          <section className="chapel-confess" aria-label="Confession">
            <h2 className="chapel__section-title">Confess</h2>
            <textarea
              className="chapel-confess__text"
              aria-label="Confession text"
              placeholder="What weighs on the mission…"
              rows={5}
              value={confessionText}
              onChange={(event) => setConfessionText(event.target.value)}
            />
            <div className="chapel-confess__row">
              <select
                className="chapel-confess__project"
                aria-label="Confession project"
                value={confessionProject}
                onChange={(event) => setConfessionProject(event.target.value)}
              >
                <option value="">no project</option>
                {(projects ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="chapel-confess__submit"
                onClick={handleConfess}
                disabled={confessPending || confessionText.trim() === ''}
              >
                {confessPending ? 'confessing…' : 'Confess'}
              </button>
            </div>
          </section>
        </div>
      </div>
      {toast && (
        <div className={toast.kind === 'ok' ? 'toast-brass' : 'toast-rust'} role={toast.kind === 'ok' ? 'status' : 'alert'}>
          <span>{toast.text}</span>
          <button type="button" className="toast__dismiss" onClick={dismissToast} aria-label="Dismiss notification">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
