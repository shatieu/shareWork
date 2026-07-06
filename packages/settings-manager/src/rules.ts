/**
 * Permission-rule parsing + matching (plan 07 §2/§3). Every behavior here is implemented from
 * the docs facts verified 2026-07-06 (code.claude.com/docs/en/permissions); each matcher's
 * comment cites the fact it encodes. Anything outside the supported subset is returned as
 * `unevaluated` -- NEVER silently treated as non-matching, because a silently skipped deny rule
 * would make the simulator lie in the dangerous direction.
 */

export interface ParsedRule {
  /** Tool-name part, e.g. `Bash`, `mcp__github__get_*`, `*`. */
  tool: string;
  /** Specifier inside parentheses; undefined for bare tool rules. */
  specifier?: string;
}

export type MatchOutcome =
  | { kind: 'match' }
  | { kind: 'no-match'; note?: string }
  | { kind: 'unevaluated'; reason: string };

export interface RuleContext {
  /** Directory `/`-anchored Read/Edit patterns resolve against (docs: the settings source).
   * Project/local scopes anchor at the project root; user scope anchors at `~/.claude`. */
  sourceDir: string;
  /** Current working directory for bare/`./` path patterns. */
  cwd: string;
  /** Home directory for `~/` patterns. */
  homeDir: string;
}

/** A hypothetical tool call under test. */
export interface ToolCall {
  tool: string;
  /** Bash/PowerShell command line. */
  command?: string;
  /** File path for Read/Edit/Write-family rules. */
  path?: string;
  /** URL for WebFetch rules. */
  url?: string;
  /** Raw top-level input params, for `Tool(param:value)` rules. */
  input?: Record<string, unknown>;
}

const MATCH: MatchOutcome = { kind: 'match' };
const NO_MATCH: MatchOutcome = { kind: 'no-match' };

export function parseRule(rule: string): ParsedRule | undefined {
  const trimmed = rule.trim();
  if (trimmed.length === 0) return undefined;
  const open = trimmed.indexOf('(');
  if (open === -1) return { tool: trimmed };
  if (!trimmed.endsWith(')') || open === 0) return undefined;
  return { tool: trimmed.slice(0, open), specifier: trimmed.slice(open + 1, -1) };
}

/* ────────────────────────────── generic glob helpers ────────────────────────────── */

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `*` matches any sequence of characters (including spaces) -- the Bash-rule glob semantics. */
function globToRegex(pattern: string, flags = ''): RegExp {
  const source = pattern.split('*').map(escapeRegex).join('[\\s\\S]*');
  return new RegExp(`^${source}$`, flags);
}

/* ────────────────────────────── tool-name matching ────────────────────────────── */

/**
 * Tool-name position (docs "Tool name wildcards", 2026-07-06):
 *  - deny/ask rules accept full-name globs (`*`, `mcp__*`);
 *  - allow rules accept globs only after a literal `mcp__<server>__` prefix; an unanchored
 *    allow glob (`*`, `B*`, `mcp__*`) is SKIPPED by Claude Code with a warning;
 *  - a bare `mcp__server` rule matches every tool of that server.
 */
export function matchToolName(ruleTool: string, callTool: string, list: 'allow' | 'deny' | 'ask'): MatchOutcome {
  const hasGlob = ruleTool.includes('*');
  if (!hasGlob) {
    if (ruleTool === callTool) return MATCH;
    // `mcp__server` (exactly two segments) covers every tool from that server.
    if (ruleTool.startsWith('mcp__') && ruleTool.split('__').length === 2 && callTool.startsWith(`${ruleTool}__`)) {
      return MATCH;
    }
    return NO_MATCH;
  }
  if (list === 'allow') {
    const anchored = /^mcp__[^*_][^*]*__/.test(ruleTool);
    if (!anchored) {
      return {
        kind: 'no-match',
        note: `allow rule '${ruleTool}' has an unanchored tool-name glob -- Claude Code skips it with a warning`,
      };
    }
  }
  return globToRegex(ruleTool).test(callTool) ? MATCH : NO_MATCH;
}

/* ────────────────────────────── Bash / PowerShell ────────────────────────────── */

