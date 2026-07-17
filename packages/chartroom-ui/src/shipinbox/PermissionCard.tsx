import { useMemo, useState, type ReactElement } from 'react';
import type { ShipPermissionRequest } from '../api/client.js';

export interface PermissionCardProps {
  request: ShipPermissionRequest;
  onDecide: (
    request: ShipPermissionRequest,
    behavior: 'allow' | 'deny',
    opts?: { alwaysAllowRule?: string; message?: string },
  ) => void;
}

/** Best-effort native-rule suggestion for the "always allow" input: shell tools get a
 * first-word prefix rule (`Bash(git:*)` -- Windows sessions report `PowerShell`, researcher
 * R1), everything else the bare tool name. The human edits freely; the server re-validates. */
export function suggestRule(toolName: string, toolInput: unknown): string {
  const command =
    typeof toolInput === 'object' && toolInput !== null && 'command' in toolInput
      ? String((toolInput as { command: unknown }).command)
      : undefined;
  if (command && (toolName === 'Bash' || toolName === 'PowerShell')) {
    const firstWord = command.trim().split(/\s+/)[0];
    if (firstWord) return `${toolName}(${firstWord}:*)`;
  }
  return toolName;
}

function toolInputPreview(toolInput: unknown): string | undefined {
  if (toolInput === undefined || toolInput === null) return undefined;
  const text = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);
  return text.length > 220 ? `${text.slice(0, 220)}…` : text;
}

/** One pending permission request: what/where, Allow / Deny (with an optional deny note), and
 * an opt-in "always allow" panel whose rule text is written as a NATIVE permission rule
 * server-side.
 *
 * Defect D3 (wave2-E): a `source: 'hook'` row arrived over the ingest transport -- no resolver
 * is long-polling for the answer (probe: deciding one succeeds with parkedWaiters 0 and affects
 * nothing), so it renders record-only: no actionable buttons, a plain explanation instead.
 *
 * Defect D2: the deny note CANNOT ride the permission answer itself (the PermissionRequest hook
 * decision JSON is behavior-only -- docs-verified); the server delivers it to the session's
 * transcript instead, which the note UI says out loud. */
export function PermissionCard({ request, onDecide }: PermissionCardProps): ReactElement {
  const [alwaysOpen, setAlwaysOpen] = useState(false);
  const [denyNoteOpen, setDenyNoteOpen] = useState(false);
  const [denyNote, setDenyNote] = useState('');
  const [rule, setRule] = useState(() => suggestRule(request.toolName, request.toolInput));
  const preview = useMemo(() => toolInputPreview(request.toolInput), [request.toolInput]);
  const recordOnly = request.source === 'hook';

  return (
    <div className="ship-inbox__permission">
      <div className="ship-inbox__question-body">
        <span className="inbox-page__kind inbox-page__kind--permission">{request.toolName}</span>
        <span className="inbox-page__label">
          {request.project ?? request.cwd} wants to run <code>{request.toolName}</code>
        </span>
        {preview && <code className="ship-inbox__preview">{preview}</code>}
        <span className="inbox-page__doc-path">
          {request.cwd} · session {request.sessionId.slice(0, 8)}
          {recordOnly ? ' · record only (no live prompt attached)' : ''}
        </span>
      </div>
      {recordOnly ? (
        <p className="ship-inbox__always-note">
          Record only: this request arrived as telemetry — no session is waiting on a decision here, so
          there is nothing to allow or deny.
        </p>
      ) : (
        <div className="ship-inbox__actions">
          <button type="button" className="ship-inbox__btn ship-inbox__btn--allow" onClick={() => onDecide(request, 'allow')}>
            allow
          </button>
          <button type="button" className="ship-inbox__btn ship-inbox__btn--deny" onClick={() => onDecide(request, 'deny')}>
            deny
          </button>
          <button
            type="button"
            className="ship-inbox__btn"
            aria-expanded={denyNoteOpen}
            onClick={() => setDenyNoteOpen((open) => !open)}
          >
            deny with note…
          </button>
          <button
            type="button"
            className="ship-inbox__btn"
            aria-expanded={alwaysOpen}
            onClick={() => setAlwaysOpen((open) => !open)}
          >
            always allow…
          </button>
        </div>
      )}
      {!recordOnly && denyNoteOpen && (
        <div className="ship-inbox__always">
          <label className="ship-inbox__always-label">
            note to the session
            <input
              type="text"
              className="ship-inbox__rule-input"
              value={denyNote}
              onChange={(event) => setDenyNote(event.target.value)}
              aria-label="Deny note"
              placeholder="why not / what to do instead"
            />
          </label>
          <button
            type="button"
            className="ship-inbox__btn ship-inbox__btn--deny"
            disabled={denyNote.trim().length === 0}
            onClick={() => onDecide(request, 'deny', { message: denyNote.trim() })}
          >
            deny + send note
          </button>
          <p className="ship-inbox__always-note">
            The permission answer itself carries no reason (behavior-only hook schema) — the note is
            delivered to the session&#8217;s transcript and read when it next resumes, not mid-task.
          </p>
        </div>
      )}
      {!recordOnly && alwaysOpen && (
        <div className="ship-inbox__always">
          <label className="ship-inbox__always-label">
            native rule for <code>{request.project ?? request.cwd}</code>
            <input
              type="text"
              className="ship-inbox__rule-input"
              value={rule}
              onChange={(event) => setRule(event.target.value)}
              aria-label="Permission rule"
            />
          </label>
          <button
            type="button"
            className="ship-inbox__btn ship-inbox__btn--allow"
            disabled={rule.trim().length === 0}
            onClick={() => onDecide(request, 'allow', { alwaysAllowRule: rule.trim() })}
          >
            allow + remember
          </button>
          <p className="ship-inbox__always-note">
            Writes this rule into the project&#8217;s <code>.claude/settings.local.json</code> (additive, with a
            timestamped backup) -- Claude Code itself enforces it from the next prompt on.
          </p>
        </div>
      )}
    </div>
  );
}
