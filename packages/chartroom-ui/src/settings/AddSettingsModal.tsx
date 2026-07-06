import { useEffect, useMemo, useState, type KeyboardEvent, type ReactElement } from 'react';
import {
  fetchSettingsCatalog,
  previewSettingsAdd,
  type SettingsAdditions,
  type SettingsCatalogEntry,
  type SettingsCatalogResponse,
  type SettingsRuleTemplate,
  type WritableSettingsScope,
} from '../api/client.js';
import type { DiffFlowApi } from './useDiffFlow.js';

export interface AddSettingsModalProps {
  /** Selected project directory (absPath) -- project/local scopes need one. */
  project?: string;
  flow: DiffFlowApi;
  /** Called after a successful apply so the page can refresh the effective view + scopes. */
  onApplied: () => void;
  onClose: () => void;
}

type RuleList = 'allow' | 'deny' | 'ask';

interface RuleSelection {
  rule: string;
  list: RuleList;
}

type FlatItem = { type: 'setting'; entry: SettingsCatalogEntry } | { type: 'rule'; template: SettingsRuleTemplate };

const WRITABLE_SCOPES: readonly WritableSettingsScope[] = ['user', 'project', 'local'];
const RULE_LISTS: readonly RuleList[] = ['allow', 'deny', 'ask'];

/** Prefill for the per-kind value input (plan 14): the catalog's defaultValue, rendered in the
 * shape the input edits -- lines for string-array, pretty JSON for the JSON-textarea kinds. */
function initialValue(entry: SettingsCatalogEntry): string | boolean {
  switch (entry.kind) {
    case 'boolean':
      return Boolean(entry.defaultValue);
    case 'string':
    case 'number':
      return entry.defaultValue === undefined || entry.defaultValue === null ? '' : String(entry.defaultValue);
    case 'string-array':
      return Array.isArray(entry.defaultValue) ? entry.defaultValue.map(String).join('\n') : '';
    default:
      // object / array / string-or-boolean / any: JSON textarea
      return JSON.stringify(entry.defaultValue, null, 2) ?? '';
  }
}

/** Raw input → the value sent in `additions` (or a blocking client-side message). */
function convertValue(entry: SettingsCatalogEntry, raw: string | boolean): { value?: unknown; error?: string } {
  if (entry.kind === 'boolean') return { value: raw === true };
  const text = typeof raw === 'string' ? raw : String(raw);
  switch (entry.kind) {
    case 'string':
      return { value: text };
    case 'number': {
      const parsed = Number(text.trim());
      if (text.trim() === '' || Number.isNaN(parsed)) return { error: 'must be a number' };
      return { value: parsed };
    }
    case 'string-array':
      return {
        value: text
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== ''),
      };
    default: {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        return { error: 'must be valid JSON' };
      }
      if (entry.kind === 'object' && (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))) {
        return { error: 'must be a JSON object' };
      }
      return { value: parsed };
    }
  }
}

/**
 * The interactive ADD flow (plan 14): search + multiselect over the catalog, per-kind value
 * inputs, a scope picker, and ONE batched write per target through the existing rails --
 * `/add/preview` composes the content, the shared DiffModal (flow.openWithPreview) is the only
 * apply path, so validation blocking, baseHash tickets and backups all come for free.
 */
