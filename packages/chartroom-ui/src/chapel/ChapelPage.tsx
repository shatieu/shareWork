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
  fetchRepos,
  type ChapelBrief,
  type ChapelProjectDetail,
  type ChapelProjectSummary,
} from '../api/client.js';
import {
  chapelChat,
  fetchChapelChatLog,
  fetchChapelConfession,
  fetchChapelConfessions,
  fetchChapelRounds,
  fetchChapelRoundsDay,
  runChapelRounds,
  type ChapelChatMessage,
  type ChapelConfessionDetail,
  type ChapelConfessionSummary,
  type ChapelRoundsDetail,
  type ChapelRoundsSummary,
} from '../api/chapelClient.js';
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

/** Same sanitation the confess route applies server-side -- the marker a chip inserts always
 * matches the id the chaplain's dossiers use. */
function projectMarkerId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/** Registered-repo chips (cross-project markers). Clicking a chip INSERTS a `project: <id>`
 * marker into the composed text -- never a hard filter; the chaplain stays global. */
interface ProjectChip {
  id: string;
  label: string;
}

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
 * Chapel tab -- the Captain's confessor. The main feature is a persistent CHAT with the chaplain
 * (headless `claude -p` turns server-side; the conversation survives reloads via the hull's
 * chat log). Around it: the standing brief, per-project dossiers, the confession drop-box, and
 * the past-confessions archive. Everything degrades independently.
 */
