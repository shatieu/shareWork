import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { registerRepoRequest, type RegisterRepoResult } from '../api/client.js';
import { FolderPickerModal } from './FolderPickerModal.js';

export interface AddRepoModalProps {
  onClose: () => void;
  /** Called after every successful registration so the host refreshes the repo list. */
  onRegistered: (repo: RegisterRepoResult) => void;
  /** Success-pane "Set up this repo" -- the host closes this modal and opens the setup wizard. */
  onSetup: (repo: RegisterRepoResult) => void;
}

/**
 * "Add repo" modal (package 15 + deck-onboarding-wizard): a validated path input over
 * `POST /api/repos/register` -- the daemon resolves the git root server-side and rejects
 * non-repo paths with a readable error. The path input stays as the power-user path; the Browse
 * button opens the folder picker over the Captain-approved `/api/fs/list` browser. Registration
 * is live: the daemon serves and watches the repo immediately, no restart. The success pane
 * hands off to the setup wizard via `onSetup`.
 */
export function AddRepoModal({ onClose, onRegistered, onSetup }: AddRepoModalProps): ReactElement {
  const [path, setPath] = useState('');
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<RegisterRepoResult | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    function onEsc(event: KeyboardEvent): void {
      // With the folder picker stacked on top, Esc belongs to the picker (it closes itself).
      if (event.key === 'Escape' && !pickerOpen) onClose();
    }
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose, pickerOpen]);

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
              <button type="button" className="btn-rust" onClick={() => onSetup(registered)}>
                Set up this repo
              </button>
              <button type="button" className="btn-brass" onClick={onClose}>
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
            <div className="register-modal__pathrow">
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
              <button
                type="button"
                className="btn-brass"
                onClick={() => setPickerOpen(true)}
                disabled={registering}
              >
                browse…
              </button>
            </div>

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

        {pickerOpen && (
          <FolderPickerModal
            initialPath={path.trim() || undefined}
            onSelect={(absPath) => {
              setPath(absPath);
              setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
