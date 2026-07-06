import { useEffect, useState, type ReactElement } from 'react';
import {
  fetchSettingsBackup,
  fetchSettingsBackups,
  type SettingsBackupEntry,
  type SettingsScopeInfo,
  type WritableSettingsScope,
} from '../api/client.js';
import type { DiffFlowApi } from './useDiffFlow.js';

export interface BackupsSectionProps {
  /** Scope files for the currently selected project -- the restore-target resolver. */
  scopes: SettingsScopeInfo[];
  project?: string;
  flow: DiffFlowApi;
  onApplied: () => void;
}

interface ViewState {
  id: string;
  content: string;
  /** Set when the backup's origin cannot be mapped to a writable scope right now. */
  note?: string;
}

/** Normalized-path equality (Windows paths are case-insensitive and separator-agnostic). */
function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();
  return norm(a) === norm(b);
}

/**
 * Timestamped pre-write backups (`~/.suite/settings-backups/`). Restore maps a backup's origin
 * path back onto a writable scope for the selected project and runs the backup's bytes through
 * the SAME preview/apply rail as any edit -- when the origin isn't resolvable (other project,
 * managed scope), the content is shown read-only instead of guessing a write target.
 */
export function BackupsSection({ scopes, project, flow, onApplied }: BackupsSectionProps): ReactElement {
  const [backups, setBackups] = useState<SettingsBackupEntry[] | null>(null);
  const [viewing, setViewing] = useState<ViewState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSettingsBackups()
      .then((next) => setBackups(next))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const resolveScope = (entry: SettingsBackupEntry): SettingsScopeInfo | undefined =>
    scopes.find((scope) => scope.writable && samePath(scope.path, entry.targetPath));

  const view = (entry: SettingsBackupEntry): void => {
    setError(null);
    fetchSettingsBackup(entry.id)
      .then(({ content }) => setViewing({ id: entry.id, content }))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  const restore = (entry: SettingsBackupEntry): void => {
    setError(null);
    const target = resolveScope(entry);
    fetchSettingsBackup(entry.id)
      .then(({ content }) => {
        if (!target) {
          setViewing({
            id: entry.id,
            content,
            note:
              `Cannot map ${entry.targetPath} onto a writable scope for the current project selection -- ` +
              'showing the backup read-only. Select the matching project (or copy the content into the editor).',
          });
          return;
        }
        flow.openEdit({
          title: `Restore backup into ${target.scope} settings`,
          scope: target.scope as WritableSettingsScope,
          project: target.scope === 'user' ? undefined : project,
          newContent: content,
          onApplied,
        });
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <section className="settings-panel" aria-label="Settings backups">
      <h2 className="settings-panel__title">Backups</h2>
      <p className="settings-panel__hint">
        Every apply backs up the previous file first. Restores flow through the same diff preview as any edit.
      </p>
      {error && (
        <p className="app-shell__error" role="alert">
          {error}
        </p>
      )}
      {backups === null ? (
        <p className="settings-rules__empty">Loading…</p>
      ) : backups.length === 0 ? (
        <p className="settings-rules__empty">No backups yet -- none of the rails have had to write anything.</p>
      ) : (
        <ul className="settings-rules__list">
          {backups.map((entry) => (
            <li key={entry.id} className="settings-backup__item">
              <div className="settings-backup__body">
                <span className="settings-backup__target" title={entry.path}>
                  {entry.targetPath}
                </span>
                <span className="settings-backup__meta">
                  {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : entry.id} · {entry.bytes} bytes
                </span>
              </div>
              <div className="settings-backup__actions">
                <button type="button" className="ship-inbox__btn" onClick={() => view(entry)}>
                  view
                </button>
                <button
                  type="button"
                  className="ship-inbox__btn"
                  onClick={() => restore(entry)}
                  aria-label={`Restore backup of ${entry.targetPath}`}
                >
                  restore…
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {viewing && (
        <div className="settings-backup__view">
          {viewing.note && <p className="settings-excluded">{viewing.note}</p>}
          <pre className="settings-diff" aria-label="Backup content">
            {viewing.content}
          </pre>
          <button type="button" className="ship-inbox__btn" onClick={() => setViewing(null)}>
            close
          </button>
        </div>
      )}
    </section>
  );
}
