import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { fetchSettingsFile, type SettingsFileResponse, type WritableSettingsScope } from '../api/client.js';
import type { DiffFlowApi } from './useDiffFlow.js';

export interface ScopeEditorProps {
  /** Selected project directory (absPath) -- project/local scopes need one. */
  project?: string;
  flow: DiffFlowApi;
  /** Called after a successful apply so the page can refresh the effective view. */
  onApplied: () => void;
}

const WRITABLE_SCOPES: readonly WritableSettingsScope[] = ['user', 'project', 'local'];

/**
 * Freeform settings editor with the non-negotiable rails (Trio_Specs §B): pick a writable
 * scope, edit the raw JSON, and the ONLY way out is "Preview diff" -- the shared diff modal
 * owns validation display, the baseHash apply ticket, and the 409 recoveries. There is no
 * direct-save path by design.
 */
export function ScopeEditor({ project, flow, onApplied }: ScopeEditorProps): ReactElement {
  const [scope, setScope] = useState<WritableSettingsScope>('user');
  const [file, setFile] = useState<SettingsFileResponse | null>(null);
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const needsProject = scope !== 'user';
  const projectArg = needsProject ? project : undefined;

  const load = useCallback(() => {
    if (needsProject && project === undefined) {
      setFile(null);
      setError(null);
      return;
    }
    fetchSettingsFile(scope, projectArg)
      .then((next) => {
        setFile(next);
        setContent(next.content);
        setError(null);
      })
      .catch((err: unknown) => {
        setFile(null);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [scope, project, needsProject, projectArg]);

  useEffect(() => {
    load();
  }, [load]);

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
            onChange={(event) => setScope(event.target.value as WritableSettingsScope)}
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
          <textarea
            className="settings-editor__textarea"
            aria-label="Settings file content"
            spellCheck={false}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={14}
          />
          <div className="settings-editor__actions">
            <button
              type="button"
              className="btn-brass"
              onClick={() =>
                flow.openEdit({
                  title: `Edit ${scope} settings`,
                  scope,
                  project: projectArg,
                  newContent: content,
                  onApplied: () => {
                    load();
                    onApplied();
                  },
                })
              }
            >
              Preview diff
            </button>
            <button type="button" className="ship-inbox__btn" onClick={load}>
              reload from disk
            </button>
          </div>
        </>
      )}
    </section>
  );
}
