import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { registerRepoRequest, type RegisterRepoResult } from '../api/client.js';

export interface AddRepoModalProps {
  onClose: () => void;
  /** Called after every successful registration so the host refreshes the repo list. */
  onRegistered: (repo: RegisterRepoResult) => void;
}

/**
 * "Add repo" modal (package 15): a validated path input over `POST /api/repos/register` -- the
 * daemon resolves the git root server-side and rejects non-repo paths with a readable error, so
 * the browser never needs filesystem enumeration (the quarantined folder-picker's `/api/fs/list`
 * stays parked per the security rail). Shell (overlay, Esc, done pane) salvaged from the
 * quarantined RegisterRepoModal. Registration is live: the daemon serves and watches the repo
 * immediately, no restart.
 */
export function AddRepoModal({ onClose, onRegistered }: AddRepoModalProps): ReactElement {
  const [path, setPath] = useState('');
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<RegisterRepoResult | null>(null);

  useEffect(() => {
    function onEsc(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = path.trim();
    if (!trimmed || registering) return;
    setRegistering(true);
    setError(null);
    registerRepoRequest(trimmed)
      .then((result) => {
        setRegistered(result);
        onRegistered(result);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setRegistering(false));
  }

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal register-modal" role="dialog" aria-label="Add a repo">
        <div className="register-modal__head">
          <h2 className="panel__label">Add repo</h2>
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
                  setError(null);
                  setPath('');
                }}
              >
                add another…
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="register-modal__label" htmlFor="add-repo-path">
              Absolute path of a local git repo (or any folder inside one)
            </label>
            <input
              id="add-repo-path"
              className="register-modal__input"
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="C:\repos\my-project"
              spellCheck={false}
              autoFocus
              disabled={registering}
            />

            {error && (
              <p className="register-modal__error" role="alert">
                {error}
              </p>
            )}

            <div className="register-modal__footer">
              <span className="register-modal__hint">
                The chart room finds the repo&#8217;s git root itself and starts watching it immediately.
              </span>
              <button type="submit" className="btn-rust" disabled={registering || path.trim() === ''}>
                {registering ? 'registering…' : 'add repo'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
