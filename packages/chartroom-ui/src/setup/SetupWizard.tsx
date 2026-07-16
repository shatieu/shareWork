import { useEffect, type ReactElement } from 'react';
import type { RepoSetupItem } from '../api/client.js';
import type { SetupWizardState } from './useSetupWizard.js';
import './setup.css';

export interface SetupWizardProps {
  state: SetupWizardState;
  onToggle: (itemId: string) => void;
  onApply: () => void;
  onContinueToHuman: () => void;
  onBackToAudit: () => void;
  onReaudit: () => void;
  onRunInTerminal: (itemId: string) => void;
  onClose: () => void;
}

function StateChip({ state }: { state: RepoSetupItem['state'] }): ReactElement {
  return <span className={`setup-chip setup-chip--${state}`}>{state}</span>;
}

/**
 * The repo-setup wizard modal (deck-onboarding-wizard plan, FE §2): phase 1 renders the audit
 * checklist grouped Auto / Human (auto items pre-checked when missing/partial); phase 2 the
 * per-item apply results (a failure never hides the other rows); phase 3 the remaining human
 * steps with copy + "run in terminal" and a Re-audit loop. Presentational -- all state lives in
 * useSetupWizard (the useDiffFlow precedent).
 */
export function SetupWizard({
  state,
  onToggle,
  onApply,
  onContinueToHuman,
  onBackToAudit,
  onReaudit,
  onRunInTerminal,
  onClose,
}: SetupWizardProps): ReactElement {
  const { repo, phase, audit, auditError, selected, busy, results, applyError, runningId, runError } = state;

  useEffect(() => {
    function onEsc(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const autoItems = audit?.items.filter((item) => item.kind === 'auto') ?? [];
  const humanItems = audit?.items.filter((item) => item.kind === 'human') ?? [];
  const remainingHuman = humanItems.filter((item) => item.state !== 'present');
  const labelOf = (id: string): string => audit?.items.find((item) => item.id === id)?.label ?? id;

  let body: ReactElement;
  let footer: ReactElement;

  if (phase === 'audit') {
    body = (
      <>
        {busy && !audit && <p className="setup-wizard__loading">auditing repo setup…</p>}
        {auditError && (
          <div className="setup-wizard__error" role="alert">
            <p>{auditError}</p>
            <button type="button" className="btn-brass" onClick={onReaudit} disabled={busy}>
              retry audit
            </button>
          </div>
        )}
        {audit && (
          <>
            <h3 className="setup-wizard__group">Auto steps</h3>
            <ul className="setup-wizard__items">
              {autoItems.map((item) => (
                <li key={item.id} className="setup-item">
                  <label className="setup-item__pick">
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => onToggle(item.id)}
                      aria-label={`Apply ${item.label}`}
                    />
                    <span className="setup-item__label">{item.label}</span>
                    <StateChip state={item.state} />
                  </label>
                  <p className="setup-item__detail">{item.detail}</p>
                </li>
              ))}
            </ul>
            <h3 className="setup-wizard__group">Human steps</h3>
            <ul className="setup-wizard__items">
              {humanItems.map((item) => (
                <li key={item.id} className="setup-item">
                  <div className="setup-item__pick">
                    <span className="setup-item__label">{item.label}</span>
                    <StateChip state={item.state} />
                  </div>
                  <p className="setup-item__detail">{item.detail}</p>
                  {item.command && <code className="setup-item__command">{item.command}</code>}
                </li>
              ))}
            </ul>
          </>
        )}
      </>
    );
    footer = (
      <>
        <button type="button" className="btn-brass" onClick={onClose}>
          cancel
        </button>
        {selected.size > 0 ? (
          <button type="button" className="btn-rust" onClick={onApply} disabled={busy || !audit}>
            apply {selected.size} selected
          </button>
        ) : (
          <button type="button" className="btn-rust" onClick={onContinueToHuman} disabled={busy || !audit}>
            human steps →
          </button>
        )}
      </>
    );
  } else if (phase === 'apply') {
    body = (
      <>
        {busy && <p className="setup-wizard__loading">applying selected items…</p>}
        {applyError && (
          <p className="setup-wizard__error" role="alert">
            {applyError}
          </p>
        )}
        {results && (
          <ul className="setup-wizard__items" aria-label="Apply results">
            {results.map((result) => (
              <li key={result.id} className="setup-item">
                <div className="setup-item__pick">
                  <span
                    className={result.ok ? 'setup-result setup-result--ok' : 'setup-result setup-result--fail'}
                    aria-hidden="true"
                  >
                    {result.ok ? '✓' : '✗'}
                  </span>
                  <span className="setup-item__label">{labelOf(result.id)}</span>
                  <span className={result.ok ? 'setup-chip setup-chip--present' : 'setup-chip setup-chip--missing'}>
                    {result.ok ? 'ok' : 'fail'}
                  </span>
                </div>
                <p className="setup-item__detail">{result.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </>
    );
    footer = (
      <>
        <button type="button" className="btn-brass" onClick={onBackToAudit} disabled={busy}>
          ← back to checklist
        </button>
        <button type="button" className="btn-rust" onClick={onContinueToHuman} disabled={busy}>
          continue →
        </button>
      </>
    );
  } else {
    body = (
      <>
        {remainingHuman.length === 0 ? (
          <p className="setup-wizard__done">No human steps remain — everything the audit checks is present.</p>
        ) : (
          <>
            <h3 className="setup-wizard__group">Human steps</h3>
            <ul className="setup-wizard__items">
              {remainingHuman.map((item) => (
                <li key={item.id} className="setup-item">
                  <div className="setup-item__pick">
                    <span className="setup-item__label">{item.label}</span>
                    <StateChip state={item.state} />
                  </div>
                  <p className="setup-item__detail">{item.detail}</p>
                  {item.command && (
                    <div className="setup-item__run">
                      <code className="setup-item__command">{item.command}</code>
                      <button
                        type="button"
                        className="copy-btn"
                        onClick={() => void navigator.clipboard?.writeText(item.command ?? '')}
                        aria-label={`Copy command for ${item.label}`}
                      >
                        copy
                      </button>
                      <button
                        type="button"
                        className="btn-brass"
                        onClick={() => onRunInTerminal(item.id)}
                        disabled={runningId !== null}
                        aria-label={`Run ${item.label} in terminal`}
                      >
                        {runningId === item.id ? 'opening…' : 'run in terminal'}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {runError && (
          <p className="setup-wizard__error" role="alert">
            {runError}
          </p>
        )}
      </>
    );
    footer = (
      <>
        <button type="button" className="btn-brass" onClick={onReaudit} disabled={busy}>
          re-audit
        </button>
        <button type="button" className="btn-rust" onClick={onClose}>
          done
        </button>
      </>
    );
  }

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal register-modal setup-wizard" role="dialog" aria-label={`Set up ${repo.name}`}>
        <div className="register-modal__head">
          <h2 className="panel__label">
            Set up <code>{repo.name}</code>
            <span className="setup-wizard__phase">
              {' '}
              · {phase === 'audit' ? '1 audit' : phase === 'apply' ? '2 apply' : '3 human steps'}
            </span>
          </h2>
          <span className="chrome__spacer" />
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close setup wizard">
            ✕
          </button>
        </div>
        <div className="setup-wizard__body">{body}</div>
        <div className="register-modal__footer setup-wizard__footer">{footer}</div>
      </div>
    </div>
  );
}