export function ChapelPage(): ReactElement {
  const [brief, setBrief] = useState<ChapelBrief | null>(null);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ChapelProjectSummary[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [dossier, setDossier] = useState<ChapelProjectDetail | null>(null);
  const [dossierError, setDossierError] = useState<string | null>(null);

  const [chatMessages, setChatMessages] = useState<ChapelChatMessage[] | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [chatPending, setChatPending] = useState(false);
  const chatListRef = useRef<HTMLDivElement | null>(null);

  const [chips, setChips] = useState<ProjectChip[]>([]);

  const [rounds, setRounds] = useState<ChapelRoundsSummary[] | null>(null);
  const [roundsError, setRoundsError] = useState<string | null>(null);
  const [roundsDetail, setRoundsDetail] = useState<ChapelRoundsDetail | null>(null);
  const [roundsRunPending, setRoundsRunPending] = useState(false);

  const [confessions, setConfessions] = useState<ChapelConfessionSummary[] | null>(null);
  const [confessionsError, setConfessionsError] = useState<string | null>(null);
  const [openConfession, setOpenConfession] = useState<ChapelConfessionDetail | null>(null);

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

  const handleOpenRounds = useCallback((date: string) => {
    setRoundsError(null);
    fetchChapelRoundsDay(date)
      .then(setRoundsDetail)
      .catch((err: unknown) => setRoundsError(err instanceof Error ? err.message : String(err)));
  }, []);

  /** Refresh the rounds date list and open `openDate` (default: the newest available). */
  const refreshRounds = useCallback(
    (openDate?: string): Promise<void> => {
      return fetchChapelRounds()
        .then((next) => {
          setRounds(next.rounds);
          setRoundsError(null);
          const target = openDate ?? next.rounds[0]?.date;
          if (target !== undefined) handleOpenRounds(target);
        })
        .catch((err: unknown) => setRoundsError(err instanceof Error ? err.message : String(err)));
    },
    [handleOpenRounds],
  );

  const refreshConfessions = useCallback((): Promise<void> => {
    return fetchChapelConfessions()
      .then((next) => {
        setConfessions(next.confessions);
        setConfessionsError(null);
      })
      .catch((err: unknown) => setConfessionsError(err instanceof Error ? err.message : String(err)));
  }, []);

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
    fetchChapelChatLog()
      .then((next) => {
        if (!cancelled) {
          setChatMessages(next.messages);
          setChatError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setChatError(err instanceof Error ? err.message : String(err));
      });
    // Registered repos feed the cross-project marker chips; a failed fetch just hides the row.
    fetchRepos()
      .then((repos) => {
        if (!cancelled) {
          setChips(
            repos
              .map((repo) => ({ id: projectMarkerId(repo.name), label: repo.name }))
              .filter((chip) => chip.id !== ''),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setChips([]);
      });
    void refreshConfessions();
    void refreshRounds();
    return () => {
      cancelled = true;
    };
  }, [refreshConfessions, refreshRounds]);

  // Keep the newest exchange in view as messages arrive.
  useEffect(() => {
    const list = chatListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chatMessages, chatPending]);

  const handleSendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text || chatPending) return;
    setChatPending(true);
    setChatInput('');
    const at = new Date().toISOString();
    setChatMessages((prev) => [...(prev ?? []), { role: 'captain', text, at }]);
    chapelChat(text)
      .then(({ reply }) => {
        setChatMessages((prev) => [...(prev ?? []), { role: 'chaplain', text: reply, at: new Date().toISOString() }]);
      })
      .catch((err: unknown) => {
        setChatInput(text); // keep the message for retry
        showToast({ kind: 'error', text: `Chaplain chat failed: ${err instanceof Error ? err.message : String(err)}` });
      })
      .finally(() => setChatPending(false));
  }, [chatInput, chatPending, showToast]);

  const handleInsertMarker = useCallback((chipId: string) => {
    const marker = `project: ${chipId}`;
    setChatInput((prev) => {
      if (prev === '') return `${marker} `;
      const separator = prev.endsWith(' ') || prev.endsWith('\n') ? '' : ' ';
      return `${prev}${separator}${marker} `;
    });
  }, []);

  const handleRunRounds = useCallback(() => {
    setRoundsRunPending(true);
    runChapelRounds()
      .then((result) => {
        showToast({ kind: 'ok', text: `Rounds made for ${result.date}` });
        void refreshRounds(result.date);
      })
      .catch((err: unknown) =>
        showToast({ kind: 'error', text: `Rounds run failed: ${err instanceof Error ? err.message : String(err)}` }),
      )
      .finally(() => setRoundsRunPending(false));
  }, [refreshRounds, showToast]);

  const handleOpenDossier = useCallback((id: string) => {
    setDossierError(null);
    fetchChapelProject(id)
      .then(setDossier)
      .catch((err: unknown) => setDossierError(err instanceof Error ? err.message : String(err)));
  }, []);

  const handleOpenConfession = useCallback((stamp: string) => {
    fetchChapelConfession(stamp)
      .then(setOpenConfession)
      .catch((err: unknown) => setConfessionsError(err instanceof Error ? err.message : String(err)));
  }, []);

  const handleConfess = useCallback(() => {
    const text = confessionText.trim();
    if (!text) return;
    setConfessPending(true);
    chapelConfess(text, confessionProject === '' ? undefined : confessionProject)
      .then(() => {
        setConfessionText('');
        showToast({ kind: 'ok', text: 'Confession delivered to the Chaplain' });
        void refreshConfessions();
      })
      .catch((err: unknown) =>
        showToast({ kind: 'error', text: `Confession failed: ${err instanceof Error ? err.message : String(err)}` }),
      )
      .finally(() => setConfessPending(false));
  }, [confessionText, confessionProject, showToast, refreshConfessions]);

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

  let chatBody: ReactElement;
  if (chatError !== null) {
    chatBody = (
      <p className="chapel__error" role="alert">
        Conversation unavailable: {chatError}
      </p>
    );
  } else if (chatMessages === null) {
    chatBody = <p className="chapel__loading">Loading conversation…</p>;
  } else if (chatMessages.length === 0 && !chatPending) {
    chatBody = (
      <div className="chapel-chat__empty">
        <p className="chapel-brief__empty-title">The confessional is open.</p>
        <p className="chapel-brief__empty-hint">
          Ask the Chaplain anything — how a project is doing, what to take on next, what weighs on the mission.
        </p>
      </div>
    );
  } else {
    chatBody = (
      <>
        {chatMessages.map((message, index) => (
          <div
            key={`${message.at}-${String(index)}`}
            className={`chapel-chat__msg chapel-chat__msg--${message.role}`}
          >
            <span className="chapel-chat__role">{message.role === 'captain' ? 'Captain' : 'Chaplain'}</span>
            {message.role === 'chaplain' ? (
              <ChapelMarkdown>{message.text}</ChapelMarkdown>
            ) : (
              <p className="chapel-chat__text">{message.text}</p>
            )}
          </div>
        ))}
        {chatPending && <p className="chapel-chat__waiting">The Chaplain is listening…</p>}
      </>
    );
  }

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

  let roundsPane: ReactElement;
  if (roundsError !== null) {
    roundsPane = (
      <p className="chapel__error" role="alert">
        Rounds unavailable: {roundsError}
      </p>
    );
  } else if (rounds === null) {
    roundsPane = <p className="chapel__loading">Loading rounds…</p>;
  } else if (rounds.length === 0) {
    roundsPane = <p className="chapel__empty">No rounds yet.</p>;
  } else {
    roundsPane = (
      <>
        <select
          className="chapel-rounds__date"
          aria-label="Rounds date"
          value={roundsDetail?.date ?? rounds[0].date}
          onChange={(event) => handleOpenRounds(event.target.value)}
        >
          {rounds.map((round) => (
            <option key={round.date} value={round.date}>
              {round.date}
            </option>
          ))}
        </select>
        {roundsDetail === null ? (
          <p className="chapel__loading">Loading digest…</p>
        ) : (
          <ChapelMarkdown>{roundsDetail.content}</ChapelMarkdown>
        )}
      </>
    );
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

  let confessionsPane: ReactElement;
  if (openConfession !== null) {
    const openUpdated = formatTimestamp(openConfession.updatedAt);
    confessionsPane = (
      <div className="chapel-past__detail">
        <div className="chapel-dossier__head">
          <button type="button" className="chapel-dossier__back" onClick={() => setOpenConfession(null)}>
            ← all confessions
          </button>
          {openConfession.project !== null && (
            <span className="chapel-past__project">project: {openConfession.project}</span>
          )}
          {openUpdated && <span className="chapel-dossier__updated">{openUpdated}</span>}
        </div>
        <p className="chapel-past__text">{openConfession.text}</p>
      </div>
    );
  } else if (confessionsError !== null) {
    confessionsPane = (
      <p className="chapel__error" role="alert">
        Past confessions unavailable: {confessionsError}
      </p>
    );
  } else if (confessions === null) {
    confessionsPane = <p className="chapel__loading">Loading past confessions…</p>;
  } else if (confessions.length === 0) {
    confessionsPane = <p className="chapel__empty">Nothing confessed yet.</p>;
  } else {
    confessionsPane = (
      <ul className="chapel-past-list">
        {confessions.map((confession) => (
          <li key={confession.stamp}>
            <button
              type="button"
              className="chapel-past-list__item"
              onClick={() => handleOpenConfession(confession.stamp)}
            >
              <span className="chapel-past-list__meta">
                {formatTimestamp(confession.updatedAt) ?? confession.stamp}
                {confession.project !== null && (
                  <span className="chapel-past__project">project: {confession.project}</span>
                )}
              </span>
              <span className="chapel-past-list__excerpt">{confession.excerpt}</span>
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
        <section className="chapel-chat" aria-label="Chaplain conversation">
          <h2 className="chapel__section-title">Confessional</h2>
          <div className="chapel-chat__messages" ref={chatListRef} role="log" aria-label="Conversation log">
            {chatBody}
          </div>
          {chips.length > 0 && (
            <div className="chapel-chat__chips" role="group" aria-label="Project markers">
              {chips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className="chapel-chat__chip"
                  title={`Insert a project: ${chip.id} marker`}
                  onClick={() => handleInsertMarker(chip.id)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}
          <div className="chapel-chat__composer">
            <textarea
              className="chapel-chat__input"
              aria-label="Chat message"
              placeholder="Speak with the Chaplain…"
              rows={2}
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleSendChat();
                }
              }}
            />
            <button
              type="button"
              className="chapel-chat__send"
              onClick={handleSendChat}
              disabled={chatPending || chatInput.trim() === ''}
            >
              {chatPending ? 'listening…' : 'Send'}
            </button>
          </div>
        </section>
        <div className="chapel__rail">
          <section className="chapel-brief" aria-label="Chaplain's brief">
            <h2 className="chapel__section-title">Brief</h2>
            {briefPane}
          </section>
          <section className="chapel-rounds" aria-label="Rounds">
            <div className="chapel-rounds__head">
              <h2 className="chapel__section-title">Rounds</h2>
              <button
                type="button"
                className="chapel-rounds__run"
                onClick={handleRunRounds}
                disabled={roundsRunPending}
              >
                {roundsRunPending ? 'making rounds…' : 'Run rounds now'}
              </button>
            </div>
            {roundsPane}
          </section>
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
          <section className="chapel-past" aria-label="Past confessions">
            <h2 className="chapel__section-title">Past confessions</h2>
            {confessionsPane}
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
