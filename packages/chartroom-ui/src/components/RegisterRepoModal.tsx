import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  fetchFsList,
  registerRepoRequest,
  type FsDirEntry,
  type FsListResponse,
  type RegisterRepoResult,
} from '../api/client.js';

export interface RegisterRepoModalProps {
  onClose: () => void;
  /** Called after a successful registration so the host refreshes the repo list. */
  onRegistered: (repo: RegisterRepoResult) => void;
}

/**
 * "Register repo" folder picker (user feedback: selecting a folder, not pasting a path). Browses
 * the daemon machine's filesystem via `GET /api/fs/list` — drives → folders — and registers the
 * chosen folder via `POST /api/repos/register`. Git repos are badged; registering any folder
 * inside a repo resolves to that repo's git root server-side. Registration is live: the daemon
 * starts serving and watching the repo immediately.
 */
export function RegisterRepoModal({ onClose, onRegistered }: RegisterRepoModalProps): ReactElement {
  const [listing, setListing] = useState<FsListResponse | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registered, setRegistered] = useState<RegisterRepoResult | null>(null);

  const browse = useCallback((path?: string | null) => {
    setBrowseError(null);
    fetchFsList(path)
      .then(setListing)
      .catch((err: unknown) => setBrowseError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    // Start at the user's home directory — repos overwhelmingly live under it.
    fetchFsList()
      .then((roots) => {
        browse(roots.home);
      })
      .catch((err: unknown) => setBrowseError(err instanceof Error ? err.message : String(err)));
  }, [browse]);

  useEffect(() => {
    function onEsc(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const doRegister = useCallback(
    (path: string) => {
      setRegistering(true);
      setRegisterError(null);
      registerRepoRequest(path)
        .then((result) => {
          setRegistered(result);
          onRegistered(result);
        })
        .catch((err: unknown) => setRegisterError(err instanceof Error ? err.message : String(err)))
        .finally(() => setRegistering(false));
    },
    [onRegistered],
  );

  function renderDir(dir: FsDirEntry): ReactElement {
    return (
      <div key={dir.path} className="fs-row">
        <button type="button" className="fs-row__enter" onClick={() => browse(dir.path)} title={dir.path}>
          <span className="fs-row__icon" aria-hidden="true">
            ▤
          </span>
          <span className="fs-row__name">{dir.name}</span>
          {dir.isGitRepo && <span className="fs-row__git">git</span>}
        </button>
        {dir.isGitRepo && (
          <button
            type="button"
            className="fs-row__register"
            disabled={registering}
            onClick={() => doRegister(dir.path)}
          >
            register
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal register-modal" role="dialog" aria-label="Register a repo">
        <div className="register-modal__head">
          <h2 className="panel__label">Register repo — pick a folder</h2>
          <span className="chrome__spacer" />
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {registered ? (
          <div className="register-modal__done">
            <p>
              <strong>✓ {registered.alreadyRegistered ? 'Already registered' : 'Registered'}</strong> —{' '}
              <code>{registered.name}</code> at <code>{registered.absPath}</code>
              {registered.alreadyRegistered ? '.' : ' is being indexed and watched now.'}
            </p>
            <div className="register-modal__done-actions">
              <button type="button" className="btn-rust" onClick={onClose}>
                Done
              </button>
              <button
                type="button"
                className="btn-brass"
                onClick={() => {
                  setRegistered(null);
                  setRegisterError(null);
                }}
              >
                register another…
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="register-modal__pathbar">
              <button type="button" className="btn-brass" onClick={() => browse(null)} title="Filesystem roots">
                drives
              </button>
              <button type="button" className="btn-brass" onClick={() => listing && browse(listing.home)}>
                home
              </button>
              <button
                type="button"
                className="btn-brass"
                disabled={!listing?.parent}
                onClick={() => listing?.parent && browse(listing.parent)}
              >
                ↑ up
              </button>
              <code className="register-modal__path" title={listing?.path ?? ''}>
                {listing?.path ?? 'This PC'}
              </code>
            </div>

            <div className="register-modal__list">
              {browseError ? (
                <p className="register-modal__error" role="alert">
                  {browseError}
                </p>
              ) : listing === null ? (
                <p className="register-modal__loading">loading…</p>
              ) : listing.dirs.length === 0 ? (
                <p className="register-modal__loading">no subfolders</p>
              ) : (
                listing.dirs.map(renderDir)
              )}
            </div>

            {registerError && (
              <p className="register-modal__error" role="alert">
                {registerError}
              </p>
            )}

            <div className="register-modal__footer">
              <span className="register-modal__hint">
                Folders marked <span className="fs-row__git">git</span> register directly; registering any folder
                inside a repo registers that repo's git root.
              </span>
              {listing?.path && (
                <button
                  type="button"
                  className="btn-rust"
                  disabled={registering}
                  onClick={() => doRegister(listing.path as string)}
                >
                  {registering ? 'registering…' : 'register this folder'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
