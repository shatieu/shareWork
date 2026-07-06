import { useMemo, useState, type ReactElement } from 'react';
import type { ShipPermissionRequest } from '../api/client.js';

export interface PermissionCardProps {
  request: ShipPermissionRequest;
  onDecide: (request: ShipPermissionRequest, behavior: 'allow' | 'deny', alwaysAllowRule?: string) => void;
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

/** One pending permission request: what/where, Allow / Deny, and an opt-in "always allow"
 * panel whose rule text is written as a NATIVE permission rule server-side. */
export function PermissionCard({ request, onDecide }: PermissionCardProps): ReactElement {
  const [alwaysOpen, setAlwaysOpen] = useState(false);
  const [rule, setRule] = useState(() => suggestRule(request.toolName, request.toolInput));
  const preview = useMemo(() => toolInputPreview(request.toolInput), [request.toolInput]);

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
          {request.source === 'hook' ? ' · record only (no live prompt attached)' : ''}
        </span>
      </div>
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
          aria-expanded={alwaysOpen}
          onClick={() => setAlwaysOpen((open) => !open)}
        >
          always allow…
        </button>
      </div>
      {alwaysOpen && (
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
            onClick={() => onDecide(request, 'allow', rule.trim())}
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
