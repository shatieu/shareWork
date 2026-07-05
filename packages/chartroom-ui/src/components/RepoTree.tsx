import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { docKeyOf, type DocSummary, type RepoSummary } from '../api/client.js';

export interface RepoTreeProps {
  repos: RepoSummary[];
  /** per-repo doc lists, fetched lazily by the host for every expanded repo. */
  docsByRepo: Record<string, DocSummary[] | undefined>;
  expandedRepos: Set<string>;
  onToggleRepo: (repoId: string) => void;
  activeRepoId?: string;
  activeDocKey?: string;
  onSelectDoc: (repoId: string, docKey: string) => void;
  collapsed: boolean;
  onSetCollapsed: (collapsed: boolean) => void;
  onOpenClaude: (repoId: string) => void;
  claudeBusyRepoId: string | null;
}

interface FolderNode {
  name: string;
  /** repo-relative folder path ('' for the repo root). */
  path: string;
  folders: FolderNode[];
  docs: DocSummary[];
}

/** Builds the nested folder tree from flat repo-relative doc paths, client-side. */
function buildTree(docs: DocSummary[]): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: [], docs: [] };
  for (const doc of docs) {
    const segments = doc.path.split('/');
    let node = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i];
      let child = node.folders.find((f) => f.name === segment);
      if (!child) {
        child = { name: segment, path: node.path ? `${node.path}/${segment}` : segment, folders: [], docs: [] };
        node.folders.push(child);
      }
      node = child;
    }
    node.docs.push(doc);
  }
  const sortNode = (node: FolderNode): void => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name));
    node.docs.sort((a, b) => a.path.localeCompare(b.path));
    node.folders.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

function fileNameOf(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

/** Consistent tree indentation: rows keep their full clickable width and indent via
 * padding only (the WIP mixed paddingLeft on folders with marginLeft on docs, which
 * shrank doc rows and misaligned the two by 2px per level). */
function indentOf(depth: number): { paddingLeft: number } {
  return { paddingLeft: 22 + depth * 16 };
}

const COLLAPSED_FOLDERS_KEY = 'chartroom.tree.collapsedFolders';

function loadCollapsedFolders(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_FOLDERS_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* ignore */
  }
  return new Set();
}

/**
 * LOCAL REPOS rail (left column): repo rows with brass initial avatars, alert badges
 * (broken links + needs-you counts), collapsible folder groups built from real doc paths,
 * active-doc rust highlight, and a per-repo "open Claude session" hover action. Collapses
 * to a 52px brass icon rail. Expansion state persists in localStorage (repos via the host,
 * folders locally). Registration stays a CLI act (`chartroom register <path>`) -- the
 * folder-picker modal is parked on the quarantine branch.
 */
