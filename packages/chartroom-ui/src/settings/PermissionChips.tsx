import { useRef, useState, type DragEvent, type ReactElement } from 'react';
import {
  previewSettingsMove,
  type AttributedSettingsRule,
  type SettingsEffectiveResponse,
  type SettingsPermissionList,
  type SettingsRuleMove,
  type SettingsScope,
  type WritableSettingsScope,
} from '../api/client.js';
import { ScopeBadge } from './ScopeBadge.js';
import type { DiffFlowApi } from './useDiffFlow.js';
import './chips.css';

export interface PermissionChipsProps {
  effective: SettingsEffectiveResponse;
  /** Selected project directory -- project/local-scope chips write into it. */
  project?: string;
  flow: DiffFlowApi;
  onApplied: () => void;
}

const LISTS: readonly SettingsPermissionList[] = ['deny', 'ask', 'allow'];

interface Chip {
  rule: string;
  scope: SettingsScope;
  file: string;
  /** Managed-scope rules are policy -- never movable. */
  movable: boolean;
}

interface ChipGroup {
  /** L1: tool name; L2 (Bash/PowerShell only): the command word, e.g. `git`. */
  label: string;
  chips: Chip[];
}

/** L1 = the rule's tool; L2 for Bash/PowerShell = the first specifier token (the command word,
 * `:*` suffix stripped) -- so `Bash(git push *)` and `Bash(git status)` share the `Bash · git`
 * group. Wildcard-leading specifiers stay at the tool level. */
export function chipGroupLabel(rule: string): string {
  const open = rule.indexOf('(');
  const tool = (open === -1 ? rule : rule.slice(0, open)).trim() || rule;
  if ((tool === 'Bash' || tool === 'PowerShell') && open !== -1 && rule.endsWith(')')) {
    let token = rule
      .slice(open + 1, -1)
      .trim()
      .split(/\s+/)[0];
    if (token.endsWith(':*')) token = token.slice(0, -2);
    if (token.length > 0 && !token.includes('*')) return `${tool} · ${token}`;
  }
  return tool;
}

function buildGroups(rules: AttributedSettingsRule[]): ChipGroup[] {
  const groups = new Map<string, ChipGroup>();
  for (const rule of rules) {
    const label = chipGroupLabel(rule.rule);
    let group = groups.get(label);
    if (!group) {
      group = { label, chips: [] };
      groups.set(label, group);
    }
    group.chips.push({ rule: rule.rule, scope: rule.scope, file: rule.file, movable: rule.scope !== 'managed' });
  }
  return [...groups.values()];
}

interface DragPayload {
  from: SettingsPermissionList;
  chips: Chip[];
}

/**
 * Permission rules as movable chips (the D1/D4 fix): allow/ask/deny columns, chips grouped by
 * tool and (for Bash/PowerShell) by command word. Chips and whole groups move between lists via
 * native HTML5 drag-and-drop OR the per-chip/per-group buttons (the keyboard fallback). Every
 * move composes a full new document server-side (`move/preview`) and is applied through the
 * SAME preview→apply rail as every other write. Managed-scope chips are immovable policy.
 */
