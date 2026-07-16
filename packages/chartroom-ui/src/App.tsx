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
  fetchChapelBrief,
  fetchDoc,
  fetchDocs,
  fetchHullStations,
  fetchInbox,
  fetchRepos,
  fetchShipInboxSummary,
  fetchVoyage,
  openClaudeSession,
  type DocDetail,
  type DocSummary,
  type RegisterRepoResult,
  type RepoSummary,
} from './api/client.js';
import { AddRepoModal } from './components/AddRepoModal.js';
import { RepoOverview } from './components/RepoOverview.js';
import { RepoTree } from './components/RepoTree.js';
import { TabBar, type DeckTab } from './components/TabBar.js';
import { DocView } from './components/DocView.js';
import { ConsolePage } from './console/ConsolePage.js';
import { InboxPage } from './inbox/InboxPage.js';
import { ShipInboxPage } from './shipinbox/ShipInboxPage.js';
import { SettingsPage } from './settings/SettingsPage.js';
import { useSetupWizard } from './setup/useSetupWizard.js';
import { VoyagePage } from './voyage/VoyagePage.js';
import { ChapelPage } from './chapel/ChapelPage.js';

export const REGISTER_COMMAND = 'chartroom register <path>';

const DOCS_TAB: DeckTab = { id: 'docs', title: 'Docs' };
const VOYAGE_TAB: DeckTab = { id: 'voyage', title: 'Voyage' };
const CHAPEL_TAB: DeckTab = { id: 'chapel', title: 'Chapel' };

interface DeckRoute {
  tab: 'docs' | 'voyage' | 'chapel' | 'settings' | 'console';
  repoId?: string;
  /** doc route key: `id ?? path` (the daemon accepts either on every doc endpoint). */
  docKey?: string;
  /** `#/inbox` -- the cross-repo inbox, rendered as Docs-tab content. */
  isInbox?: boolean;
}

// Hash-based navigation, no router dependency -- the hash fragment never reaches the server, so
// @fastify/static's default "serve index.html for `/`" behavior already handles deep-link
// refreshes with zero SPA-fallback config on the daemon side. Existing `#/repo/...` and
// `#/inbox` deep links keep working unchanged; `#/voyage` and `#/chapel` are the only added routes.
const DOC_ROUTE_RE = /^#\/repo\/([^/]+)(?:\/doc\/([^/]+))?$/;
const INBOX_ROUTE = '#/inbox';
const VOYAGE_ROUTE = '#/voyage';
const CHAPEL_ROUTE = '#/chapel';
const SETTINGS_ROUTE = '#/settings';
const CONSOLE_ROUTE = '#/console';