export function RepoTree({
  repos,
  docsByRepo,
  expandedRepos,
  onToggleRepo,
  activeRepoId,
  activeDocKey,
  onSelectDoc,
  collapsed,
  onSetCollapsed,
  onOpenClaude,
  claudeBusyRepoId,
}: RepoTreeProps): ReactElement {
  // Folders default to *open*; only explicitly-collapsed ones are stored (keys `repoId::path`).
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(loadCollapsedFolders);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify([...collapsedFolders]));
    } catch {
      /* ignore */
    }
  }, [collapsedFolders]);

  const trees = useMemo(() => {
    const out: Record<string, FolderNode> = {};
    for (const repo of repos) {
      const docs = docsByRepo[repo.id];
      if (docs) out[repo.id] = buildTree(docs);
    }
    return out;
  }, [repos, docsByRepo]);

  if (collapsed) {
    return (
      <nav className="panel repo-rail" aria-label="Local repos">
        <button
          type="button"
          className="repo-rail__expand"
          onClick={() => onSetCollapsed(false)}
          title="expand"
          aria-label="Expand repo panel"
        >
          »
        </button>
        <div className="repo-rail__divider" aria-hidden="true" />
        {repos.map((repo) => {
          const alert = repo.brokenLinkCount + repo.needsYouCount;
          return (
            <button
              key={repo.id}
              type="button"
              className="repo-rail__repo"
              title={repo.name}
              aria-label={`Expand ${repo.name}`}
              onClick={() => {
                onSetCollapsed(false);
                if (!expandedRepos.has(repo.id)) onToggleRepo(repo.id);
              }}
            >
              {repo.name.charAt(0)}
              {alert > 0 && <span className="repo-rail__repo-badge" aria-hidden="true" />}
            </button>
          );
        })}
      </nav>
    );
  }

  function renderFolder(repo: RepoSummary, folder: FolderNode, depth: number): ReactElement {
    const folderKey = `${repo.id}::${folder.path}`;
    const isOpen = !collapsedFolders.has(folderKey);
    return (
      <li key={folderKey} role="treeitem" aria-expanded={isOpen} aria-label={folder.name}>
        <button
          type="button"
          className="tree-folder-row"
          style={indentOf(depth)}
          onClick={() =>
            setCollapsedFolders((prev) => {
              const next = new Set(prev);
              if (next.has(folderKey)) next.delete(folderKey);
              else next.add(folderKey);
              return next;
            })
          }
        >
          <span className="tree-folder-row__chev" aria-hidden="true">
            {isOpen ? '▾' : '▸'}
          </span>
          <span className="tree-folder-row__icon" aria-hidden="true">
            ▤
          </span>
          <span>{folder.name}</span>
        </button>
        {isOpen && <ul role="group">{renderChildren(repo, folder, depth + 1)}</ul>}
      </li>
    );
  }

  function renderChildren(repo: RepoSummary, node: FolderNode, depth: number): ReactElement[] {
    const rows: ReactElement[] = node.folders.map((folder) => renderFolder(repo, folder, depth));
    for (const doc of node.docs) {
      const key = docKeyOf(doc);
      const isActive = repo.id === activeRepoId && key === activeDocKey;
      rows.push(
        <li key={`${repo.id}::${doc.path}`} role="treeitem" aria-selected={isActive}>
          <button
            type="button"
            className={isActive ? 'tree-doc-row tree-doc-row--active' : 'tree-doc-row'}
            style={indentOf(depth)}
            title={doc.id ?? doc.path}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelectDoc(repo.id, key)}
          >
            <span className="tree-doc-row__bullet" aria-hidden="true">
              {isActive ? '' : '◦'}
            </span>
            <span className="tree-doc-row__name">{fileNameOf(doc.path)}</span>
          </button>
        </li>,
      );
    }
    return rows;
  }

  return (
    <nav className="panel repo-tree" aria-label="Local repos">
      <div className="repo-tree__head">
        <h2 className="panel__label">Local repos</h2>
        <div className="chrome__spacer" />
        <button
          type="button"
          className="repo-tree__collapse"
          onClick={() => onSetCollapsed(true)}
          title="collapse"
          aria-label="Collapse repo panel"
        >
          «
        </button>
      </div>
      <div className="repo-tree__scroll">
        <ul className="repo-tree__list" role="tree" aria-label="Repos and docs">
          {repos.map((repo) => {
            const isOpen = expandedRepos.has(repo.id);
            const docs = docsByRepo[repo.id];
            const tree = trees[repo.id];
            const busy = claudeBusyRepoId === repo.id;
            return (
              <li key={repo.id} role="treeitem" aria-expanded={isOpen} aria-label={repo.name}>
                <div className="tree-repo-row">
                  <button
                    type="button"
                    className="tree-repo-row__main"
                    onClick={() => onToggleRepo(repo.id)}
                    title={repo.absPath}
                  >
                    <span className="tree-repo-row__chev" aria-hidden="true">
                      {isOpen ? '▾' : '▸'}
                    </span>
                    <span className="repo-avatar" aria-hidden="true">
                      {repo.name.charAt(0)}
                    </span>
                    <span className="tree-repo-row__name">{repo.name}</span>
                  </button>
                  <button
                    type="button"
                    className={busy ? 'tree-repo-row__claude tree-repo-row__claude--busy' : 'tree-repo-row__claude'}
                    onClick={() => onOpenClaude(repo.id)}
                    disabled={busy}
                    aria-label={`Open Claude session in ${repo.name}`}
                    title="Open Claude session in this repo"
                  >
                    {busy ? '…' : '❯_'}
                  </button>
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
                  <span className="tree-repo-row__count">{repo.docCount}</span>
                </div>
                {isOpen &&
                  (docs === undefined ? (
                    <p className="repo-tree__loading">loading…</p>
                  ) : docs.length === 0 ? (
                    <p className="repo-tree__loading">no docs yet</p>
                  ) : (
                    tree && <ul role="group">{renderChildren(repo, tree, 0)}</ul>
                  ))}
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
