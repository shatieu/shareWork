import type { ReactElement } from 'react';
import type { RepoSummary } from '../api/client.js';

export interface RepoSwitcherProps {
  repos: RepoSummary[];
  activeRepoId?: string;
  onSelect: (repoId: string) => void;
}

/** Repo list/switcher UI (plan §3) -- lets the user switch between all repos registered via
 * `chartroom register`, satisfying the "browse two registered repos in one UI" acceptance line. */
export function RepoSwitcher({ repos, activeRepoId, onSelect }: RepoSwitcherProps): ReactElement {
  return (
    <header className="repo-switcher">
      <span className="repo-switcher__brand">Chart Room</span>
      <nav className="repo-switcher__list">
        {repos.length === 0 && <span className="repo-switcher__empty">No repos registered yet.</span>}
        {repos.map((repo) => (
          <button
            key={repo.id}
            type="button"
            title={repo.absPath}
            className={
              repo.id === activeRepoId ? 'repo-switcher__repo repo-switcher__repo--active' : 'repo-switcher__repo'
            }
            onClick={() => onSelect(repo.id)}
          >
            {repo.name}
          </button>
        ))}
      </nav>
    </header>
  );
}
