import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  fetchAlwaysAllowed,
  previewRevokeRule,
  type AlwaysAllowedEntry,
  type AlwaysAllowedResponse,
} from '../api/client.js';
import type { DiffFlowApi } from './useDiffFlow.js';

export interface AlwaysAllowedProps {
  flow: DiffFlowApi;
  onApplied: () => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'an unknown date';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/**
 * Ship integration (Trio_Specs §B): "always allow" rules written by the Inbox station appear
 * here labeled with origin + date, revocable in one click -- the revoke is an exact one-rule
 * removal from that project's settings.local.json, previewed through the shared diff modal.
 */
export function AlwaysAllowed({ flow, onApplied }: AlwaysAllowedProps): ReactElement {
  const [data, setData] = useState<AlwaysAllowedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchAlwaysAllowed()
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const revoke = (entry: AlwaysAllowedEntry): void => {
    setError(null);
    previewRevokeRule({ project: entry.cwd, rule: entry.rule })
      .then((response) =>
        flow.openWithPreview(
          {
            title: `Revoke '${entry.rule}'`,
            scope: 'local',
            project: entry.cwd,
            newContent: response.newContent,
            onApplied: () => {
              refresh();
              onApplied();
            },
          },
          response.preview,
        ),
      )
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <section className="settings-panel" aria-label="Always-allowed rules">
      <h2 className="settings-panel__title">Always-allowed (from the Inbox)</h2>
      {error && (
        <p className="app-shell__error" role="alert">
          {error}
        </p>
      )}
      {data === null ? (
        <p className="settings-rules__empty">Loading…</p>
      ) : !data.available ? (
        <p className="settings-rules__empty">Inbox station not mounted -- no always-allow ledger to show.</p>
      ) : data.entries.length === 0 ? (
        <p className="settings-rules__empty">No always-allow rules have been written by the Inbox yet.</p>
      ) : (
        <ul className="settings-rules__list">
          {data.entries.map((entry, index) => (
            <li key={`${entry.rule}-${entry.cwd}-${index}`} className="settings-always__item">
              <div className="settings-always__body">
                <code>{entry.rule}</code>
                <span className="settings-always__meta">
                  {entry.project ?? entry.cwd} · written by ship-inbox on {formatDate(entry.decidedAt)}
                </span>
              </div>
              <button
                type="button"
                className="ship-inbox__btn ship-inbox__btn--deny"
                onClick={() => revoke(entry)}
                aria-label={`Revoke rule ${entry.rule}`}
              >
                revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