/** Recognized command separators (docs "Compound commands"): `&&`, `||`, `;`, `|`, `|&`, `&`,
 * newlines. Quote-aware, best-effort (no full shell grammar -- surfaced as a global caveat). */
export function splitCompoundCommand(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote && command[i - 1] !== '\\') quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||' || two === '|&') {
      parts.push(current);
      current = '';
      i += 1;
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '&' || ch === '\n') {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Process wrappers stripped before matching (docs list, built-in and not configurable):
 * `timeout`, `time`, `nice`, `nohup`, `stdbuf`, plus bare `xargs` (only when flag-less). */
export function stripProcessWrappers(subcommand: string): string {
  let tokens = subcommand.split(/\s+/);
  for (;;) {
    const head = tokens[0];
    if (head === 'time' || head === 'nohup') {
      tokens = tokens.slice(1);
      continue;
    }
    if (head === 'timeout') {
      // `timeout [options] <duration> cmd` -- drop flags and the duration argument.
      let i = 1;
      while (i < tokens.length && tokens[i].startsWith('-')) i += 1;
      if (i < tokens.length && /^[\d.]+[smhd]?$/.test(tokens[i])) i += 1;
      tokens = tokens.slice(i);
      continue;
    }
    if (head === 'nice') {
      let i = 1;
      if (tokens[i] === '-n' ) i += 2;
      else if (tokens[i]?.startsWith('-')) i += 1;
      tokens = tokens.slice(i);
      continue;
    }
    if (head === 'stdbuf') {
      let i = 1;
      while (i < tokens.length && tokens[i].startsWith('-')) i += 1;
      tokens = tokens.slice(i);
      continue;
    }
    if (head === 'xargs' && tokens.length > 1 && !tokens[1].startsWith('-')) {
      // Bare xargs is stripped; `xargs -n1 ...` is matched as an xargs command (docs).
      tokens = tokens.slice(1);
      continue;
    }
    break;
  }
  return tokens.join(' ');
}

/**
 * One command-rule pattern against ONE subcommand (docs "Bash" + "Wildcard patterns"):
 *  - `*` at any position, spans spaces;
 *  - trailing ` *` (space before) enforces a word boundary: prefix + space-or-end-of-string
 *    (`ls *` matches `ls -la` and `ls`, not `lsof`);
 *  - `:*` SUFFIX is equivalent to trailing ` *`; a `:*` anywhere else is literal;
 *  - no glob = exact match.
 */
export function matchCommandPattern(pattern: string, subcommand: string, caseInsensitive = false): boolean {
  let normalized = pattern;
  if (normalized.endsWith(':*')) normalized = `${normalized.slice(0, -2)} *`;
  const flags = caseInsensitive ? 'i' : '';
  const target = stripProcessWrappers(subcommand.trim());
  if (normalized.endsWith(' *')) {
    const prefix = normalized.slice(0, -2);
    const prefixSource = prefix.split('*').map(escapeRegex).join('[\\s\\S]*');
    return new RegExp(`^${prefixSource}( [\\s\\S]*)?$`, flags).test(target);
  }
  if (!normalized.includes('*')) {
    return caseInsensitive ? normalized.toLowerCase() === target.toLowerCase() : normalized === target;
  }
  return globToRegex(normalized, flags).test(target);
}

/* ────────────────────────────── Read / Edit paths ────────────────────────────── */

/** Windows → POSIX normalization (docs: `C:\Users\alice` becomes `/c/Users/alice`). */
export function toPosixPath(path: string): string {
  let posix = path.replace(/\\/g, '/');
  const drive = /^([A-Za-z]):\//.exec(posix);
  if (drive) posix = `/${drive[1].toLowerCase()}/${posix.slice(3)}`;
  return posix.replace(/\/+$/, '') || '/';
}

const UNSUPPORTED_GITIGNORE = /(^!|\[|\]|\\[^\\])/;

/** Gitignore-subset segment pattern → regex source (`*`/`?` within a segment). */
function segmentToRegex(segment: string): string {
  let out = '';
  for (const ch of segment) {
    if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else out += escapeRegex(ch);
  }
  return out;
}

/** Gitignore-subset pattern match over a `/`-separated relative path. */
export function gitignoreMatch(pattern: string, relativePath: string): MatchOutcome {
  if (UNSUPPORTED_GITIGNORE.test(pattern)) {
    return { kind: 'unevaluated', reason: `gitignore syntax not modeled: '${pattern}'` };
  }
  let body = pattern.replace(/\/+$/, '/**'); // trailing slash = directory contents
  // Bare name (no slash except a `**/` prefix already implied): matches at any depth (docs:
  // `Read(.env)` ≡ `Read(**/.env)`).
  const anchored = body.includes('/');
  if (!anchored) body = `**/${body}`;
  const segments = body.split('/');
  let source = '^';
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const last = i === segments.length - 1;
    if (segment === '**') {
      if (last) {
        // `dir/**` matches everything under dir AND (docs Cd note aside) the tree beneath.
        source += '.*';
      } else {
        source += '(?:[^/]+/)*';
      }
      continue;
    }
    source += segmentToRegex(segment);
    if (!last) source += '/';
  }
  source += '$';
  return new RegExp(source).test(relativePath) ? MATCH : NO_MATCH;
}