export function PermissionChips({ effective, project, flow, onApplied }: PermissionChipsProps): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dragPayload = useRef<DragPayload | null>(null);

  /** One preview→apply pass per scope FILE touched, run sequentially through the shared modal. */
  const runBatches = (
    batches: { scope: WritableSettingsScope; moves: SettingsRuleMove[] }[],
    index: number,
    describe: string,
  ): void => {
    const batch = batches[index];
    if (!batch) return;
    const projectArg = batch.scope === 'user' ? undefined : project;
    const compose = () => previewSettingsMove({ scope: batch.scope, project: projectArg, moves: batch.moves });
    compose()
      .then((response) =>
        flow.openWithPreview(
          {
            title: `${describe} (${batch.scope} settings${batches.length > 1 ? `, ${index + 1}/${batches.length}` : ''})`,
            scope: batch.scope,
            project: projectArg,
            newContent: response.newContent,
            // D5: a base-drift recovery re-runs the move against the file's NEW bytes.
            recompose: () => compose().then((next) => ({ newContent: next.newContent, preview: next.preview })),
            onApplied: () => {
              onApplied();
              runBatches(batches, index + 1, describe);
            },
          },
          response.preview,
        ),
      )
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  const startMove = (chips: Chip[], from: SettingsPermissionList, to: SettingsPermissionList | undefined): void => {
    setError(null);
    setNotice(null);
    if (to === from) return;
    const movable = chips.filter((chip) => chip.movable);
    const skipped = chips.length - movable.length;
    if (movable.length === 0) {
      setNotice('Managed-scope rules are policy -- they cannot be moved or removed here.');
      return;
    }
    if (skipped > 0) {
      setNotice(`${skipped} managed-scope rule(s) skipped -- managed policy is immovable.`);
    }
    // One batch per scope file; one move per distinct rule string within it.
    const byScope = new Map<WritableSettingsScope, SettingsRuleMove[]>();
    for (const chip of movable) {
      const scope = chip.scope as WritableSettingsScope;
      const moves = byScope.get(scope) ?? [];
      if (!moves.some((move) => move.rule === chip.rule)) moves.push({ rule: chip.rule, from, to });
      byScope.set(scope, moves);
    }
    const batches = [...byScope.entries()].map(([scope, moves]) => ({ scope, moves }));
    const count = movable.length;
    const describe =
      to === undefined
        ? `Remove ${count === 1 ? `'${movable[0].rule}'` : `${count} rules`} from ${from}`
        : `Move ${count === 1 ? `'${movable[0].rule}'` : `${count} rules`} ${from} → ${to}`;
    runBatches(batches, 0, describe);
  };

  const handleDrop = (event: DragEvent, to: SettingsPermissionList): void => {
    event.preventDefault();
    const payload = dragPayload.current;
    dragPayload.current = null;
    if (!payload) return;
    startMove(payload.chips, payload.from, to);
  };

  const beginDrag = (event: DragEvent, payload: DragPayload): void => {
    dragPayload.current = payload;
    // Some browsers require data for a drag to start; the payload itself rides the ref.
    event.dataTransfer.setData('text/plain', payload.chips.map((chip) => chip.rule).join('\n'));
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="settings-chips">
      {error && (
        <p className="app-shell__error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="settings-excluded">{notice}</p>}
      <div className="settings-rules-grid">
        {LISTS.map((list) => {
          const rules = effective.permissions[list];
          const groups = buildGroups(rules);
          return (
            <div
              key={list}
              className={`settings-rules settings-rules--${list} chips-col`}
              role="group"
              aria-label={`${list} rules`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, list)}
            >
              <h3 className="settings-rules__title">
                {list} <span className="settings-rules__count">({rules.length})</span>
              </h3>
              {groups.length === 0 && <p className="settings-rules__empty">none -- drop rules here</p>}
              {groups.map((group) => {
                const groupMovable = group.chips.some((chip) => chip.movable);
                return (
                  <div key={group.label} className="chip-group">
                    <div
                      className="chip-group__head"
                      draggable={groupMovable}
                      onDragStart={(event) => beginDrag(event, { from: list, chips: group.chips })}
                    >
                      <span className="chip-group__label">
                        {group.label} <span className="settings-rules__count">({group.chips.length})</span>
                      </span>
                      {groupMovable && (
                        <span className="chip-group__actions">
                          {LISTS.filter((target) => target !== list).map((target) => (
                            <button
                              key={target}
                              type="button"
                              className="chip__btn"
                              aria-label={`Move group ${group.label} from ${list} to ${target}`}
                              onClick={() => startMove(group.chips, list, target)}
                            >
                              → {target}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="chip__btn chip__btn--remove"
                            aria-label={`Remove group ${group.label} from ${list}`}
                            onClick={() => startMove(group.chips, list, undefined)}
                          >
                            ✕
                          </button>
                        </span>
                      )}
                    </div>
                    <div className="chip-group__chips">
                      {group.chips.map((chip, chipIndex) => (
                        <span
                          key={`${chip.rule}-${chip.file}-${chipIndex}`}
                          className={chip.movable ? 'chip' : 'chip chip--managed'}
                          draggable={chip.movable}
                          onDragStart={(event) => beginDrag(event, { from: list, chips: [chip] })}
                          title={chip.movable ? chip.file : `${chip.file} -- managed policy, immovable`}
                        >
                          <code>{chip.rule}</code> <ScopeBadge scope={chip.scope} />
                          {chip.movable ? (
                            <span className="chip__actions">
                              {LISTS.filter((target) => target !== list).map((target) => (
                                <button
                                  key={target}
                                  type="button"
                                  className="chip__btn"
                                  aria-label={`Move ${chip.rule} from ${list} to ${target}`}
                                  onClick={() => startMove([chip], list, target)}
                                >
                                  → {target}
                                </button>
                              ))}
                              <button
                                type="button"
                                className="chip__btn chip__btn--remove"
                                aria-label={`Remove ${chip.rule} from ${list}`}
                                onClick={() => startMove([chip], list, undefined)}
                              >
                                ✕
                              </button>
                            </span>
                          ) : (
                            <span className="chip__lock" aria-hidden="true">
                              🔒
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
