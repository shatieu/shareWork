import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import {
  fetchActivity,
  fetchDoc,
  fetchDocs,
  fetchInbox,
  fetchRepos,
  openClaudeSession,
  type ActivityEvent,
  type DocDetail,
  type DocSummary,
  type InboxItem,
  type RepoSummary,
} from './api/client.js';
import { RepoTree } from './components/RepoTree.js';
import { RegisterRepoModal } from './components/RegisterRepoModal.js';
import { DocView } from './components/DocView.js';
import { SearchModal } from './components/SearchModal.js';
import { NeedsYouPanel } from './components/NeedsYouPanel.js';
import { LatestPanel } from './components/LatestPanel.js';
import { FrontmatterPanel } from './components/FrontmatterPanel.js';
import { InboxPage, type AskSelection } from './inbox/InboxPage.js';

export const REGISTER_COMMAND = 'chartroom register <path>';

interface HashRoute {
  repoId?: string;
  /** doc route key: `id ?? path` (the daemon accepts either on every doc endpoint). */
  docKey?: string;
  /** `#/inbox` or `#/inbox/<repoId>/<docKey>/<directiveId>` -- The Ask screen. */
  isInbox?: boolean;
  askSelection?: AskSelection;
}

// Hash-based navigation, no router dependency -- the hash fragment never reaches the server, so
// @fastify/static's default "serve index.html for `/`" behavior already handles deep-link
// refreshes with zero SPA-fallback config on the daemon side.
const DOC_ROUTE_RE = /^#\/repo\/([^/]+)(?:\/doc\/([^/]+))?$/;
const ASK_SEL_RE = /^#\/inbox\/([^/]+)\/([^/]+)\/([^/]+)$/;
const INBOX_ROUTE = '#/inbox';

