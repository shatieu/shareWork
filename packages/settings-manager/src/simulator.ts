import { dirname } from 'node:path';
import type { AttributedRule, EffectiveSettings } from './merge.js';
import { matchRule, splitCompoundCommand, type MatchOutcome, type RuleContext, type ToolCall } from './rules.js';

/**
 * The effective-permission simulator (Trio_Specs §B centerpiece): answer "would this tool call
 * be allowed right now -- and which rule in which file decides?".
 *
 * PROVABLY READ-ONLY: this module (and everything it imports for evaluation: merge.ts, rules.ts)
 * performs zero filesystem access of any kind -- it operates on already-loaded scope data. A
 * dedicated test scans these sources for fs imports and snapshots a scope directory across a
 * simulate() call. Verified semantics (docs 2026-07-06): deny → ask → allow, first match wins,
 * specificity never reorders; no match → the effective defaultMode governs.
 */

export type VerdictBehavior = 'deny' | 'ask' | 'allow' | 'default';

export interface DecidingRule {
  rule: string;
  list: 'deny' | 'ask' | 'allow';
  scope: AttributedRule['scope'];
  file: string;
  /** For compound Bash commands: the subcommand this rule decided. */
  subcommand?: string;
}

export interface UnevaluatedRule extends DecidingRule {
  reason: string;
}

export interface Verdict {
  behavior: VerdictBehavior;
  /** The first-match rule that decided (absent when behavior = 'default'). */
  decidingRule?: DecidingRule;
  /** For allowed compound commands: every allow rule that covered a subcommand. */
  supportingRules?: DecidingRule[];
  /** The effective defaultMode governing the no-match case. */
  mode: string;
  modeSource?: { scope: AttributedRule['scope']; file: string };
  /** What the behavior means in a live session, in one sentence. */
  explanation: string;
  /** Honest limits of the model that could change the real outcome. */
  caveats: string[];
  /** Rules that MIGHT apply but use syntax this engine doesn't model -- shown, never hidden. */
  unevaluated: UnevaluatedRule[];
  notes: string[];
}

export interface SimulateOptions {
  cwd: string;
  homeDir: string;
  /** Project root -- the anchor for `/`-patterns in project/local scope rules. */
  projectDir?: string;
  /** Extra caveats from the loader (e.g. malformed scopes excluded). */
  extraCaveats?: string[];
}

const BASE_CAVEATS = [
  'CLI-argument scope (--allowedTools/--disallowedTools/--permission-mode) is session-only and not simulatable from files.',
  'PreToolUse hooks can deny or force prompts at runtime; hooks are not simulated.',
  'Sandboxing (autoAllowBashIfSandboxed) and the built-in read-only Bash command set can skip prompts; not simulated.',
  "Workspace trust can disable a project's allow rules until accepted; trust state is not simulated.",
];

function contextFor(rule: AttributedRule, options: SimulateOptions): RuleContext {
  // `/`-anchored path patterns resolve against the settings SOURCE (docs table, 2026-07-06):
  // project root for project/local settings, the settings file's own directory otherwise
  // (user settings at ~/.claude/settings.json anchor at ~/.claude).
  const sourceDir =
    (rule.scope === 'project' || rule.scope === 'local') && options.projectDir
      ? options.projectDir
      : dirname(rule.file);
  return { sourceDir, cwd: options.cwd, homeDir: options.homeDir };
}

interface ListScan {
  match?: DecidingRule;
  unevaluated: UnevaluatedRule[];
  notes: string[];
}

function scanList(
  rules: AttributedRule[],
  list: 'deny' | 'ask' | 'allow',
  call: ToolCall,
  options: SimulateOptions,
  subcommand?: string,
): ListScan {
  const unevaluated: UnevaluatedRule[] = [];
  const notes: string[] = [];
  for (const attributed of rules) {
    const outcome: MatchOutcome = matchRule(attributed.rule, call, contextFor(attributed, options), list);
    if (outcome.kind === 'match') {
      return {
        match: { rule: attributed.rule, list, scope: attributed.scope, file: attributed.file, subcommand },
        unevaluated,
        notes,
      };
    }
    if (outcome.kind === 'unevaluated') {
      unevaluated.push({
        rule: attributed.rule,
        list,
        scope: attributed.scope,
        file: attributed.file,
        subcommand,
        reason: outcome.reason,
      });
    } else if (outcome.note) {
      notes.push(outcome.note);
    }
  }
  return { unevaluated, notes };
}

