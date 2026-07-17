import type { ReactElement } from 'react';
import type {
  AttributedSettingsRule,
  SettingsEffectiveResponse,
  SettingsScopeInfo,
} from '../api/client.js';
import { PermissionChips } from './PermissionChips.js';
import { ScopeBadge, SourceFile } from './ScopeBadge.js';
import type { DiffFlowApi } from './useDiffFlow.js';

export interface EffectiveViewProps {
  effective: SettingsEffectiveResponse;
  scopes: SettingsScopeInfo[];
  /** Selected project directory -- chip moves into project/local scopes target it. */
  project?: string;
  flow: DiffFlowApi;
  onApplied: () => void;
}

function RuleGroup({ title, rules }: { title: 'additionalDirectories'; rules: AttributedSettingsRule[] }): ReactElement {
  return (
    <div className={`settings-rules settings-rules--${title}`}>
      <h3 className="settings-rules__title">
        {title} <span className="settings-rules__count">({rules.length})</span>
      </h3>
      {rules.length === 0 ? (
        <p className="settings-rules__empty">none</p>
      ) : (
        <ul className="settings-rules__list">
          {rules.map((rule, index) => (
            <li key={`${rule.rule}-${rule.file}-${index}`} className="settings-rules__item">
              <code>{rule.rule}</code> <ScopeBadge scope={rule.scope} /> <SourceFile file={rule.file} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The merged effective view (Trio_Specs §B): permission rules as movable chips in evaluation
 * order (deny → ask → allow; arrays MERGE across scopes), the winning defaultMode with its
 * shadowed values, every other top-level key with provenance, and per-scope file status --
 * malformed scopes are excluded from the merge and loudly flagged.
 */
export function EffectiveView({ effective, scopes, project, flow, onApplied }: EffectiveViewProps): ReactElement {
  const valueEntries = Object.entries(effective.values).sort(([a], [b]) => a.localeCompare(b));
  const mode = effective.permissions.defaultMode;

  return (
    <section className="settings-panel" aria-label="Effective settings">
      <h2 className="settings-panel__title">Effective view</h2>

      {effective.excluded.length > 0 && (
        <div className="settings-excluded" role="alert">
          {effective.excluded.map((excluded) => (
            <p key={excluded.file}>
              <ScopeBadge scope={excluded.scope} /> scope EXCLUDED from the merge --{' '}
              <SourceFile file={excluded.file} />: {excluded.error}
            </p>
          ))}
        </div>
      )}

      <PermissionChips effective={effective} project={project} flow={flow} onApplied={onApplied} />
      {effective.permissions.additionalDirectories.length > 0 && (
        <RuleGroup title="additionalDirectories" rules={effective.permissions.additionalDirectories} />
      )}

      <div className="settings-mode">
        <h3 className="settings-rules__title">defaultMode</h3>
        {mode ? (
          <p>
            <code>{String(mode.value)}</code> <ScopeBadge scope={mode.scope} /> <SourceFile file={mode.file} />
            {mode.overridden.length > 0 && (
              <span className="settings-shadowed">
                {' '}
                shadows:{' '}
                {mode.overridden.map((shadow, index) => (
                  <span key={`${shadow.file}-${index}`}>
                    {index > 0 && ', '}
                    <code>{String(shadow.value)}</code> (<ScopeBadge scope={shadow.scope} />)
                  </span>
                ))}
              </span>
            )}
          </p>
        ) : (
          <p className="settings-rules__empty">not set in any scope (sessions start in default mode)</p>
        )}
      </div>

      <h3 className="settings-rules__title">Other settings</h3>
      {valueEntries.length === 0 ? (
        <p className="settings-rules__empty">no non-permission keys set</p>
      ) : (
        <div className="settings-table__wrap">
          <table className="settings-table">
            <thead>
              <tr>
                <th>key</th>
                <th>winning value</th>
                <th>scope</th>
                <th>shadowed</th>
              </tr>
            </thead>
            <tbody>
              {valueEntries.map(([key, value]) => (
                <tr key={key}>
                  <td>
                    <code>{key}</code>
                  </td>
                  <td className="settings-table__value">
                    <code>{JSON.stringify(value.value)}</code>
                  </td>
                  <td>
                    <ScopeBadge scope={value.scope} /> <SourceFile file={value.file} />
                  </td>
                  <td>{value.overridden.length > 0 ? `${value.overridden.length} scope(s)` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="settings-rules__title">Scope files</h3>
      <ul className="settings-scopes">
        {scopes.map((scope) => (
          <li key={`${scope.scope}-${scope.path}`} className="settings-scopes__item">
            <ScopeBadge scope={scope.scope} />
            <span className="settings-scopes__path" title={scope.path}>
              {scope.path}
            </span>
            <span className={scope.exists ? 'settings-chip settings-chip--ok' : 'settings-chip'}>
              {scope.exists ? 'exists' : 'absent'}
            </span>
            <span className={scope.writable ? 'settings-chip settings-chip--ok' : 'settings-chip'}>
              {scope.writable ? 'writable' : 'read-only'}
            </span>
            {scope.error && <span className="settings-chip settings-chip--err">{scope.error}</span>}
            {scope.validation && !scope.validation.ok && (
              <span className="settings-chip settings-chip--err">
                {scope.validation.errors.length} schema error(s)
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
