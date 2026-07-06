import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  fetchSettingsEffective,
  fetchSettingsScopes,
  type SettingsEffectiveResponse,
  type SettingsScopesResponse,
} from '../api/client.js';
import { AddSettingsModal } from './AddSettingsModal.js';
import { AlwaysAllowed } from './AlwaysAllowed.js';
import { BackupsSection } from './BackupsSection.js';
import { EffectiveView } from './EffectiveView.js';
import { ScopeEditor } from './ScopeEditor.js';
import { Simulator } from './Simulator.js';
import { TemplatePacks } from './TemplatePacks.js';
import { useDiffFlow } from './useDiffFlow.js';

const PROJECT_STORAGE_KEY = 'chartroom.settings.project';

function loadStoredProject(): string | null {
  try {
    return window.localStorage.getItem(PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The Settings tab (Trio_Specs §B; plan 07 §3): simulator on top (the centerpiece), then the
 * merged effective view, the railed editor, template packs, inbox-written always-allow rules,
 * and backups. One shared diff-modal rail (useDiffFlow) gates every write on the page.
 */
export function SettingsPage(): ReactElement {
  // undefined = not yet determined; '' = deliberately no project (user scope only).
  const [project, setProject] = useState<string | undefined>(undefined);
  const [scopesResponse, setScopesResponse] = useState<SettingsScopesResponse | null>(null);
  const [effective, setEffective] = useState<SettingsEffectiveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const flow = useDiffFlow();

  // Bootstrap: an unscoped /scopes call yields the registered-project list; then restore the
  // persisted selection when it is still registered, else default to the first project.
  useEffect(() => {
    let cancelled = false;
    fetchSettingsScopes()
      .then((response) => {
        if (cancelled) return;
        const stored = loadStoredProject();
        const chosen =
          stored === ''
            ? ''
            : (response.projects.find((candidate) => candidate.absPath === stored)?.absPath ??
              response.projects[0]?.absPath ??
              '');
        setProject(chosen);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const projectArg = project === '' || project === undefined ? undefined : project;

  useEffect(() => {
    if (project === undefined) return;
    try {
      window.localStorage.setItem(PROJECT_STORAGE_KEY, project);
    } catch {
      /* unavailable storage is never fatal */
    }
    let cancelled = false;
    Promise.all([fetchSettingsScopes(projectArg), fetchSettingsEffective(projectArg)])
      .then(([scopes, merged]) => {
        if (cancelled) return;
        setScopesResponse(scopes);
        setEffective(merged);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [project, projectArg, refreshTick]);

  const refresh = useCallback(() => setRefreshTick((tick) => tick + 1), []);

  if (error && scopesResponse === null) {
    return (
      <div className="settings">
        <p className="app-shell__error" role="alert">
          Settings station unavailable: {error}
        </p>
      </div>
    );
  }
  if (scopesResponse === null || effective === null) {
    return (
      <div className="settings">
        <p className="settings-rules__empty">Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="settings">
      <div className="settings__head">
        <h1 className="settings__title">Settings</h1>
        <label className="settings-field settings-field--inline">
          project
          <select
            className="settings-select"
            aria-label="Project"
            value={project ?? ''}
            onChange={(event) => setProject(event.target.value)}
          >
            <option value="">(user scope only)</option>
            {scopesResponse.projects.map((candidate) => (
              <option key={candidate.id} value={candidate.absPath}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <span className="settings__schema" title="Schema the editor validates against">
          {scopesResponse.schemaSource}
        </span>
        <button type="button" className="btn-brass" onClick={() => setAddOpen(true)}>
          Add settings
        </button>
      </div>

      {error && (
        <p className="app-shell__error" role="alert">
          {error}
        </p>
      )}
      {flow.openError && (
        <p className="app-shell__error" role="alert">
          {flow.openError}
        </p>
      )}

      <Simulator project={projectArg} />
      <EffectiveView effective={effective} scopes={scopesResponse.scopes} />
      <ScopeEditor project={projectArg} flow={flow} onApplied={refresh} />
      <TemplatePacks project={projectArg} flow={flow} onApplied={refresh} />
      <AlwaysAllowed flow={flow} onApplied={refresh} />
      <BackupsSection scopes={scopesResponse.scopes} project={projectArg} flow={flow} onApplied={refresh} />

      {addOpen && (
        <AddSettingsModal project={projectArg} flow={flow} onApplied={refresh} onClose={() => setAddOpen(false)} />
      )}
      {flow.modal}
    </div>
  );
}