function subscribeHash(callback: () => void): () => void {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

function getHashSnapshot(): string {
  return window.location.hash;
}

function parseHash(hash: string): HashRoute {
  if (hash === INBOX_ROUTE) return { isInbox: true };
  const askMatch = ASK_SEL_RE.exec(hash);
  if (askMatch) {
    return {
      isInbox: true,
      askSelection: {
        repoId: decodeURIComponent(askMatch[1]),
        docKey: decodeURIComponent(askMatch[2]),
        directiveId: decodeURIComponent(askMatch[3]),
      },
    };
  }
  const match = DOC_ROUTE_RE.exec(hash);
  if (!match) return {};
  return {
    repoId: decodeURIComponent(match[1]),
    docKey: match[2] ? decodeURIComponent(match[2]) : undefined,
  };
}

function navigateTo(repoId: string, docKey?: string): void {
  window.location.hash = docKey
    ? `#/repo/${encodeURIComponent(repoId)}/doc/${encodeURIComponent(docKey)}`
    : `#/repo/${encodeURIComponent(repoId)}`;
}

function navigateToAsk(selection?: AskSelection): void {
  window.location.hash = selection
    ? `#/inbox/${encodeURIComponent(selection.repoId)}/${encodeURIComponent(selection.docKey)}/${encodeURIComponent(selection.directiveId)}`
    : INBOX_ROUTE;
}

function loadExpandedRepos(): Set<string> {
  try {
    const raw = window.localStorage.getItem('chartroom.tree.expandedRepos');
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* corrupted/unavailable storage is never fatal */
  }
  return new Set();
}

function loadRailCollapsed(): boolean {
  try {
    return window.localStorage.getItem('chartroom.ui.railCollapsed') === '1';
  } catch {
    return false;
  }
}

/** The brass compass mark -- the logo, drawn in CSS (radial brass + cross lines + rotated square). */
export function CompassMark({ large }: { large?: boolean }): ReactElement {
  return (
    <div className={large ? 'compass compass--lg' : 'compass'} aria-hidden="true">
      <div className="compass__needle" />
    </div>
  );
}

export default function App(): ReactElement {
  const hash = useSyncExternalStore(subscribeHash, getHashSnapshot, getHashSnapshot);
  const route = useMemo(() => parseHash(hash), [hash]);

  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [docsByRepo, setDocsByRepo] = useState<Record<string, DocSummary[]>>({});
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(loadRailCollapsed);
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(loadExpandedRepos);
  const [claudeBusyRepoId, setClaudeBusyRepoId] = useState<string | null>(null);
  const [claudeToast, setClaudeToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── data: repos / activity / inbox (10s poll -- cheap; repair events must never be missed) ── */

  const refreshDashboards = useCallback(() => {
    fetchRepos()
      .then(setRepos)
      .catch((err: unknown) => setError(String(err)));
    fetchInbox()
      .then(setInboxItems)
      .catch(() => undefined);
    fetchActivity(50)
      .then(setActivity)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshDashboards();
    const timer = setInterval(refreshDashboards, 10_000);
    return () => clearInterval(timer);
  }, [refreshDashboards]);

  // Auto-select the first repo if no route is set yet -- landing on a blank pane reads as broken
  // rather than "nothing to see here on purpose."
  useEffect(() => {
    if (repos && repos.length > 0 && !parseHash(window.location.hash).repoId && window.location.hash !== INBOX_ROUTE && !window.location.hash.startsWith('#/inbox/')) {
      navigateTo(repos[0].id);
    }
  }, [repos]);

  // The active repo is always expanded in the tree (so the open doc is visible in context).
  useEffect(() => {
    if (route.repoId && !expandedRepos.has(route.repoId)) {
      setExpandedRepos((prev) => new Set([...prev, route.repoId!]));
    }
  }, [route.repoId, expandedRepos]);

  useEffect(() => {
    try {
      window.localStorage.setItem('chartroom.tree.expandedRepos', JSON.stringify([...expandedRepos]));
    } catch {
      /* ignore */
    }
  }, [expandedRepos]);

  /* ── data: per-repo doc lists (fetched lazily for every expanded repo, cached) ── */

  const refreshRepoDocs = useCallback((repoId: string) => {
    fetchDocs(repoId)
      .then((docs) => setDocsByRepo((prev) => ({ ...prev, [repoId]: docs })))
      .catch((err: unknown) => setError(String(err)));
  }, []);

  useEffect(() => {
    const wanted = new Set(expandedRepos);
    if (route.repoId) wanted.add(route.repoId);
    for (const repoId of wanted) {
      if (!(repoId in docsByRepo) && repos?.some((r) => r.id === repoId)) {
        refreshRepoDocs(repoId);
      }
    }
  }, [expandedRepos, route.repoId, repos, docsByRepo, refreshRepoDocs]);

  /* ── data: active doc detail ── */

  const refetchDoc = useCallback(() => {
    if (!route.repoId || !route.docKey) return;
    fetchDoc(route.repoId, route.docKey)
      .then(setDetail)
      .catch((err: unknown) => setError(String(err)));
  }, [route.repoId, route.docKey]);

  useEffect(() => {
    if (!route.repoId || !route.docKey) {
      setDetail(null);
      return;
    }
    refetchDoc();
  }, [route.repoId, route.docKey, refetchDoc]);

  /* ── global search (⌘K / Ctrl+K, suppressed while typing/editing) ── */

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return; // the editor owns Ctrl+K (link picker); inputs keep their own behavior
        }
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /* ── claude session launcher (chrome chip + tree row buttons) ── */

  const handleOpenClaude = useCallback((repoId: string) => {
    setClaudeBusyRepoId(repoId);
    openClaudeSession(repoId)
      .catch((err: unknown) => {
        setClaudeToast(err instanceof Error ? err.message : String(err));
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setClaudeToast(null), 6000);
      })
      .finally(() => setClaudeBusyRepoId((prev) => (prev === repoId ? null : prev)));
  }, []);

  /* ── save-completion: refresh doc detail, its repo's docs, and the dashboards ── */

  const handleSaved = useCallback(() => {
    refetchDoc();
    if (route.repoId) refreshRepoDocs(route.repoId);
    refreshDashboards();
  }, [refetchDoc, route.repoId, refreshRepoDocs, refreshDashboards]);

  const handleSelectDoc = useCallback((repoId: string, docKey: string) => {
    navigateTo(repoId, docKey);
  }, []);

  const activeRepo = repos?.find((r) => r.id === route.repoId);
  const activeDocs = route.repoId ? docsByRepo[route.repoId] : undefined;
  const pathSegments = detail ? detail.doc.path.split('/') : [];
  const openAskCount = inboxItems.length;

  /* ── top chrome ── */

  const chrome = (
    <header className="chrome">
      <button
        type="button"
        className="chrome__brand"
        onClick={() => {
          if (repos && repos.length > 0) navigateTo(route.repoId ?? repos[0].id);
        }}
        aria-label="Chart Room home"
      >
        <CompassMark />
        <span className="chrome__wordmark">CHART&nbsp;ROOM</span>
      </button>
      <div className="chrome__divider" />
      <nav className="chrome__crumbs" aria-label="Breadcrumbs">
        {route.isInbox ? (
          <>
            <button
              type="button"
              className="crumb crumb--link"
              onClick={() => {
                if (repos && repos.length > 0) navigateTo(repos[0].id);
              }}
            >
              chart room
            </button>
            <span className="crumb__sep">/</span>
            <span className="crumb crumb--active">the ask</span>
          </>
        ) : activeRepo ? (
          <>
            <button type="button" className="crumb crumb--link" onClick={() => navigateTo(activeRepo.id)}>
              {activeRepo.name}
            </button>
            {pathSegments.map((segment, i) => (
              <span key={`${segment}-${i}`} className="crumb-seg">
                <span className="crumb__sep">/</span>
                <span className={i === pathSegments.length - 1 ? 'crumb crumb--active' : 'crumb'}>{segment}</span>
              </span>
            ))}
          </>
        ) : (
          <span className="crumb">no repo selected</span>
        )}
      </nav>
      {!route.isInbox && activeRepo && (
        <button
          type="button"
          className="chrome__claude"
          onClick={() => handleOpenClaude(activeRepo.id)}
          disabled={claudeBusyRepoId === activeRepo.id}
          aria-label={`Open Claude session in ${activeRepo.name}`}
          title="Open Claude session in this repo"
        >
          {claudeBusyRepoId === activeRepo.id ? 'session opening…' : '❯ claude'}
        </button>
      )}
      <div className="chrome__spacer" />
      <button type="button" className="chrome__search" onClick={() => setSearchOpen(true)} aria-label="Search all repos">
        <span className="chrome__search-glyph" aria-hidden="true">
          ⌕
        </span>
        <span className="chrome__search-label">Search all repos — docs, ids, headings…</span>
        <span className="chrome__kbd">⌘K</span>
      </button>
      {route.isInbox ? (
        <span className="chrome__watched">
          <span className="chrome__watched-dot chrome__watched-dot--alert" aria-hidden="true" />
          {openAskCount} open
        </span>
      ) : (
        <span className="chrome__watched">
          <span className="chrome__watched-dot" aria-hidden="true" />
          {repos?.length ?? 0} watched
        </span>
      )}
    </header>
  );

  /* ── center content (workspace route) ── */

  let center: ReactElement;
  if (route.repoId && route.docKey && detail) {
    center = (
      <DocView
        repoId={route.repoId}
        docId={route.docKey}
        detail={detail}
        docs={activeDocs ?? []}
        onSelectDoc={(docKey) => {
          if (route.repoId) navigateTo(route.repoId, docKey);
        }}
        onSaved={handleSaved}
      />
    );
  } else if (activeRepo && activeDocs && activeDocs.length === 0) {
    center = (
      <div className="paper-empty">
        <h1>{activeRepo.name}</h1>
        <p>
          This repo is watched, but no markdown docs have been indexed yet. Add a <code>.md</code> file and the chart
          room will pick it up on the next rebuild.
        </p>
      </div>
    );
  } else if (activeRepo) {
    center = (
      <div className="paper-empty">
        <h1>{activeRepo.name}</h1>
        <p>
          {activeRepo.docCount} doc{activeRepo.docCount === 1 ? '' : 's'} charted at <code>{activeRepo.absPath}</code>.
          Pick one from the tree to start reading.
        </p>
      </div>
    );
  } else {
    center = <div className="paper-empty">{repos === null ? <p>Loading…</p> : <p>Pick a repo to get underway.</p>}</div>;
  }

  const noRepos = repos !== null && repos.length === 0;

  return (
    <div className="app-shell">
      {chrome}
      <div className="app-shell__body">
        {route.isInbox ? (
          <InboxPage
            onNavigate={(repoId, docKey) => navigateTo(repoId, docKey)}
            initialSelection={route.askSelection}
          />
        ) : noRepos ? (
          <div className="empty-state">
            <CompassMark large />
            <p className="empty-state__title">No repos registered yet</p>
            <button type="button" className="btn-rust" onClick={() => setRegisterOpen(true)}>
              ＋ register a repo…
            </button>
            <div className="empty-state__cmd">
              <span className="empty-state__or">or from a terminal:</span>
              <code>{REGISTER_COMMAND}</code>
              <button
                type="button"
                className="copy-btn"
                onClick={() => void navigator.clipboard?.writeText(REGISTER_COMMAND)}
              >
                copy
              </button>
            </div>
          </div>
        ) : (
          <>
            <RepoTree
              repos={repos ?? []}
              docsByRepo={docsByRepo}
              expandedRepos={expandedRepos}
              onToggleRepo={(repoId) =>
                setExpandedRepos((prev) => {
                  const next = new Set(prev);
                  if (next.has(repoId)) next.delete(repoId);
                  else next.add(repoId);
                  return next;
                })
              }
              activeRepoId={route.repoId}
              activeDocKey={route.docKey}
              onSelectDoc={handleSelectDoc}
              collapsed={railCollapsed}
              onSetCollapsed={(collapsed) => {
                setRailCollapsed(collapsed);
                try {
                  window.localStorage.setItem('chartroom.ui.railCollapsed', collapsed ? '1' : '0');
                } catch {
                  /* ignore */
                }
              }}
              onOpenClaude={handleOpenClaude}
              claudeBusyRepoId={claudeBusyRepoId}
              onOpenRegister={() => setRegisterOpen(true)}
            />
            <main className="paper-frame">
              <div className="paper">{center}</div>
            </main>
            <aside className="panel context-panel" aria-label="Dashboard">
              <NeedsYouPanel
                items={inboxItems}
                onAnswer={(item) =>
                  navigateToAsk({ repoId: item.repoId, docKey: item.docId, directiveId: item.directiveId })
                }
                onOpenDoc={(item) => navigateTo(item.repoId, item.docId)}
                onViewAll={() => navigateToAsk()}
              />
              <LatestPanel
                events={activity}
                onOpen={(event) => {
                  if (event.docKey) navigateTo(event.repoId, event.docKey);
                }}
              />
              <FrontmatterPanel detail={detail} />
            </aside>
          </>
        )}
      </div>
      {registerOpen && (
        <RegisterRepoModal
          onClose={() => setRegisterOpen(false)}
          onRegistered={(repo) => {
            refreshDashboards();
            setExpandedRepos((prev) => new Set([...prev, repo.id]));
          }}
        />
      )}
      {searchOpen && (
        <SearchModal
          onClose={() => setSearchOpen(false)}
          onNavigate={(repoId, docKey) => {
            setSearchOpen(false);
            navigateTo(repoId, docKey);
          }}
        />
      )}
      {error && (
        <p className="app-shell__error" role="alert">
          {error}
        </p>
      )}
      {claudeToast && (
        <p className="toast-rust" role="alert">
          Claude session failed: {claudeToast}
        </p>
      )}
    </div>
  );
}
