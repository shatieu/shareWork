import { useState, type ReactElement } from 'react';
import {
  simulateSettings,
  type SettingsDecidingRule,
  type SettingsSimulateRequest,
  type SettingsVerdict,
} from '../api/client.js';
import { ScopeBadge, SourceFile } from './ScopeBadge.js';

export interface SimulatorProps {
  /** Selected project directory (absPath) -- project/local scopes join the verdict. */
  project?: string;
}

const KNOWN_TOOLS = ['Bash', 'PowerShell', 'Read', 'Edit', 'Write', 'WebFetch'] as const;
const CUSTOM_TOOL = '__custom__';

type ArgKind = 'command' | 'path' | 'url' | 'input';

function argKindFor(tool: string): ArgKind {
  if (tool === 'Bash' || tool === 'PowerShell') return 'command';
  if (tool === 'Read' || tool === 'Edit' || tool === 'Write') return 'path';
  if (tool === 'WebFetch') return 'url';
  return 'input';
}

function RuleLine({ rule, label }: { rule: SettingsDecidingRule; label: string }): ReactElement {
  return (
    <p className="settings-verdict__rule">
      {label} <code>{rule.rule}</code> in the <ScopeBadge scope={rule.scope} /> {rule.list} list · <SourceFile file={rule.file} />
      {rule.subcommand !== undefined && (
        <>
          {' '}
          (subcommand <code>{rule.subcommand}</code>)
        </>
      )}
    </p>
  );
}

/**
 * The effective-permission simulator (Trio_Specs §B centerpiece): type a hypothetical tool call,
 * get the verdict -- would it be allowed right now, and which rule in which file decides. The
 * verdict card shows the deciding rule + scope + source file, the explanation, and keeps the
 * engine honest: caveats and unevaluated rules are collapsible but always present.
 */
export function Simulator({ project }: SimulatorProps): ReactElement {
  const [tool, setTool] = useState<string>('Bash');
  const [customTool, setCustomTool] = useState('');
  const [argText, setArgText] = useState('');
  const [rawInput, setRawInput] = useState('');
  const [verdict, setVerdict] = useState<SettingsVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveTool = tool === CUSTOM_TOOL ? customTool.trim() : tool;
  const argKind = argKindFor(effectiveTool || 'Bash');

  const run = (): void => {
    const request: SettingsSimulateRequest = { project, tool: effectiveTool };
    if (tool === CUSTOM_TOOL) {
      if (rawInput.trim()) {
        try {
          const parsed: unknown = JSON.parse(rawInput);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            setError('tool input must be a JSON object');
            return;
          }
          request.input = parsed as Record<string, unknown>;
        } catch {
          setError('tool input is not valid JSON');
          return;
        }
      }
    } else if (argText.trim()) {
      request[argKind as 'command' | 'path' | 'url'] = argText;
    }
    setBusy(true);
    setError(null);
    simulateSettings(request)
      .then((next) => setVerdict(next))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const behaviorLabel =
    verdict === null ? '' : verdict.behavior === 'default' ? `default (${verdict.mode})` : verdict.behavior;

  return (
    <section className="settings-panel settings-simulator" aria-label="Permission simulator">
      <h2 className="settings-panel__title">Simulator</h2>
      <p className="settings-panel__hint">
        Would this tool call be allowed right now -- and which rule in which file decides?
      </p>
      <form
        className="settings-simulator__form"
        onSubmit={(event) => {
          event.preventDefault();
          run();
        }}
      >
        <label className="settings-field">
          tool
          <select
            className="settings-select"
            aria-label="Tool"
            value={tool}
            onChange={(event) => {
              setTool(event.target.value);
              setVerdict(null);
            }}
          >
            {KNOWN_TOOLS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            <option value={CUSTOM_TOOL}>other tool…</option>
          </select>
        </label>
        {tool === CUSTOM_TOOL ? (
          <>
            <label className="settings-field">
              tool name
              <input
                type="text"
                className="settings-input"
                aria-label="Tool name"
                placeholder="mcp__server__tool"
                value={customTool}
                onChange={(event) => setCustomTool(event.target.value)}
              />
            </label>
            <label className="settings-field settings-field--grow">
              input (JSON, optional)
              <input
                type="text"
                className="settings-input"
                aria-label="Tool input JSON"
                placeholder='{"param":"value"}'
                value={rawInput}
                onChange={(event) => setRawInput(event.target.value)}
              />
            </label>
          </>
        ) : (
          <label className="settings-field settings-field--grow">
            {argKind}
            <input
              type="text"
              className="settings-input"
              aria-label={argKind}
              placeholder={
                argKind === 'command' ? 'rm -rf ./dist' : argKind === 'path' ? 'src/**/*.ts' : 'https://example.com'
              }
              value={argText}
              onChange={(event) => setArgText(event.target.value)}
            />
          </label>
        )}
        <button type="submit" className="btn-brass" disabled={busy || effectiveTool.length === 0}>
          {busy ? 'Running…' : 'Run simulation'}
        </button>
      </form>

      {error && (
        <p className="app-shell__error" role="alert">
          {error}
        </p>
      )}

      {verdict && (
        <div className={`settings-verdict settings-verdict--${verdict.behavior}`} role="status">
          <div className="settings-verdict__head">
            <span className="settings-verdict__behavior">{behaviorLabel}</span>
            <span className="settings-verdict__mode">
              mode: {verdict.mode}
              {verdict.modeSource && (
                <>
                  {' '}
                  · set in <SourceFile file={verdict.modeSource.file} /> (<ScopeBadge scope={verdict.modeSource.scope} />)
                </>
              )}
            </span>
          </div>
          {verdict.decidingRule && <RuleLine rule={verdict.decidingRule} label="decided by" />}
          <p className="settings-verdict__explanation">{verdict.explanation}</p>
          {verdict.supportingRules && verdict.supportingRules.length > 1 && (
            <div className="settings-verdict__supporting">
              <p>compound command -- every subcommand covered:</p>
              {verdict.supportingRules.map((rule, index) => (
                <RuleLine key={`${rule.rule}-${index}`} rule={rule} label="allowed by" />
              ))}
            </div>
          )}
          {verdict.notes.length > 0 && (
            <ul className="settings-verdict__notes">
              {verdict.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          {verdict.unevaluated.length > 0 && (
            <details className="settings-verdict__details">
              <summary>unevaluated rules ({verdict.unevaluated.length}) -- could change this verdict</summary>
              <ul>
                {verdict.unevaluated.map((rule, index) => (
                  <li key={`${rule.rule}-${index}`}>
                    <code>{rule.rule}</code> <ScopeBadge scope={rule.scope} /> <SourceFile file={rule.file} /> --{' '}
                    {rule.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details className="settings-verdict__details">
            <summary>caveats ({verdict.caveats.length})</summary>
            <ul>
              {verdict.caveats.map((caveat) => (
                <li key={caveat}>{caveat}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