/**
 * Path-rule matching (docs "Read and Edit", 2026-07-06). Anchors:
 *  `//path` = filesystem root; `~/path` = home; `/path` = the SETTINGS SOURCE directory
 *  (project root for project/local, `~/.claude` for user settings); bare or `./` = cwd.
 * A rule only matches files under its anchor.
 */
export function matchPathRule(specifier: string, targetPath: string, ctx: RuleContext): MatchOutcome {
  const target = toPosixPath(targetPath);
  if (specifier.startsWith('//')) {
    return gitignoreAnchored(specifier.slice(2), target, '/');
  }
  if (specifier.startsWith('~/')) {
    return gitignoreAnchored(specifier.slice(2), target, toPosixPath(ctx.homeDir));
  }
  if (specifier.startsWith('/')) {
    return gitignoreAnchored(specifier.slice(1), target, toPosixPath(ctx.sourceDir));
  }
  const body = specifier.startsWith('./') ? specifier.slice(2) : specifier;
  return gitignoreAnchored(body, target, toPosixPath(ctx.cwd));
}

function gitignoreAnchored(pattern: string, absTarget: string, anchor: string): MatchOutcome {
  const root = anchor === '/' ? '' : anchor;
  if (root !== '' && absTarget !== root && !absTarget.startsWith(`${root}/`)) {
    return NO_MATCH; // a rule only matches files under its anchor
  }
  const relative = absTarget === root ? '' : absTarget.slice(root.length + (root === '' ? 1 : 1));
  return gitignoreMatch(pattern, relative);
}

/* ────────────────────────────── WebFetch domains ────────────────────────────── */

/**
 * `domain:` matching (docs "WebFetch", 2026-07-06): case-insensitive; trailing `.` stripped on
 * both sides; leading `*.` matches subdomains at any depth but NOT the apex; a bare `*` matches
 * everything; elsewhere `*` matches only within one dot-delimited label.
 */
export function matchDomainRule(specifier: string, url: string): MatchOutcome {
  if (!specifier.startsWith('domain:')) {
    return { kind: 'unevaluated', reason: `WebFetch specifier without 'domain:' prefix: '${specifier}'` };
  }
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // The tester may type a bare hostname instead of a full URL -- accept it as-is.
    hostname = url;
  }
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const pattern = specifier.slice('domain:'.length).trim().toLowerCase().replace(/\.$/, '');
  if (pattern === '*') return MATCH;
  let source: string;
  if (pattern.startsWith('*.')) {
    source = `^(?:[^.]+\\.)+${pattern.slice(2).split('*').map(escapeRegex).join('[^.]*')}$`;
  } else {
    source = `^${pattern.split('*').map(escapeRegex).join('[^.]*')}$`;
  }
  return new RegExp(source).test(host) ? MATCH : NO_MATCH;
}

/* ────────────────────────────── param rules ────────────────────────────── */

/** Fields matched by a tool's own canonicalizing rules -- `Tool(field:...)` on these is ignored
 * by Claude Code with a startup warning (docs "Match by input parameter"). */
