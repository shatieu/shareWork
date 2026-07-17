import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { fetchSettingsFile, type SettingsFileResponse, type WritableSettingsScope } from '../api/client.js';
import type { DiffFlowApi } from './useDiffFlow.js';

export interface ScopeEditorProps {
  /** Selected project directory (absPath) -- project/local scopes need one. */
  project?: string;
  flow: DiffFlowApi;
  /** Bumped by the page whenever ANY section applies -- the D2 fix: the editor re-syncs with
   * the disk instead of silently going stale. */
  refreshToken: number;
  /** Reports the dirty state upward so the page can guard project switches (D3). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Called after a successful apply so the page can refresh the effective view. */
  onApplied: () => void;
}

const WRITABLE_SCOPES: readonly WritableSettingsScope[] = ['user', 'project', 'local'];

/**
 * Freeform settings editor with the non-negotiable rails (Trio_Specs §B): pick a writable
 * scope, edit the raw JSON, and the ONLY way out is "Preview diff" -- the shared diff modal
 * owns validation display, the baseHash apply ticket, and the 409 recoveries. There is no
 * direct-save path by design.
 *
 * Staleness/dirtiness contract (D2/D3 fixes): an external apply re-syncs a CLEAN editor from
 * disk; a DIRTY editor keeps the human's edits and flags the drift with an explicit
 * discard-and-reload affordance. Scope/project switches never silently discard edits.
 */
export function ScopeEditor({ project, flow, refreshToken, onDirtyChange, onApplied }: ScopeEditorProps): ReactElement {
  const [scope, setScope] = useState<WritableSettingsScope>('user');
  const [file, setFile] = useState<SettingsFileResponse | null>(null);
  const [content, setContent] = useState('');
  /** The disk bytes the current edit started from -- the dirty baseline. */
  const [savedContent, setSavedContent] = useState('');
  /** D2: the file changed on disk (another section applied) while local edits exist. */
  const [diskDrift, setDiskDrift] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** D6: preview-step failures render HERE, next to the button that triggered them. */
  const [previewError, setPreviewError] = useState<string | null>(null);

  const needsProject = scope !== 'user';
  const projectArg = needsProject ? project : undefined;

  const dirty = file !== null && content !== savedContent;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const savedRef = useRef(savedContent);
  savedRef.current = savedContent;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const load = useCallback(
    (options: { force: boolean }) => {
      if (needsProject && project === undefined) {
        setFile(null);
        setError(null);
        return;
      }
      fetchSettingsFile(scope, projectArg)
        .then((next) => {
          setFile(next);
          setError(null);
          if (options.force || !dirtyRef.current) {
            setContent(next.content);
            setSavedContent(next.content);
            setDiskDrift(false);
          } else {
            // Dirty: never clobber the human's edits -- flag the drift instead (D2).
            setDiskDrift(next.content !== savedRef.current);
          }
        })
        .catch((err: unknown) => {
          setFile(null);
          setError(err instanceof Error ? err.message : String(err));
        });
    },
    [scope, project, needsProject, projectArg],
  );

  // Identity change (scope or project): fresh load. Discard guards run BEFORE the switch --
  // at the scope select below and at the page's project picker (via onDirtyChange).
  useEffect(() => {
    load({ force: true });
  }, [load]);

  // External refresh (another section applied): re-sync if clean, flag drift if dirty (D2).
  const lastToken = useRef(refreshToken);
  useEffect(() => {
    if (lastToken.current === refreshToken) return;
    lastToken.current = refreshToken;
    load({ force: false });
  }, [refreshToken, load]);

  return (
    <section className="settings-panel" aria-label="Settings editor">
      <h2 className="settings-panel__title">Editor</h2>
      <p className="settings-panel__hint">
        Every save goes through a diff preview, schema validation, a timestamped backup, and an atomic write -- no
        silent writes, ever.
      </p>
      <div className="settings-editor__bar">
        <label className="settings-field">
          scope
          <select
            className="settings-select"
            aria-label="Editor scope"
            value={scope}
            onChange={(event) => {
              const next = event.target.value as WritableSettingsScope;
              // D3: switching away from unsaved edits requires an explicit confirmation.
              if (dirtyRef.current && !window.confirm('Discard unsaved edits in this settings file?')) return;
              setScope(next);
            }}
          >
            {WRITABLE_SCOPES.map((name) => (
              <option key={name} value={name} disabled={name !== 'user' && project === undefined}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {file && (
          <span className="settings-editor__path" title={file.path}>
            {file.path}
            {!file.exists && ' (will be created)'}
          </span>
        )}
      </div>

      {needsProject && project === undefined ? (
        <p className="settings-rules__empty">Select a project to edit its {scope} settings.</p>
      ) : error ? (
        <p className="app-shell__error" role="alert">
          {error}
        </p>
      ) : file === null ? (
        <p className="settings-rules__empty">Loading…</p>
      ) : (
        <>
          {file.error && (
            <p className="settings-excluded" role="alert">
              This file is currently malformed ({file.error}) -- fix it here or restore a backup; the diff modal will
              require an explicit overwrite confirmation.
            </p>
          )}
          {diskDrift && (
            <p className="settings-excluded" role="alert">
              This file changed on disk since you started editing -- previewing now proposes replacing that change
              with your version.{' '}
              <button type="button" className="ship-inbox__btn" onClick={() => load({ force: true })}>
                Load disk version (discards my edits)
              </button>
            </p>
          )}
          <textarea
            className="settings-editor__textarea"
            aria-label="Settings file content"
            spellCheck={false}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={14}
          />
          {previewError && (
            <p className="app-shell__error" role="alert">
              {previewError}
            </p>
          )}
          <div className="settings-editor__actions">
            <button
              type="button"
              className="btn-brass"
              onClick={() => {
                setPreviewError(null);
                flow.openEdit({
                  title: `Edit ${scope} settings`,
                  scope,
                  project: projectArg,
                  newContent: content,
                  onOpenError: setPreviewError,
                  onApplied: () => {
                    load({ force: true });
                    onApplied();
                  },
                });
              }}
            >
              Preview diff
            </button>
            <button type="button" className="ship-inbox__btn" onClick={() => load({ force: true })}>
              reload from disk
            </button>
          </div>
        </>
      )}
    </section>
  );
}
