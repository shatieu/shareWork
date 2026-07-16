import { useCallback, useState, type ReactElement } from 'react';
import {
  repoSetupApply,
  repoSetupAudit,
  repoSetupRun,
  type RepoSetupApplyResult,
  type RepoSetupAuditResponse,
} from '../api/client.js';
import { SetupWizard } from './SetupWizard.js';

export interface SetupWizardRepo {
  id: string;
  name: string;
}

export type SetupWizardPhase = 'audit' | 'apply' | 'human';

export interface SetupWizardApi {
  /** Open the wizard for a repo -- fires the audit immediately (phase 1). */
  open: (repo: SetupWizardRepo) => void;
  /** The mounted modal element (or null) -- render once at the app root. */
  modal: ReactElement | null;
}

export interface SetupWizardState {
  repo: SetupWizardRepo;
  phase: SetupWizardPhase;
  /** null while the audit request is in flight. */
  audit: RepoSetupAuditResponse | null;
  auditError: string | null;
  /** Selected AUTO item ids (pre-checked when missing/partial). */
  selected: ReadonlySet<string>;
  /** An audit or apply request is in flight. */
  busy: boolean;
  /** Per-item apply results (phase 2) -- failures render alongside successes. */
  results: RepoSetupApplyResult[] | null;
  applyError: string | null;
  /** Human item currently being launched via "run in terminal". */
  runningId: string | null;
  runError: string | null;
}

function preselect(audit: RepoSetupAuditResponse): Set<string> {
  return new Set(audit.items.filter((item) => item.kind === 'auto' && item.state !== 'present').map((item) => item.id));
}

/**
 * The setup wizard's state rail (mirrors useDiffFlow's hook shape: nullable state object, stable
 * callbacks, a `modal` element the host mounts once). Three phases per the plan: audit checklist
 * → apply selected auto items with per-item results → remaining human steps (copy / run in
 * terminal) with a Re-audit loop back to phase 1.
 */
export function useSetupWizard(): SetupWizardApi {
  const [state, setState] = useState<SetupWizardState | null>(null);

  const runAudit = useCallback((repo: SetupWizardRepo) => {
    repoSetupAudit(repo.id)
      .then((audit) =>
        setState((latest) =>
          latest && latest.repo.id === repo.id
            ? { ...latest, audit, selected: preselect(audit), busy: false, auditError: null }
            : latest,
        ),
      )
      .catch((err: unknown) =>
        setState((latest) =>
          latest && latest.repo.id === repo.id
            ? { ...latest, busy: false, auditError: err instanceof Error ? err.message : String(err) }
            : latest,
        ),
      );
  }, []);

  const open = useCallback(
    (repo: SetupWizardRepo) => {
      setState({
        repo,
        phase: 'audit',
        audit: null,
        auditError: null,
        selected: new Set<string>(),
        busy: true,
        results: null,
        applyError: null,
        runningId: null,
        runError: null,
      });
      runAudit(repo);
    },
    [runAudit],
  );

  const close = useCallback(() => setState(null), []);

  const toggle = useCallback((itemId: string) => {
    setState((latest) => {
      if (!latest) return latest;
      const selected = new Set(latest.selected);
      if (selected.has(itemId)) selected.delete(itemId);
      else selected.add(itemId);
      return { ...latest, selected };
    });
  }, []);

  const apply = useCallback(() => {
    if (!state || state.busy || state.selected.size === 0) return;
    const ids = [...state.selected];
    const repoId = state.repo.id;
    setState({ ...state, phase: 'apply', busy: true, results: null, applyError: null });
    repoSetupApply(repoId, ids)
      .then((response) =>
        setState((latest) =>
          latest && latest.repo.id === repoId ? { ...latest, results: response.results, busy: false } : latest,
        ),
      )
      .catch((err: unknown) =>
        setState((latest) =>
          latest && latest.repo.id === repoId
            ? { ...latest, busy: false, applyError: err instanceof Error ? err.message : String(err) }
            : latest,
        ),
      );
  }, [state]);

  const continueToHuman = useCallback(() => {
    setState((latest) => (latest ? { ...latest, phase: 'human' } : latest));
  }, []);

  const backToAudit = useCallback(() => {
    setState((latest) => (latest ? { ...latest, phase: 'audit', results: null, applyError: null } : latest));
  }, []);

  const reaudit = useCallback(() => {
    if (!state || state.busy) return;
    setState({
      ...state,
      phase: 'audit',
      audit: null,
      auditError: null,
      selected: new Set<string>(),
      busy: true,
      results: null,
      applyError: null,
      runError: null,
    });
    runAudit(state.repo);
  }, [state, runAudit]);

  const runInTerminal = useCallback((repoId: string, itemId: string) => {
    setState((latest) => (latest ? { ...latest, runningId: itemId, runError: null } : latest));
    repoSetupRun(repoId, itemId)
      .then(() =>
        setState((latest) =>
          latest && latest.runningId === itemId ? { ...latest, runningId: null } : latest,
        ),
      )
      .catch((err: unknown) =>
        setState((latest) =>
          latest && latest.runningId === itemId
            ? { ...latest, runningId: null, runError: err instanceof Error ? err.message : String(err) }
            : latest,
        ),
      );
  }, []);

  const modal = state ? (
    <SetupWizard
      state={state}
      onToggle={toggle}
      onApply={apply}
      onContinueToHuman={continueToHuman}
      onBackToAudit={backToAudit}
      onReaudit={reaudit}
      onRunInTerminal={(itemId) => runInTerminal(state.repo.id, itemId)}
      onClose={close}
    />
  ) : null;

  return { open, modal };
}
