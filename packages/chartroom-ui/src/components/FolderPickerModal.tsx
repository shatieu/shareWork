import { useEffect, useState, type ReactElement } from 'react';
import { fsListRequest, type FsEntry, type FsListResponse } from '../api/client.js';

export interface FolderPickerModalProps {
  /** Start browsing here when it looks like an absolute path; the roots view otherwise. */
  initialPath?: string;
  /** Returns the picked absolute path (a highlighted entry, else the directory being browsed). */
  onSelect: (absPath: string) => void;
  onClose: () => void;
}

export interface FolderCrumb {
  label: string;
  path: string;
}

/**
 * Breadcrumb segments for an absolute path, every ancestor clickable. Pure + exported for tests.
 * Windows drive roots keep their trailing separator (`C:\`) so navigating to a bare drive works;
 * unix paths get a leading `/` root crumb.
 */
export function crumbsOf(absPath: string): FolderCrumb[] {
  const parts = absPath.split(/[\\/]+/).filter((part) => part.length > 0);
  const crumbs: FolderCrumb[] = [];
  if (/^[A-Za-z]:$/.test(parts[0] ?? '')) {
    const drive = parts.shift() as string;
    crumbs.push({ label: `${drive}\\`, path: `${drive}\\` });
    let acc = drive;
    for (const part of parts) {
      acc += `\\${part}`;
      crumbs.push({ label: part, path: acc });
    }
  } else {
    crumbs.push({ label: '/', path: '/' });
    let acc = '';
    for (const part of parts) {
      acc += `/${part}`;
      crumbs.push({ label: part, path: acc });
    }
  }
  return crumbs;
}

/**
 * Folder picker over the daemon's `GET /api/fs/list` directory browser (deck-onboarding-wizard
 * plan: the Captain-approved revival of the quarantined fs-browse route -- directories only,
 * server-side hardening). Opened from the Add-repo modal's Browse button; the typed path input
 * stays as the power-user path. Single click highlights, double click descends, breadcrumb
 * ancestors (and the roots view) are one click away.
 */
export function FolderPickerModal({ initialPath, onSelect, onClose }: FolderPickerModalProps): ReactElement {
  // undefined = the roots view (drive letters on win32, home + `/` elsewhere).
  const [reqPath, setReqPath] = useState<string | undefined>(
    initialPath && initialPath.trim() !== '' ? initialPath.trim() : undefined,
  );
  const [listing, setListing] = useState<FsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<FsEntry | null>(null);

  useEffect(() => {
    function onEsc(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHighlighted(null);
    fsListRequest(reqPath)
      .then((next) => {
        if (cancelled) return;
        setListing(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Keep the crumbs usable: a 404 on a stale/bogus initial path still lets the human climb
        // to an ancestor or the roots view (crumbs derive from the REQUESTED path, not the reply).
        setListing(null);
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reqPath]);

  const crumbs = reqPath !== undefined ? crumbsOf(reqPath) : listing?.path ? crumbsOf(listing.path) : [];
  // What Select would return: the highlighted entry wins; else the directory being browsed.
  const selectable = highlighted?.path ?? listing?.path ?? null;

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal register-modal folder-picker" role="dialog" aria-label="Pick a folder">
        <div className="register-modal__head">
          <h2 className="panel__label">Pick a folder</h2>
          <span className="chrome__spacer" />
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close folder picker">
            ✕
          </button>
        </div>

        <nav className="folder-picker__crumbs" aria-label="Folder path">
          <button
            type="button"
            className={reqPath === undefined ? 'folder-picker__crumb folder-picker__crumb--active' : 'folder-picker__crumb'}
            onClick={() => setReqPath(undefined)}
          >
            computer
          </button>
          {crumbs.map((crumb, i) => (
            <span key={crumb.path} className="folder-picker__crumb-seg">
              <span className="folder-picker__crumb-sep" aria-hidden="true">
                ›
              </span>
              <button
                type="button"
                className={
                  i === crumbs.length - 1
                    ? 'folder-picker__crumb folder-picker__crumb--active'
                    : 'folder-picker__crumb'
                }
                onClick={() => setReqPath(crumb.path)}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>

        {error && (
          <p className="register-modal__error" role="alert">
            {error}
          </p>
        )}

        <div className="register-modal__list folder-picker__list">
          {loading ? (
            <p className="register-modal__loading">listing…</p>
          ) : listing && listing.entries.length > 0 ? (
            <ul className="folder-picker__entries">
              {listing.entries.map((entry) => (
                <li key={entry.path} className={highlighted?.path === entry.path ? 'fs-row fs-row--active' : 'fs-row'}>
                  <button
                    type="button"
                    className="fs-row__enter"
                    onClick={() => setHighlighted(entry)}
                    onDoubleClick={() => setReqPath(entry.path)}
                    title={`${entry.path} (double-click to open)`}
                    aria-label={entry.name}
                  >
                    <span className="fs-row__icon" aria-hidden="true">
                      ▸
                    </span>
                    <span className="fs-row__name">{entry.name}</span>
                    {entry.isGitRepo && <span className="fs-row__git">git</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : listing ? (
            <p className="register-modal__loading">no subfolders here.</p>
          ) : null}
        </div>

        <div className="register-modal__footer">
          <span className="register-modal__hint">
            {selectable ? <code>{selectable}</code> : 'Pick a drive or folder, double-click to open it.'}
          </span>
          <button type="button" className="btn-brass" onClick={onClose}>
            cancel
          </button>
          <button
            type="button"
            className="btn-rust"
            disabled={loading || selectable === null}
            onClick={() => {
              if (selectable !== null) onSelect(selectable);
            }}
          >
            select
          </button>
        </div>
      </div>
    </div>
  );
}
