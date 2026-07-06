import { useEffect, useState, type ReactElement } from 'react';
import {
  fetchSettingsTemplates,
  previewSettingsTemplate,
  type SettingsTemplatePack,
  type WritableSettingsScope,
} from '../api/client.js';
import type { DiffFlowApi } from './useDiffFlow.js';

export interface TemplatePacksProps {
  project?: string;
  flow: DiffFlowApi;
  onApplied: () => void;
}

const SCOPE_CHOICES: readonly WritableSettingsScope[] = ['user', 'project', 'local'];

/**
 * Template packs (Trio_Specs §B): curated permission groups, applied additively to any writable
 * scope -- the server composes the merge and the result flows through the same diff modal as
 * every other write.
 */
export function TemplatePacks({ project, flow, onApplied }: TemplatePacksProps): ReactElement {
  const [packs, setPacks] = useState<SettingsTemplatePack[] | null>(null);
  const [scopeByPack, setScopeByPack] = useState<Record<string, WritableSettingsScope>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSettingsTemplates()
      .then((next) => setPacks(next))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const applyPack = (pack: SettingsTemplatePack): void => {
    const scope = scopeByPack[pack.id] ?? 'user';
    const projectArg = scope === 'user' ? undefined : project;
    setError(null);
    previewSettingsTemplate({ id: pack.id, scope, project: projectArg })
      .then((response) =>
        flow.openWithPreview(
          {
            title: `Apply pack '${pack.name}' to ${scope}`,
            scope,
            project: projectArg,
            newContent: response.newContent,
            onApplied,
          },
          response.preview,
        ),
      )
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <section className="settings-panel" aria-label="Template packs">
      <h2 className="settings-panel__title">Template packs</h2>
      {error && (
        <p className="app-shell__error" role="alert">
          {error}
        </p>
      )}
      {packs === null ? (
        <p className="settings-rules__empty">Loading…</p>
      ) : packs.length === 0 ? (
        <p className="settings-rules__empty">No template packs installed.</p>
      ) : (
        <div className="settings-cards">
          {packs.map((pack) => {
            const scope = scopeByPack[pack.id] ?? 'user';
            const scopeNeedsProject = scope !== 'user' && project === undefined;
            return (
              <article key={pack.id} className="settings-card">
                <h3 className="settings-card__name">
                  {pack.name} <span className="settings-card__version">v{pack.version}</span>
                </h3>
                <p className="settings-card__desc">{pack.description}</p>
                <p className="settings-card__counts">
                  allow {pack.permissions.allow.length} · deny {pack.permissions.deny.length} · ask{' '}
                  {pack.permissions.ask.length}
                </p>
                <div className="settings-card__actions">
                  <select
                    className="settings-select"
                    aria-label={`Target scope for ${pack.name}`}
                    value={scope}
                    onChange={(event) =>
                      setScopeByPack((prev) => ({ ...prev, [pack.id]: event.target.value as WritableSettingsScope }))
                    }
                  >
                    {SCOPE_CHOICES.map((name) => (
                      <option key={name} value={name} disabled={name !== 'user' && project === undefined}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-brass"
                    disabled={scopeNeedsProject}
                    onClick={() => applyPack(pack)}
                  >
                    Apply to {scope}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
