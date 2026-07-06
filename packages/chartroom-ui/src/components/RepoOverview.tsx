import type { ReactElement } from 'react';
import type { RepoSummary } from '../api/client.js';

export interface RepoOverviewProps {
  repos: RepoSummary[];
  onSelect: (repoId: string) => void;
  onAddRepo: () => void;
  onOpenClaude: (repoId: string) => void;
  claudeBusyRepoId: string | null;
}

/**
 * Tracked-repos overview -- the Deck's landing pane at the bare `#/` route (package 15 scope
 * addition). One card per registered repo, rendered purely from the `GET /api/repos` summary the
 * shell already fetches (doc count + broken-links / needs-you badges; no new stats endpoints).
 * Card click lands on that repo's Docs; the Add-repo button opens the host's modal.
 */
export function RepoOverview({
  repos,
  onSelect,
  onAddRepo,
  onOpenClaude,
  claudeBusyRepoId,
}: RepoOverviewProps): ReactElement {
  return (
    <section className="repo-overview" aria-label="Tracked repos">
      <div className="repo-overview__head">
        <h1 className="repo-overview__title">Tracked repos</h1>
        <span className="chrome__spacer" />
        <button type="button" className="btn-rust" onClick={onAddRepo}>
          + add repo
        </button>
      </div>
      <p className="repo-overview__sub">
        {repos.length} repo{repos.length === 1 ? '' : 's'} watched by the chart room. Pick one to browse its docs.
      </p>
      <ul className="repo-overview__grid">
        {repos.map((repo) => {
          const busy = claudeBusyRepoId === repo.id;
          return (
            <li key={repo.id} className="repo-card">
              <button
                type="button"
                className="repo-card__main"
                onClick={() => onSelect(repo.id)}
                title={repo.absPath}
                aria-label={`Open ${repo.name}`}
              >
                <span className="repo-avatar repo-card__avatar" aria-hidden="true">
                  {repo.name.charAt(0)}
                </span>
                <span className="repo-card__name">{repo.name}</span>
                <span className="repo-card__path">{repo.absPath}</span>
                <span className="repo-card__stats">
                  <span className="repo-card__stat">
                    {repo.docCount} doc{repo.docCount === 1 ? '' : 's'}
                  </span>
                  {repo.brokenLinkCount > 0 && (
                    <span className="badge-alert" title={`${repo.brokenLinkCount} broken link${repo.brokenLinkCount === 1 ? '' : 's'}`}>
                      {repo.brokenLinkCount}
                    </span>
                  )}
                  {repo.needsYouCount > 0 && (
                    <span className="badge-needs" title={`${repo.needsYouCount} item${repo.needsYouCount === 1 ? '' : 's'} need you`}>
                      {repo.needsYouCount}
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                className={busy ? 'tree-repo-row__claude tree-repo-row__claude--busy repo-card__claude' : 'tree-repo-row__claude repo-card__claude'}
                onClick={() => onOpenClaude(repo.id)}
                disabled={busy}
                aria-label={`Open Claude session in ${repo.name}`}
                title="Open Claude session in this repo"
              >
                {busy ? '…' : '❯_'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