function explain(behavior: VerdictBehavior, mode: string, deciding?: DecidingRule): string {
  switch (behavior) {
    case 'deny':
      return `DENIED by ${deciding?.list} rule '${deciding?.rule}' (${deciding?.scope} scope) -- deny rules are evaluated first and cannot be overridden by any allow rule in any scope.`;
    case 'ask':
      return `PROMPTS: ask rule '${deciding?.rule}' (${deciding?.scope} scope) forces a confirmation even if a more specific allow rule also matches.`;
    case 'allow':
      return `ALLOWED by rule '${deciding?.rule}' (${deciding?.scope} scope) -- runs without a prompt.`;
    case 'default':
      switch (mode) {
        case 'bypassPermissions':
          return 'No rule matched; bypassPermissions mode skips the prompt and the call runs.';
        case 'dontAsk':
          return 'No rule matched; dontAsk mode auto-DENIES anything not pre-approved.';
        case 'acceptEdits':
          return 'No rule matched; acceptEdits mode auto-accepts file edits and common filesystem commands in the working directory, and prompts for everything else.';
        case 'plan':
          return 'No rule matched; plan mode permits reads/exploration only.';
        case 'auto':
          return 'No rule matched; auto mode approves calls that pass its background safety checks (research preview).';
        default:
          return 'No rule matched; default mode prompts on first use of the tool.';
      }
  }
}

/** Evaluate one already-atomic call (or one subcommand) through deny → ask → allow. */
function evaluateSingle(
  effective: EffectiveSettings,
  call: ToolCall,
  options: SimulateOptions,
  subcommand?: string,
): { behavior: VerdictBehavior; deciding?: DecidingRule; unevaluated: UnevaluatedRule[]; notes: string[] } {
  const unevaluated: UnevaluatedRule[] = [];
  const notes: string[] = [];
  for (const list of ['deny', 'ask', 'allow'] as const) {
    const scan = scanList(effective.permissions[list], list, call, options, subcommand);
    unevaluated.push(...scan.unevaluated);
    notes.push(...scan.notes);
    if (scan.match) {
      const behavior: VerdictBehavior = list === 'deny' ? 'deny' : list === 'ask' ? 'ask' : 'allow';
      return { behavior, deciding: scan.match, unevaluated, notes };
    }
  }
  return { behavior: 'default', unevaluated, notes };
}

export function simulate(effective: EffectiveSettings, call: ToolCall, options: SimulateOptions): Verdict {
  const mode = typeof effective.permissions.defaultMode?.value === 'string' ? effective.permissions.defaultMode.value : 'default';
  const modeSource = effective.permissions.defaultMode
    ? { scope: effective.permissions.defaultMode.scope, file: effective.permissions.defaultMode.file }
    : undefined;

  const caveats = [...BASE_CAVEATS, ...(options.extraCaveats ?? [])];
  if (call.tool === 'PowerShell') {
    caveats.push('PowerShell alias canonicalization (gci/ls/dir → Get-ChildItem) is not modeled; write rules against cmdlet names.');
  }
  if (call.path !== undefined) {
    caveats.push('Symlink dual-path checking (rule applies to link AND target) is not modeled.');
  }
  for (const excludedScope of effective.excluded) {
    caveats.push(`${excludedScope.scope} scope EXCLUDED from this verdict -- ${excludedScope.file}: ${excludedScope.error}`);
  }

  const finish = (
    behavior: VerdictBehavior,
    deciding: DecidingRule | undefined,
    unevaluated: UnevaluatedRule[],
    notes: string[],
    supporting?: DecidingRule[],
  ): Verdict => ({
    behavior,
    decidingRule: deciding,
    supportingRules: supporting,
    mode,
    modeSource,
    explanation: explain(behavior, mode, deciding),
    caveats,
    unevaluated,
    notes,
  });

  // Compound Bash/PowerShell commands: each subcommand is evaluated independently against the
  // whole rule set; ANY deny denies the compound, ANY ask prompts, and it is only allowed when
  // EVERY subcommand is allowed (docs "Compound commands", 2026-07-06).
  if ((call.tool === 'Bash' || call.tool === 'PowerShell') && call.command !== undefined) {
    const subcommands = splitCompoundCommand(call.command);
    if (subcommands.length > 1) {
      const unevaluated: UnevaluatedRule[] = [];
      const notes: string[] = [];
      const supporting: DecidingRule[] = [];
      let firstAsk: DecidingRule | undefined;
      let allAllowed = true;
      for (const subcommand of subcommands) {
        const result = evaluateSingle(effective, { ...call, command: subcommand }, options, subcommand);
        unevaluated.push(...result.unevaluated);
        notes.push(...result.notes);
        if (result.behavior === 'deny') {
          return finish('deny', result.deciding, unevaluated, notes);
        }
        if (result.behavior === 'ask' && !firstAsk) firstAsk = result.deciding;
        if (result.behavior === 'allow' && result.deciding) supporting.push(result.deciding);
        if (result.behavior !== 'allow') allAllowed = false;
      }
      if (firstAsk) return finish('ask', firstAsk, unevaluated, notes);
      if (allAllowed) return finish('allow', supporting[0], unevaluated, notes, supporting);
      notes.push('Compound command: at least one subcommand has no matching rule, so the whole command falls to the permission mode.');
      return finish('default', undefined, unevaluated, notes);
    }
  }

  const result = evaluateSingle(effective, call, options);
  return finish(result.behavior, result.deciding, result.unevaluated, result.notes);
}
