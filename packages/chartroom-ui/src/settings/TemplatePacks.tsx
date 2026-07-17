import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  createSettingsTemplate,
  fetchSettingsTemplates,
  previewSettingsTemplate,
  type SettingsEffectiveResponse,
  type SettingsTemplatePack,
  type SettingsTemplatesResponse,
  type WritableSettingsScope,
} from '../api/client.js';
import type { DiffFlowApi } from './useDiffFlow.js';

export interface TemplatePacksProps {
  project?: string;
  /** Effective permissions -- the "start from current permissions" prefill for new packs. */
  effective: SettingsEffectiveResponse | null;
  flow: DiffFlowApi;
  onApplied: () => void;
}

const SCOPE_CHOICES: readonly WritableSettingsScope[] = ['user', 'project', 'local'];

interface PackForm {
  id: string;
  name: string;
  version: string;
  description: string;
  allow: string;
  deny: string;
  ask: string;
}

const EMPTY_FORM: PackForm = { id: '', name: '', version: '1.0.0', description: '', allow: '', deny: '', ask: '' };

function parseRules(text: string): string[] {
  return [...new Set(text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0))];
}

/**
 * Template packs (Trio_Specs §B): curated built-in permission groups PLUS user-defined packs
 * from `~/.suite/settings-templates/`, applied additively to any writable scope -- the server
 * composes the merge and the result flows through the same diff modal as every other write.
 * New packs can be created from scratch or prefilled from the current effective permissions.
 */
export function TemplatePacks({ project, effective, flow, onApplied }: TemplatePacksProps): ReactElement {
  const [catalog, setCatalog] = useState<SettingsTemplatesResponse | null>(null);
  const [scopeByPack, setScopeByPack] = useState<Record<string, WritableSettingsScope>>({});
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<PackForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(() => {
    fetchSettingsTemplates()
      .then((next) => setCatalog(next))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const applyPack = (pack: SettingsTemplatePack): void => {
    const scope = scopeByPack[pack.id] ?? 'user';
    const projectArg = scope === 'user' ? undefined : project;
    setError(null);
    const compose = () => previewSettingsTemplate({ id: pack.id, scope, project: projectArg });
    compose()
      .then((response) =>
        flow.openWithPreview(
          {
            title: `Apply pack '${pack.name}' to ${scope}`,
            scope,
            project: projectArg,
            newContent: response.newContent,
            // D5: base-drift recovery recomposes the additive merge against the fresh bytes.
            recompose: () => compose().then((next) => ({ newContent: next.newContent, preview: next.preview })),
            onApplied,
          },
          response.preview,
        ),
      )
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  const prefillFromEffective = (): void => {
    if (!effective) return;
    setForm((current) => ({
      ...(current ?? EMPTY_FORM),
      allow: [...new Set(effective.permissions.allow.map((rule) => rule.rule))].join('\n'),
      deny: [...new Set(effective.permissions.deny.map((rule) => rule.rule))].join('\n'),
      ask: [...new Set(effective.permissions.ask.map((rule) => rule.rule))].join('\n'),
    }));
  };

  const submitForm = (current: PackForm): void => {
    setFormError(null);
    setCreating(true);
    createSettingsTemplate({
      id: current.id.trim(),
      name: current.name.trim(),
      version: current.version.trim() || undefined,
      description: current.description.trim(),
      permissions: { allow: parseRules(current.allow), deny: parseRules(current.deny), ask: parseRules(current.ask) },
    })
      .then(() => {
        setCreating(false);
        setForm(null);
        refresh();
      })
      .catch((err: unknown) => {
        setCreating(false);
        setFormError(err instanceof Error ? err.message : String(err));
      });
  };

  return (
    <section className="settings-panel" aria-label="Template packs">
      <div className="settings-editor__bar">
        <h2 className="settings-panel__title">Template packs</h2>
        <button type="button" className="ship-inbox__btn" onClick={() => setForm(form ? null : { ...EMPTY_FORM })}>
          {form ? 'Cancel new pack' : 'New pack…'}
        </button>
      </div>
      {error && (
        <p className="app-shell__error" role="alert">
          {error}
        </p>
      )}
      {catalog !== null && catalog.warnings.length > 0 && (
        <div className="settings-excluded" role="alert">
          {catalog.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}

      {form && (
        <form
          className="settings-card settings-pack-form"
          aria-label="New template pack"
          onSubmit={(event) => {
            event.preventDefault();
            submitForm(form);
          }}
        >
          <div className="settings-editor__bar">
            <label className="settings-field">
              id
              <input
                className="settings-select"
                aria-label="Pack id"
                value={form.id}
                placeholder="my-team-pack"
                onChange={(event) => setForm({ ...form, id: event.target.value })}
              />
            </label>
            <label className="settings-field">
              name
              <input
                className="settings-select"
                aria-label="Pack name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <label className="settings-field">
              version
              <input
                className="settings-select"
                aria-label="Pack version"
                value={form.version}
                onChange={(event) => setForm({ ...form, version: event.target.value })}
              />
            </label>
          </div>
          <label className="settings-field">
            description
            <input
              className="settings-select"
              aria-label="Pack description"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </label>
          {(['allow', 'deny', 'ask'] as const).map((list) => (
            <label key={list} className="settings-field">
              {list} (one rule per line)
              <textarea
                className="settings-editor__textarea"
                aria-label={`Pack ${list} rules`}
                rows={3}
                value={form[list]}
                onChange={(event) => setForm({ ...form, [list]: event.target.value })}
              />
            </label>
          ))}
          {formError && (
            <p className="app-shell__error" role="alert">
              {formError}
            </p>
          )}
          <div className="settings-editor__actions">
            <button
              type="button"
              className="ship-inbox__btn"
              disabled={effective === null}
              onClick={prefillFromEffective}
            >
              Prefill from current effective permissions
            </button>
            <button type="submit" className="btn-brass" disabled={creating || !form.id.trim() || !form.name.trim()}>
              {creating ? 'Creating…' : 'Create pack'}
            </button>
          </div>
        </form>
      )}

      {catalog === null ? (
        <p className="settings-rules__empty">Loading…</p>
      ) : catalog.packs.length === 0 ? (
        <p className="settings-rules__empty">No template packs installed.</p>
      ) : (
        <div className="settings-cards">
          {catalog.packs.map((pack) => {
            const scope = scopeByPack[pack.id] ?? 'user';
            const scopeNeedsProject = scope !== 'user' && project === undefined;
            return (
              <article key={pack.id} className="settings-card">
                <h3 className="settings-card__name">
                  {pack.name} <span className="settings-card__version">v{pack.version}</span>{' '}
                  <span className="settings-chip">{pack.source === 'user' ? 'user' : 'built-in'}</span>
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
