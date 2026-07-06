import { useState, type ReactElement } from 'react';
import type { SettingsEditPreview } from '../api/client.js';

export interface DiffModalProps {
  title: string;
  preview: SettingsEditPreview;
  busy: boolean;
  /** Apply-leg error message (base-drift, malformed-target, schema-violation, ...). */
  error: string | null;
  /** The station's typed error code -- drives the recovery affordances. */
  errorCode: string | null;
  onApply: (options: { overwriteMalformedBase: boolean }) => void;
  onRePreview: () => void;
  onClose: () => void;
}

/**
 * The one write gate (Trio_Specs §B rail: "diff preview on every apply -- no silent writes,
 * ever"). Every mutation in the Settings tab -- editor saves, template packs, revokes, backup
 * restores -- flows through this modal: ops with +/- coloring, blocking validation errors,
 * advisory warnings, and the typed 409 recoveries (base-drift → re-preview; malformed-target →
 * an explicit, clearly-labeled overwrite checkbox).
 */
export function DiffModal({
  title,
  preview,
  busy,
  error,
  errorCode,
  onApply,
  onRePreview,
  onClose,
}: DiffModalProps): ReactElement {
  const [overwriteMalformedBase, setOverwriteMalformedBase] = useState(false);

  const blockingErrors = preview.validation.errors;
  const warnings = preview.validation.warnings;
  const showRecovery = preview.baseMalformed || errorCode === 'malformed-target';
  const applyDisabled = busy || blockingErrors.length > 0 || preview.unchanged;

  return (
    <div className="settings-modal__overlay" role="presentation">
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="settings-modal__head">
          <h3 className="settings-modal__title">{title}</h3>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close diff preview">
            ✕
          </button>
        </div>

        <p className="settings-modal__target" title={preview.targetPath}>
          <code>{preview.targetPath}</code>
          {!preview.exists && <span className="settings-modal__new"> (new file)</span>}
        </p>
        <p className="settings-modal__stats">
          <span className="settings-modal__added">+{preview.added}</span>{' '}
          <span className="settings-modal__removed">−{preview.removed}</span>
          <span className="settings-modal__schema"> · validated against {preview.schemaSource}</span>
        </p>

        {blockingErrors.length > 0 && (
          <div className="settings-modal__errors" role="alert">
            <p>Schema errors -- apply is blocked until they are fixed:</p>
            <ul>
              {blockingErrors.map((issue) => (
                <li key={`${issue.path}:${issue.message}`}>
                  <code>{issue.path}</code> {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="settings-modal__warnings">
            <p>Warnings (advisory, never blocking):</p>
            <ul>
              {warnings.map((issue) => (
                <li key={`${issue.path}:${issue.message}`}>
                  <code>{issue.path}</code> {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {preview.unchanged ? (
          <p className="settings-modal__unchanged">No changes -- the new content is byte-identical.</p>
        ) : (
          <pre className="settings-diff" aria-label="Diff preview">
            {preview.ops.map((op, index) => (
              <div key={index} className={`diff-line diff-line--${op.kind}`}>
                {op.kind === 'add' ? '+' : op.kind === 'del' ? '-' : ' '}
                {op.line}
              </div>
            ))}
          </pre>
        )}

        {showRecovery && (
          <label className="settings-modal__recovery">
            <input
              type="checkbox"
              checked={overwriteMalformedBase}
              onChange={(event) => setOverwriteMalformedBase(event.target.checked)}
            />
            <span>
              Overwrite the malformed target file
              {preview.baseError ? ` (${preview.baseError})` : ''} -- recovery path; a timestamped backup of the broken
              file is still taken first.
            </span>
          </label>
        )}

        {error && (
          <div className="settings-modal__apply-error" role="alert">
            <p>{error}</p>
            {errorCode === 'base-drift' && (
              <button type="button" className="ship-inbox__btn" onClick={onRePreview} disabled={busy}>
                Reload &amp; re-preview
              </button>
            )}
          </div>
        )}

        <div className="settings-modal__footer">
          <button type="button" className="ship-inbox__btn" onClick={onClose} disabled={busy}>
            cancel
          </button>
          <button
            type="button"
            className="btn-brass"
            onClick={() => onApply({ overwriteMalformedBase })}
            disabled={applyDisabled}
          >
            {busy ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