function subscribeHash(callback: () => void): () => void {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

function getHashSnapshot(): string {
  return window.location.hash;
}

/** The single hash parser -- every consumer (render route, auto-select effect, tab bar)
 * goes through here. */
function parseHash(hash: string): DeckRoute {
  if (hash === VOYAGE_ROUTE) return { tab: 'voyage' };
  if (hash === CHAPEL_ROUTE) return { tab: 'chapel' };
  if (hash === SETTINGS_ROUTE) return { tab: 'settings' };
  if (hash === CONSOLE_ROUTE) return { tab: 'console' };
  if (hash === INBOX_ROUTE) return { tab: 'docs', isInbox: true };
  const match = DOC_ROUTE_RE.exec(hash);
  if (!match) return { tab: 'docs' };
  return {
    tab: 'docs',
    repoId: decodeURIComponent(match[1]),
    docKey: match[2] ? decodeURIComponent(match[2]) : undefined,
  };
}

function navigateTo(repoId: string, docKey?: string): void {
  window.location.hash = docKey
    ? `#/repo/${encodeURIComponent(repoId)}/doc/${encodeURIComponent(docKey)}`
    : `#/repo/${encodeURIComponent(repoId)}`;
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

interface DeckToast {
  kind: 'ok' | 'error';
  text: string;
}

const TOAST_DISMISS_MS = 4_000;

export default function App(): ReactElement {
  const hash = useSyncExternalStore(subscribeHash, getHashSnapshot, getHashSnapshot);
  const route = useMemo(() => parseHash(hash), [hash]);

  const [tabs, setTabs] = useState<DeckTab[]>([DOCS_TAB]);
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [docsByRepo, setDocsByRepo] = useState<Record<string, DocSummary[]>>({});
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [inboxCount, setInboxCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(loadRailCollapsed);
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(loadExpandedRepos);
  const [claudeBusyRepoId, setClaudeBusyRepoId] = useState<string | null>(null);
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const [toast, setToast] = useState<DeckToast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Remembers the last Docs-tab hash so switching Voyage → Docs restores where you were.
  const lastDocsHashRef = useRef<string>('');

  useEffect(() => {
    // `#/inbox` is deliberately excluded: with a hull-mounted Inbox tab it belongs to that tab,
    // and even standalone, "back to Docs" should land on a doc, not bounce to the inbox.
    if (route.tab === 'docs' && !route.isInbox) lastDocsHashRef.current = hash;
  }, [route.tab, route.isInbox, hash]);

  /* ── station tabs (from the hull; standalone `chartroom serve` = Docs-only mode) ── */

  useEffect(() => {
    let cancelled = false;
    fetchHullStations()
      .then((stations) => {
        const stationTabs = stations
          .map((station) => station.tab)
          .filter((tab): tab is DeckTab => tab !== undefined && tab !== null);
        const withDocs = stationTabs.some((tab) => tab.id === DOCS_TAB.id) ? stationTabs : [DOCS_TAB, ...stationTabs];
        if (!cancelled) setTabs(withDocs);
        // Voyage tab only when the hull actually serves voyage data (404 = not configured);
        // Chapel tab when the brief probe resolves (its routes are always registered under a
        // hull -- 200 even before the first brief exists -- so resolving == hull present).
        return Promise.all([
          fetchVoyage().then(
            () => VOYAGE_TAB,
            () => null,
          ),
          fetchChapelBrief().then(
            () => CHAPEL_TAB,
            () => null,
          ),
        ]).then((probed) => {
          const extraTabs = probed.filter((tab): tab is DeckTab => tab !== null);
          if (!cancelled && extraTabs.length > 0) setTabs([...withDocs, ...extraTabs]);
        });
      })
      .catch(() => {
        /* no hull (plain chartroom serve) -- keep the Docs-only default */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectTab = useCallback(
    (tabId: string) => {
      if (tabId === 'voyage') {
        window.location.hash = VOYAGE_ROUTE;
        return;
      }
      if (tabId === 'chapel') {
        window.location.hash = CHAPEL_ROUTE;
        return;
      }
      if (tabId === 'settings') {
        window.location.hash = SETTINGS_ROUTE;
        return;
      }
      if (tabId === 'console') {
        window.location.hash = CONSOLE_ROUTE;
        return;
      }
      if (tabId === 'inbox') {
        window.location.hash = INBOX_ROUTE;
        return;
      }
      const last = lastDocsHashRef.current;
      if (last && last !== VOYAGE_ROUTE && last !== CHAPEL_ROUTE && last !== INBOX_ROUTE) {
        window.location.hash = last;
      } else {
        // No remembered doc: land on the repos overview (the bare `#/` route).
        window.location.hash = '#/';
      }
    },
    [],
  );

  /* ── data: repos + inbox count ── */

  const refreshDashboards = useCallback(() => {
    fetchRepos()
      .then(setRepos)
      .catch((err: unknown) => setError(String(err)));
    // Under the hull the badge counts EVERYTHING needing a human (permissions + agent questions
    // + docs, Ship_Spec §5); standalone `chartroom serve` falls back to the docs-only count.
    fetchShipInboxSummary()
      .then((summary) => setInboxCount(summary.total))
      .catch(() => {
        fetchInbox()
          .then((items) => setInboxCount(items.length))
          .catch(() => setInboxCount(null));
      });
  }, []);

  useEffect(() => {
    refreshDashboards();
  }, [refreshDashboards]);

  // The bare `#/` route deliberately selects nothing: it renders the tracked-repos overview
  // (package 15 scope addition) -- the old auto-select-first-repo jump is gone with it.

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

  /* ── claude session launcher (chrome chip + tree row buttons) ── */

  const showToast = useCallback((next: DeckToast) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(next);
    // Auto-dismiss after ~4s; the toast is also manually dismissable (the WIP error toast
    // never dismissed -- fixed here).
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

  const handleOpenClaude = useCallback(
    (repoId: string) => {
      setClaudeBusyRepoId(repoId);
      const repoName = repos?.find((r) => r.id === repoId)?.name ?? repoId;
      openClaudeSession(repoId)
        .then(() => showToast({ kind: 'ok', text: `Claude session opened in ${repoName}` }))
        .catch((err: unknown) =>
          showToast({ kind: 'error', text: `Claude session failed: ${err instanceof Error ? err.message : String(err)}` }),
        )
        .finally(() => setClaudeBusyRepoId((prev) => (prev === repoId ? null : prev)));
    },
    [repos, showToast],
  );

  /* ── setup wizard (AddRepoModal success pane + RepoOverview per-card "Set up") ── */

  const { open: openSetupWizard, modal: setupWizardModal } = useSetupWizard();

  const handleOpenSetup = useCallback(
    (repoId: string, repoName?: string) => {
      openSetupWizard({ id: repoId, name: repoName ?? repos?.find((r) => r.id === repoId)?.name ?? repoId });
    },
    [openSetupWizard, repos],
  );

  /* ── add-repo modal (repo-tree `+ add` button + empty-state CTA) ── */

  const handleRepoRegistered = useCallback(
    (repo: RegisterRepoResult) => {
      refreshDashboards();
      // Expand the new repo in the tree and land on it, so "it appears in Docs immediately"
      // is literal -- the modal stays open showing the success pane until the human closes it.
      setExpandedRepos((prev) => (prev.has(repo.id) ? prev : new Set([...prev, repo.id])));
      if (!repo.alreadyRegistered) {
        navigateTo(repo.id);
        showToast({ kind: 'ok', text: `${repo.name} registered — indexing and watching now` });
      }
    },
    [refreshDashboards, showToast],
  );

  /* ── save-completion: refresh doc detail, its repo's docs, and the dashboards ── */

  const handleSaved = useCallback(() => {
    refetchDoc();
    if (route.repoId) refreshRepoDocs(route.repoId);
    refreshDashboards();
  }, [refetchDoc, route.repoId, refreshRepoDocs, refreshDashboards]);

  const handleSelectDoc = useCallback((repoId: string, docKey: string) => {
    navigateTo(repoId, docKey);
  }, []);

  const activeRepo = route.repoId ? repos?.find((r) => r.id === route.repoId) : undefined;
  const activeDocs = route.repoId ? docsByRepo[route.repoId] : undefined;
  const pathSegments = detail ? detail.doc.path.split('/') : [];
  const claudeBusy = activeRepo !== undefined && claudeBusyRepoId === activeRepo.id;
  // With a hull-mounted ship-inbox station, `#/inbox` belongs to the Inbox TAB (the one page,
  // Ship_Spec §5); standalone chartroom keeps rendering the docs-only InboxPage inside Docs.
  const hasInboxTab = tabs.some((tab) => tab.id === 'inbox');
  const showShipInbox = route.isInbox === true && hasInboxTab;
  const activeTabId = showShipInbox ? 'inbox' : route.tab;

  /* ── top chrome ── */

  const chrome = (
    <header className="chrome">
      <button
        type="button"
        className="chrome__brand"
        onClick={() => handleSelectTab('docs')}
        aria-label="Captain's Deck home"
      >
        <CompassMark />
        <span className="chrome__wordmark">THE&nbsp;SHIP&nbsp;—&nbsp;CAPTAIN&#8217;S&nbsp;DECK</span>
      </button>
      <div className="chrome__divider" />
      <nav className="chrome__crumbs" aria-label="Breadcrumbs">
        {route.tab === 'voyage' ? (
          <span className="crumb crumb--active">voyage</span>
        ) : route.tab === 'chapel' ? (
          <span className="crumb crumb--active">chapel</span>
        ) : route.tab === 'settings' ? (
          <span className="crumb crumb--active">settings</span>
        ) : route.tab === 'console' ? (
          <span className="crumb crumb--active">console</span>
        ) : route.isInbox ? (
          <span className="crumb crumb--active">inbox</span>
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
          <span className="crumb crumb--active">repos</span>
        )}
      </nav>
      <button
        type="button"
        className="chrome__claude"
        onClick={() => {
          if (activeRepo) handleOpenClaude(activeRepo.id);
        }}
        disabled={!activeRepo || claudeBusy}
        aria-label={activeRepo ? `Open Claude session in ${activeRepo.name}` : 'Open Claude session'}
        title={activeRepo ? `Open Claude session in ${activeRepo.name}` : 'Select a repo to open a Claude session'}
      >
        {claudeBusy ? (
          <>
            <span className="chrome__claude-spinner" aria-hidden="true" />
            session opening…
          </>
        ) : (
          '❯ claude'
        )}
      </button>
      <div className="chrome__spacer" />
      <button
        type="button"
        className="chrome__watched"
        onClick={() => {
          window.location.hash = INBOX_ROUTE;
        }}
        aria-label="Open inbox"
      >
        <span
          className={inboxCount !== null && inboxCount > 0 ? 'chrome__watched-dot chrome__watched-dot--alert' : 'chrome__watched-dot'}
          aria-hidden="true"
        />
        inbox{inboxCount !== null && inboxCount > 0 ? ` ${inboxCount}` : ''}
      </button>
      <span className="chrome__watched">
        <span className="chrome__watched-dot" aria-hidden="true" />
        {repos?.length ?? 0} watched
      </span>
    </header>
  );

  /* ── docs-tab center content ── */

  let center: ReactElement;
  if (route.isInbox) {
    center = <InboxPage onNavigate={(repoId, docKey) => navigateTo(repoId, docKey)} />;
  } else if (route.repoId && route.docKey && detail) {
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
  } else if (repos === null) {
    center = (
      <div className="paper-empty">
        <p>Loading…</p>
      </div>
    );
  } else {
    // Bare `#/`: the tracked-repos overview -- the Deck's landing pane (package 15).
    center = (
      <RepoOverview
        repos={repos}
        onSelect={(repoId) => navigateTo(repoId)}
        onAddRepo={() => setAddRepoOpen(true)}
        onOpenClaude={handleOpenClaude}
        onSetup={handleOpenSetup}
        claudeBusyRepoId={claudeBusyRepoId}
      />
    );
  }

  const noRepos = repos !== null && repos.length === 0;

  return (
    <div className="app-shell">
      {chrome}
      <TabBar tabs={tabs} activeTabId={activeTabId} onSelect={handleSelectTab} />
      <div className="app-shell__body">
        {route.tab === 'voyage' ? (
          <VoyagePage />
        ) : route.tab === 'chapel' ? (
          <ChapelPage />
        ) : route.tab === 'settings' ? (
          <SettingsPage />
        ) : route.tab === 'console' ? (
          <ConsolePage />
        ) : showShipInbox ? (
          <main className="paper-frame">
            <div className="paper">
              <ShipInboxPage
                onNavigate={(repoId, docKey) => navigateTo(repoId, docKey)}
                onChanged={refreshDashboards}
              />
            </div>
          </main>
        ) : noRepos ? (
          <div className="empty-state">
            <CompassMark large />
            <p className="empty-state__title">No repos registered yet</p>
            <button type="button" className="btn-rust empty-state__add" onClick={() => setAddRepoOpen(true)}>
              + add repo
            </button>
            <div className="empty-state__cmd">
              <span className="empty-state__or">from a terminal:</span>
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
              onAddRepo={() => setAddRepoOpen(true)}
            />
            <main className="paper-frame">
              <div className="paper">{center}</div>
            </main>
          </>
        )}
      </div>
      {addRepoOpen && (
        <AddRepoModal
          onClose={() => setAddRepoOpen(false)}
          onRegistered={handleRepoRegistered}
          onSetup={(repo) => {
            setAddRepoOpen(false);
            handleOpenSetup(repo.id, repo.name);
          }}
        />
      )}
      {setupWizardModal}
      {error && (
        <p className="app-shell__error" role="alert">
          {error}
        </p>
      )}
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
