import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactElement } from 'react';
import { fetchDoc, fetchDocs, fetchRepos, type DocDetail, type DocSummary, type RepoSummary } from './api/client.js';
import { RepoSwitcher } from './components/RepoSwitcher.js';
import { Sidebar } from './components/Sidebar.js';
import { DocView } from './components/DocView.js';

interface HashRoute {
  repoId?: string;
  docId?: string;
}

// Hash-based navigation (#/repo/<repoId>/doc/<docId>), no router dependency (plan §1.7) -- the
// hash fragment never reaches the server, so @fastify/static's default "serve index.html for `/`"
// behavior already handles deep-link refreshes with zero SPA-fallback config on the daemon side.
const ROUTE_RE = /^#\/repo\/([^/]+)(?:\/doc\/([^/]+))?$/;

function subscribeHash(callback: () => void): () => void {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

function getHashSnapshot(): string {
  return window.location.hash;
}

function parseHash(hash: string): HashRoute {
  const match = ROUTE_RE.exec(hash);
  if (!match) return {};
  return {
    repoId: decodeURIComponent(match[1]),
    docId: match[2] ? decodeURIComponent(match[2]) : undefined,
  };
}

function navigateTo(repoId: string, docId?: string): void {
  window.location.hash = docId
    ? `#/repo/${encodeURIComponent(repoId)}/doc/${encodeURIComponent(docId)}`
    : `#/repo/${encodeURIComponent(repoId)}`;
}

export default function App(): ReactElement {
  const hash = useSyncExternalStore(subscribeHash, getHashSnapshot, getHashSnapshot);
  const route = useMemo(() => parseHash(hash), [hash]);

  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRepos()
      .then((r) => {
        setRepos(r);
        // Auto-select the first repo if no route is set yet -- otherwise "browse two registered
        // repos in one UI" would need a manual first click with nothing to look at.
        if (!parseHash(window.location.hash).repoId && r.length > 0) {
          navigateTo(r[0].id);
        }
      })
      .catch((err: unknown) => setError(String(err)));
  }, []);

  useEffect(() => {
    if (!route.repoId) {
      setDocs([]);
      return;
    }
    fetchDocs(route.repoId)
      .then(setDocs)
      .catch((err: unknown) => setError(String(err)));
  }, [route.repoId]);

  const refetchDoc = useCallback(() => {
    if (!route.repoId || !route.docId) return;
    fetchDoc(route.repoId, route.docId)
      .then(setDetail)
      .catch((err: unknown) => setError(String(err)));
  }, [route.repoId, route.docId]);

  useEffect(() => {
    if (!route.repoId || !route.docId) {
      setDetail(null);
      return;
    }
    refetchDoc();
    // (refetchDoc itself is derived from route.repoId/route.docId via useCallback below, so this
    // effect's own dependency array intentionally lists the primitives rather than the callback.)
  }, [route.repoId, route.docId]);

  const handleSelectRepo = useCallback((repoId: string) => navigateTo(repoId), []);
  const handleSelectDoc = useCallback(
    (docId: string) => {
      if (route.repoId) navigateTo(route.repoId, docId);
    },
    [route.repoId],
  );

  // Save-completion callback (plan §8's App.tsx wiring): a successful DocEditor save re-fetches
  // both this doc's detail (fresh raw/backlinks/brokenLinks) and the repo's doc list (title/path
  // may have changed if the edit touched frontmatter-derived display fields upstream via a
  // rebuild) -- mirrors the existing per-route-change re-fetch pattern above, just triggered by a
  // save instead of a hash-route change.
  const handleSaved = useCallback(() => {
    refetchDoc();
    if (route.repoId) {
      fetchDocs(route.repoId)
        .then(setDocs)
        .catch((err: unknown) => setError(String(err)));
    }
  }, [refetchDoc, route.repoId]);

  return (
    <div className="app-shell">
      <RepoSwitcher repos={repos} activeRepoId={route.repoId} onSelect={handleSelectRepo} />
      <div className="app-shell__body">
        {route.repoId && (
          <Sidebar docs={docs} activeDocId={route.docId} onSelectDoc={handleSelectDoc} raw={detail?.raw} />
        )}
        <main className="app-shell__main">
          {error && <p className="app-shell__error">{error}</p>}
          {route.repoId && route.docId && detail ? (
            <DocView
              repoId={route.repoId}
              docId={route.docId}
              detail={detail}
              docs={docs}
              onSelectDoc={handleSelectDoc}
              onSaved={handleSaved}
            />
          ) : (
            <p className="app-shell__placeholder">Select a repo and a doc to begin browsing.</p>
          )}
        </main>
      </div>
    </div>
  );
}