export function AddSettingsModal({ project, flow, onApplied, onClose }: AddSettingsModalProps): ReactElement {
  const [catalog, setCatalog] = useState<SettingsCatalogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [scope, setScope] = useState<WritableSettingsScope>('user');
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [ruleSelections, setRuleSelections] = useState<Record<string, RuleSelection>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSettingsCatalog()
      .then((next) => {
        if (!cancelled) setCatalog(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const query = search.trim().toLowerCase();
  const filteredSettings = useMemo(
    () =>
      (catalog?.settings ?? []).filter(
        (entry) =>
          query === '' || entry.key.toLowerCase().includes(query) || entry.description.toLowerCase().includes(query),
      ),
    [catalog, query],
  );
  const filteredTemplates = useMemo(
    () => (catalog?.ruleTemplates ?? []).filter((template) => query === '' || template.label.toLowerCase().includes(query)),
    [catalog, query],
  );
  const flat: FlatItem[] = useMemo(
    () => [
      ...filteredSettings.map((entry): FlatItem => ({ type: 'setting', entry })),
      ...filteredTemplates.map((template): FlatItem => ({ type: 'rule', template })),
    ],
    [filteredSettings, filteredTemplates],
  );
  const active = flat.length === 0 ? -1 : Math.min(highlight, flat.length - 1);

  const toggleSetting = (entry: SettingsCatalogEntry): void => {
    setValues((prev) => {
      if (entry.key in prev) {
        const next = { ...prev };
        delete next[entry.key];
        return next;
      }
      return { ...prev, [entry.key]: initialValue(entry) };
    });
  };

  const toggleRule = (template: SettingsRuleTemplate): void => {
    setRuleSelections((prev) => {
      if (template.id in prev) {
        const next = { ...prev };
        delete next[template.id];
        return next;
      }
      return { ...prev, [template.id]: { rule: template.rule, list: template.defaultList } };
    });
  };

  const toggleItem = (item: FlatItem): void => {
    if (item.type === 'setting') toggleSetting(item.entry);
    else toggleRule(item.template);
  };

  // ArrowUp/Down move the highlight, Enter toggles the highlighted item, Esc closes -- bound to
  // the search box so Enter inside the value textareas keeps inserting newlines.
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((prev) => Math.min(prev + 1, Math.max(flat.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (active >= 0) toggleItem(flat[active]);
    }
  };

  const onModalKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  // Build the batched additions payload + collect the client-side field issues that block the
  // preview button. `permissions.defaultMode` routes to `additions.defaultMode`, never `values`.
  const { additions, issues } = useMemo(() => {
    const additionValues: Record<string, unknown> = {};
    let defaultMode: string | undefined;
    const permissions: { allow: string[]; deny: string[]; ask: string[] } = { allow: [], deny: [], ask: [] };
    const fieldIssues: { id: string; message: string }[] = [];

    for (const [key, raw] of Object.entries(values)) {
      const entry = catalog?.settings.find((candidate) => candidate.key === key);
      if (!entry) continue;
      const converted = convertValue(entry, raw);
      if (converted.error !== undefined) {
        fieldIssues.push({ id: key, message: converted.error });
      } else if (key === 'permissions.defaultMode') {
        defaultMode = String(converted.value);
      } else {
        additionValues[key] = converted.value;
      }
    }
    for (const [id, selection] of Object.entries(ruleSelections)) {
      if (selection.rule.trim() === '') fieldIssues.push({ id, message: 'rule text is required' });
      else permissions[selection.list].push(selection.rule.trim());
    }

    const built: SettingsAdditions = {};
    if (Object.keys(additionValues).length > 0) built.values = additionValues;
    if (defaultMode !== undefined) built.defaultMode = defaultMode;
    if (permissions.allow.length || permissions.deny.length || permissions.ask.length) {
      built.permissions = {
        ...(permissions.allow.length ? { allow: permissions.allow } : {}),
        ...(permissions.deny.length ? { deny: permissions.deny } : {}),
        ...(permissions.ask.length ? { ask: permissions.ask } : {}),
      };
    }
    return { additions: built, issues: fieldIssues };
  }, [values, ruleSelections, catalog]);

  const selectionCount = Object.keys(values).length + Object.keys(ruleSelections).length;
  const scopeNeedsProject = scope !== 'user' && project === undefined;
  const projectArg = scope === 'user' ? undefined : project;
  const submitDisabled = busy || selectionCount === 0 || scopeNeedsProject || issues.length > 0;

  const submit = (): void => {
    setBusy(true);
    setError(null);
    previewSettingsAdd({ scope, project: projectArg, additions })
      .then((response) => {
        setBusy(false);
        const parts = [`${response.addedKeys.length} added`];
        if (response.overwrittenKeys.length > 0) parts.push(`${response.overwrittenKeys.length} overwritten`);
        if (response.addedRules > 0) parts.push(`${response.addedRules} rule(s) appended`);
        flow.openWithPreview(
          {
            title: `Add to ${scope} settings (${parts.join(', ')})`,
            scope,
            project: projectArg,
            newContent: response.newContent,
            onApplied: () => {
              onClose();
              onApplied();
            },
          },
          response.preview,
        );
      })
      .catch((err: unknown) => {
        setBusy(false);
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  const issueFor = (id: string): string | undefined => issues.find((issue) => issue.id === id)?.message;

  const renderValueInput = (entry: SettingsCatalogEntry): ReactElement => {
    const raw = values[entry.key];
    const label = `Value for ${entry.key}`;
    if (entry.kind === 'boolean') {
      return (
        <label className="add-settings__bool">
          <input
            type="checkbox"
            aria-label={label}
            checked={raw === true}
            onChange={(event) => setValues((prev) => ({ ...prev, [entry.key]: event.target.checked }))}
          />
          <span>{raw === true ? 'true' : 'false'}</span>
        </label>
      );
    }
    const text = typeof raw === 'string' ? raw : String(raw);
    const setText = (next: string): void => setValues((prev) => ({ ...prev, [entry.key]: next }));
    if (entry.enumValues && entry.enumValues.length > 0) {
      return (
        <select className="settings-select" aria-label={label} value={text} onChange={(event) => setText(event.target.value)}>
          {entry.enumValues.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }
    if (entry.kind === 'number') {
      return (
        <input
          type="number"
          className="settings-input"
          aria-label={label}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      );
    }
    if (entry.kind === 'string') {
      return (
        <input
          type="text"
          className="settings-input"
          aria-label={label}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      );
    }
    // string-array (one item per line) and the JSON kinds share a textarea.
    return (
      <textarea
        className="settings-input add-settings__textarea"
        aria-label={label}
        spellCheck={false}
        rows={entry.kind === 'string-array' ? 3 : 4}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    );
  };

  return (
    <div className="settings-modal__overlay" role="presentation">
      <div
        className="settings-modal add-settings"
        role="dialog"
        aria-modal="true"
        aria-label="Add settings"
        onKeyDown={onModalKeyDown}
      >
        <div className="settings-modal__head">
          <h3 className="settings-modal__title">Add settings</h3>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close add settings">
            ✕
          </button>
        </div>

        {error && (
          <p className="app-shell__error" role="alert">
            {error}
          </p>
        )}

        <input
          type="text"
          className="settings-input add-settings__search"
          aria-label="Search settings catalog"
          placeholder="search settings and rule templates…"
          autoFocus
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={onSearchKeyDown}
        />

        {catalog === null ? (
          <p className="settings-rules__empty">Loading catalog…</p>
        ) : (
          <div className="add-settings__list">
            <p className="settings-rules__title">
              Settings <span className="settings-rules__count">({filteredSettings.length})</span>
            </p>
            {filteredSettings.length === 0 && <p className="settings-rules__empty">No settings match.</p>}
            <ul className="add-settings__group">
              {filteredSettings.map((entry, index) => (
                <li
                  key={entry.key}
                  className={`add-settings__row${index === active ? ' add-settings__row--active' : ''}`}
                >
                  <label className="add-settings__row-label">
                    <input
                      type="checkbox"
                      aria-label={`Select ${entry.key}`}
                      checked={entry.key in values}
                      onChange={() => toggleSetting(entry)}
                    />
                    <code className="add-settings__key">{entry.key}</code>
                    <span className="settings-chip">{entry.kind}</span>
                    {entry.managedOnly && (
                      <span className="settings-chip settings-chip--err" title="No effect outside managed scope">
                        managed-only
                      </span>
                    )}
                    <span className="add-settings__desc">{entry.description}</span>
                  </label>
                </li>
              ))}
            </ul>

            <p className="settings-rules__title">
              Permission rules <span className="settings-rules__count">({filteredTemplates.length})</span>
            </p>
            {filteredTemplates.length === 0 && <p className="settings-rules__empty">No rule templates match.</p>}
            <ul className="add-settings__group">
              {filteredTemplates.map((template, index) => {
                const flatIndex = filteredSettings.length + index;
                return (
                  <li
                    key={template.id}
                    className={`add-settings__row${flatIndex === active ? ' add-settings__row--active' : ''}`}
                  >
                    <label className="add-settings__row-label">
                      <input
                        type="checkbox"
                        aria-label={`Select rule ${template.label}`}
                        checked={template.id in ruleSelections}
                        onChange={() => toggleRule(template)}
                      />
                      <span className="add-settings__key">{template.label}</span>
                      <span className="settings-chip">{template.defaultList}</span>
                      <span className="add-settings__desc">{template.description}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {catalog !== null && selectionCount > 0 && (
          <div className="add-settings__selected" aria-label="Selected additions">
            <p className="settings-rules__title">
              Selected <span className="settings-rules__count">({selectionCount})</span>
            </p>
            {catalog.settings
              .filter((entry) => entry.key in values)
              .map((entry) => (
                <div key={entry.key} className="add-settings__item">
                  <code className="add-settings__key">{entry.key}</code>
                  {renderValueInput(entry)}
                  {entry.kind === 'string-array' && <span className="add-settings__hint">one item per line</span>}
                  {issueFor(entry.key) && (
                    <span className="add-settings__issue" role="alert">
                      {issueFor(entry.key)}
                    </span>
                  )}
                </div>
              ))}
            {catalog.ruleTemplates
              .filter((template) => template.id in ruleSelections)
              .map((template) => {
                const selection = ruleSelections[template.id];
                return (
                  <div key={template.id} className="add-settings__item">
                    <span className="add-settings__key">{template.label}</span>
                    <input
                      type="text"
                      className="settings-input add-settings__rule"
                      aria-label={`Rule for ${template.label}`}
                      value={selection.rule}
                      onChange={(event) =>
                        setRuleSelections((prev) => ({
                          ...prev,
                          [template.id]: { ...prev[template.id], rule: event.target.value },
                        }))
                      }
                    />
                    <select
                      className="settings-select"
                      aria-label={`List for ${template.label}`}
                      value={selection.list}
                      onChange={(event) =>
                        setRuleSelections((prev) => ({
                          ...prev,
                          [template.id]: { ...prev[template.id], list: event.target.value as RuleList },
                        }))
                      }
                    >
                      {RULE_LISTS.map((list) => (
                        <option key={list} value={list}>
                          {list}
                        </option>
                      ))}
                    </select>
                    {issueFor(template.id) && (
                      <span className="add-settings__issue" role="alert">
                        {issueFor(template.id)}
                      </span>
                    )}
                  </div>
                );
              })}
          </div>
        )}

        <div className="settings-modal__footer add-settings__footer">
          <label className="settings-field settings-field--inline">
            scope
            <select
              className="settings-select"
              aria-label="Add target scope"
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
          {scopeNeedsProject && <span className="add-settings__hint">select a project to target {scope} settings</span>}
          <button type="button" className="ship-inbox__btn" onClick={onClose} disabled={busy}>
            cancel
          </button>
          <button type="button" className="btn-brass" onClick={submit} disabled={submitDisabled}>
            {busy ? 'Previewing…' : 'Preview & apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