const CANONICAL_FIELDS: Record<string, string[]> = {
  Bash: ['command'],
  PowerShell: ['command'],
  Read: ['file_path'],
  Edit: ['file_path'],
  Write: ['file_path'],
  NotebookEdit: ['notebook_path'],
  Grep: ['path'],
  Glob: ['path'],
  WebFetch: ['url'],
};

const PARAM_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/s;

/**
 * `Tool(param:value)` matching (docs, 2026-07-06): deny/ask only; one param per rule; `*`
 * wildcard in the value; an omitted param NEVER matches; compared against the literal input.
 */
export function matchParamRule(
  tool: string,
  specifier: string,
  call: ToolCall,
  list: 'allow' | 'deny' | 'ask',
): MatchOutcome | undefined {
  const parsed = PARAM_RE.exec(specifier);
  if (!parsed) return undefined;
  const [, param, rawValue] = parsed;
  if (tool === 'WebFetch' && param === 'domain') return undefined; // domain: is WebFetch's own grammar
  if ((CANONICAL_FIELDS[tool] ?? []).includes(param)) {
    return {
      kind: 'no-match',
      note: `'${tool}(${param}:...)' targets a canonicalized field -- Claude Code ignores this rule with a warning`,
    };
  }
  if (list === 'allow') {
    return {
      kind: 'unevaluated',
      reason: `param rules are deny/ask-only; allow rule '${tool}(${specifier})' uses the tool's own specifier grammar`,
    };
  }
  const actual = call.input?.[param];
  if (actual === undefined || actual === null) return NO_MATCH; // omitted param never matches
  const actualText = typeof actual === 'string' ? actual : JSON.stringify(actual);
  const value = rawValue.trim();
  if (!value.includes('*')) return value === actualText ? MATCH : NO_MATCH;
  return globToRegex(value).test(actualText) ? MATCH : NO_MATCH;
}

/* ────────────────────────────── the one entry point ────────────────────────────── */

/**
 * Evaluates one rule against one call (or one Bash subcommand -- the caller handles compound
 * splitting because allow/deny combine per-subcommand across the whole rule SET).
 */
export function matchRule(rule: string, call: ToolCall, ctx: RuleContext, list: 'allow' | 'deny' | 'ask'): MatchOutcome {
  const parsed = parseRule(rule);
  if (!parsed) return { kind: 'unevaluated', reason: `unparseable rule: '${rule}'` };

  const nameOutcome = matchToolName(parsed.tool, call.tool, list);
  if (nameOutcome.kind !== 'match') return nameOutcome;

  // Bare tool name or `Tool(*)` matches every use (docs: the two forms are equivalent).
  if (parsed.specifier === undefined || parsed.specifier === '*') return MATCH;

  const specifier = parsed.specifier;

  // Param rules are recognized on any tool before tool-specific grammar, EXCEPT the specifier
  // grammars that themselves contain `:` (WebFetch domain:, handled inside matchParamRule).
  if (call.tool === 'Bash' || call.tool === 'PowerShell') {
    if (call.command === undefined) {
      return { kind: 'unevaluated', reason: 'no command provided for a command rule' };
    }
    // `:*` suffix is command grammar, not a param rule.
    if (!specifier.endsWith(':*')) {
      const param = matchParamRule(call.tool, specifier, call, list);
      if (param) return param;
    }
    return matchCommandPattern(specifier, call.command, call.tool === 'PowerShell') ? MATCH : NO_MATCH;
  }

  if (call.tool === 'WebFetch' && specifier.startsWith('domain:')) {
    if (call.url === undefined) return { kind: 'unevaluated', reason: 'no URL provided for a domain rule' };
    return matchDomainRule(specifier, call.url);
  }

  const param = matchParamRule(call.tool, specifier, call, list);
  if (param) return param;

  if (call.path !== undefined) {
    return matchPathRule(specifier, call.path, ctx);
  }

  // Agent(Explore)-style exact specifiers: match against a conventional identifying input.
  const identity = call.input?.name ?? call.input?.subagent_type ?? call.input?.agent;
  if (typeof identity === 'string') {
    return specifier === identity ? MATCH : NO_MATCH;
  }

  return { kind: 'unevaluated', reason: `no input provided to evaluate specifier '${specifier}'` };
}
