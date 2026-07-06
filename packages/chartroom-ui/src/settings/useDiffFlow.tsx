import { useCallback, useState, type ReactElement } from 'react';
import {
  applySettingsEdit,
  previewSettingsEdit,
  SettingsApiError,
  type SettingsApplyResult,
  type SettingsEditPreview,
  type WritableSettingsScope,
} from '../api/client.js';
import { DiffModal } from './DiffModal.js';

export interface DiffFlowRequest {
  /** Modal heading, e.g. "Edit user settings" / "Apply pack 'safe web dev' to project". */
  title: string;
  scope: WritableSettingsScope;
  project?: string;
  newContent: string;
  onApplied?: (result: SettingsApplyResult) => void;
}

export interface DiffFlowApi {
  /** Preview an edit server-side, then open the modal (editor, backup restores). */
  openEdit: (request: DiffFlowRequest) => void;
  /** Open the modal with a server-computed preview already in hand (templates, revoke). */
  openWithPreview: (request: DiffFlowRequest, preview: SettingsEditPreview) => void;
  /** Preview-step failure (before any modal exists) -- render near the triggering section. */
  openError: string | null;
  /** The mounted modal element (or null) -- render once at the page root. */
  modal: ReactElement | null;
}

interface DiffFlowState {
  request: DiffFlowRequest;
  preview: SettingsEditPreview;
  busy: boolean;
  error: string | null;
  errorCode: string | null;
}

/**
 * The shared preview→apply rail behind every Settings write (spec: NO write path without the
 * diff modal). Holds the pending edit + its preview ticket, performs the apply with the
 * preview's `baseHash`, and maps the station's typed 409s onto modal recoveries: `base-drift`
 * re-previews the same content against the file's new bytes; `malformed-target` surfaces the
 * explicit overwrite checkbox (DiffModal owns that state).
 */
export function useDiffFlow(): DiffFlowApi {
  const [state, setState] = useState<DiffFlowState | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const openWithPreview = useCallback((request: DiffFlowRequest, preview: SettingsEditPreview) => {
    setOpenError(null);
    setState({ request, preview, busy: false, error: null, errorCode: null });
  }, []);

  const openEdit = useCallback(
    (request: DiffFlowRequest) => {
      setOpenError(null);
      previewSettingsEdit({ scope: request.scope, project: request.project, newContent: request.newContent })
        .then((preview) => openWithPreview(request, preview))
        .catch((err: unknown) => setOpenError(err instanceof Error ? err.message : String(err)));
    },
    [openWithPreview],
  );

  const close = useCallback(() => setState(null), []);

  const rePreview = useCallback(() => {
    if (!state || state.busy) return;
    setState({ ...state, busy: true });
    previewSettingsEdit({
      scope: state.request.scope,
      project: state.request.project,
      newContent: state.request.newContent,
    })
      .then((preview) =>
        setState((latest) => (latest ? { ...latest, preview, busy: false, error: null, errorCode: null } : latest)),
      )
      .catch((err: unknown) =>
        setState((latest) =>
          latest ? { ...latest, busy: false, error: err instanceof Error ? err.message : String(err) } : latest,
        ),
      );
  }, [state]);

  const apply = useCallback(
    (options: { overwriteMalformedBase: boolean }) => {
      if (!state || state.busy) return;
      setState({ ...state, busy: true, error: null, errorCode: null });
      applySettingsEdit({
        scope: state.request.scope,
        project: state.request.project,
        newContent: state.request.newContent,
        baseHash: state.preview.baseHash,
        ...(options.overwriteMalformedBase ? { overwriteMalformedBase: true } : {}),
      })
        .then((result) => {
          setState(null);
          state.request.onApplied?.(result);
        })
        .catch((err: unknown) =>
          setState((latest) =>
            latest
              ? {
                  ...latest,
                  busy: false,
                  error: err instanceof Error ? err.message : String(err),
                  errorCode: err instanceof SettingsApiError ? (err.code ?? null) : null,
                }
              : latest,
          ),
        );
    },
    [state],
  );

  const modal = state ? (
    <DiffModal
      title={state.request.title}
      preview={state.preview}
      busy={state.busy}
      error={state.error}
      errorCode={state.errorCode}
      onApply={apply}
      onRePreview={rePreview}
      onClose={close}
    />
  ) : null;

  return { openEdit, openWithPreview, openError, modal };
}
