import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_STATE_DIR as LOOKOUT_STATE_DIR, initConfig } from 'scheduler';
import { runInit } from '../commands/init.js';
import { discoverDocFiles } from '../repo.js';
import { readFrontmatter } from '../frontmatter.js';
import { HOOK_MARKER as PRE_COMMIT_HOOK_MARKER } from '../install-hook.js';
import { installSkill, SKILL_MARKER, SKILL_RELATIVE_PATH } from '../install-skill.js';
import {
  AGENT_HOOK_MARKER,
  AGENT_HOOK_MARKER_IN_COMMAND,
  AGENT_HOOK_SCRIPT_RELATIVE_PATH,
  installAgentHook,
} from '../install-agent-hook.js';
import { INDEX_RELATIVE_PATH } from '../index-schema.js';

/**
 * The Deck onboarding wizard's single source of truth (plan `deck-onboarding-wizard.md` §API 2/3):
 * ONE canonical checklist of everything a repo needs to be a first-class ship-framework citizen.
 * `auditRepoSetup` is a PURE READ over this table (no mutation, ever); `applyRepoSetup` composes
 * the existing installers idempotently for the AUTO items; HUMAN items carry the server-generated
 * command the wizard offers to copy or run in a terminal (`POST .../setup/run`) -- client-supplied
 * command strings are never executed.
 */

export type SetupItemState = 'present' | 'missing' | 'partial';
export type SetupItemKind = 'auto' | 'human';

export interface SetupAuditItem {
  id: string;
  label: string;
  state: SetupItemState;
  kind: SetupItemKind;
  detail: string;
  /** HUMAN items only: the exact command to run (display form, shell-quoted where needed). */
  command?: string;
}

export interface SetupApplyResult {
  id: string;
  ok: boolean;
  detail: string;
}

export interface SetupOptions {
  /** Root of the shareWork suite checkout -- where the crew plugin marketplace and the
   * ship-ledger/ship-log dists live. Default: resolved relative to this module (the chartroom
   * package sits at `<suite>/packages/chartroom`). Injectable for tests. */
  suiteRoot?: string;
}

interface SetupContext {
  repoRoot: string;
  suiteRoot: string;
}

interface AuditFinding {
  state: SetupItemState;
  detail: string;
}

interface SetupItemDef {
  id: string;
  label: string;
  kind: SetupItemKind;
  audit: (ctx: SetupContext) => AuditFinding;
  /** AUTO items only. Must be idempotent -- a second run reports ok with a no-change detail. */
  apply?: (ctx: SetupContext) => SetupApplyResult;
  /** HUMAN items only: server-generated argv (never client strings). */
  commandArgv?: (ctx: SetupContext) => string[];
}

/** `<suite>/packages/chartroom/dist/setup/repo-setup.js` -> four levels up is the suite root. */
export function defaultSuiteRoot(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return join(thisDir, '..', '..', '..', '..');
}

// ---------------------------------------------------------------------------
// shared read helpers (audits are pure reads; tolerant of absent/malformed files)
// ---------------------------------------------------------------------------

function readTextIfExists(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** Same tolerant-read discipline as install-agent-hook.ts's `readSettings`: a malformed
 * settings.json is treated as empty rather than crashing the audit. */
function readJsonIfExists(path: string): Record<string, unknown> | undefined {
  const raw = readTextIfExists(path);
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function settingsJsonPath(repoRoot: string): string {
  return join(repoRoot, '.claude', 'settings.json');
}

/** Display form of a server-generated argv: tokens with spaces/quotes get double-quoted -- what
 * the wizard's copy button puts on the clipboard. */
export function formatCommand(argv: string[]): string {
  return argv.map((token) => (/[\s"]/.test(token) ? `"${token.replace(/"/g, '\\"')}"` : token)).join(' ');
}

// ---------------------------------------------------------------------------
// item: chartroom-init
// ---------------------------------------------------------------------------

function auditChartroomInit(ctx: SetupContext): AuditFinding {
  const indexExists = existsSync(join(ctx.repoRoot, INDEX_RELATIVE_PATH));
  const hookRaw = readTextIfExists(join(ctx.repoRoot, '.git', 'hooks', 'pre-commit'));
  const hookInstalled = hookRaw !== undefined && hookRaw.includes(PRE_COMMIT_HOOK_MARKER);

  let docsMissingIds = 0;
  let docCount = 0;
  for (const relPath of discoverDocFiles(ctx.repoRoot)) {
    docCount += 1;
    try {
      const raw = readFileSync(join(ctx.repoRoot, relPath), 'utf8');
      const id = readFrontmatter(raw).data.id;
      if (!(typeof id === 'string' && id.trim().length > 0)) docsMissingIds += 1;
    } catch {
      docsMissingIds += 1;
    }
  }

  const parts = [
    indexExists ? `${INDEX_RELATIVE_PATH} present` : `${INDEX_RELATIVE_PATH} missing`,
    docsMissingIds === 0 ? `all ${docCount} doc(s) carry ids` : `${docsMissingIds} of ${docCount} doc(s) missing ids`,
    hookInstalled ? 'pre-commit hook installed' : 'pre-commit hook not installed',
  ];
  const detail = parts.join('; ');

  if (indexExists && docsMissingIds === 0 && hookInstalled) return { state: 'present', detail };
  if (!indexExists && !hookInstalled) return { state: 'missing', detail };
  return { state: 'partial', detail };
}

function applyChartroomInit(ctx: SetupContext): SetupApplyResult {
  const summary = runInit(ctx.repoRoot, true);
  const detail =
    `assigned ${summary.assignedIds} id(s), indexed ${summary.indexedDocs} doc(s), ` +
    `hook ${summary.hookStatus}`;
  if (summary.hookStatus === 'refused') {
    // The installer's refusal discipline: a foreign pre-commit hook is never clobbered. Ids and
    // index WERE written; the hook needs manual chaining (chartroom README).
    return {
      id: 'chartroom-init',
      ok: false,
      detail: `${detail} -- an existing non-chartroom pre-commit hook at ${summary.refusedHookPath} was left untouched; chain it manually`,
    };
  }
  return { id: 'chartroom-init', ok: true, detail };
}

// ---------------------------------------------------------------------------
// item: chartroom-skill
// ---------------------------------------------------------------------------

function auditChartroomSkill(ctx: SetupContext): AuditFinding {
  const raw = readTextIfExists(join(ctx.repoRoot, SKILL_RELATIVE_PATH));
  if (raw === undefined) return { state: 'missing', detail: `${SKILL_RELATIVE_PATH} not installed` };
  if (raw.includes(SKILL_MARKER)) return { state: 'present', detail: `${SKILL_RELATIVE_PATH} installed` };
  return {
    state: 'partial',
    detail: `a differently-authored file occupies ${SKILL_RELATIVE_PATH} -- apply will refuse to clobber it`,
  };
}

function applyChartroomSkill(ctx: SetupContext): SetupApplyResult {
  const result = installSkill(ctx.repoRoot);
  if (result.status === 'refused') {
    return {
      id: 'chartroom-skill',
      ok: false,
      detail: `refused: a differently-authored file already exists at ${result.skillPath}`,
    };
  }
  return {
    id: 'chartroom-skill',
    ok: true,
    detail: result.status === 'already-present' ? 'already installed (template refreshed)' : 'skill installed',
  };
}

// ---------------------------------------------------------------------------
// item: agent-hook
// ---------------------------------------------------------------------------

function agentHookSettingsEntryPresent(repoRoot: string): boolean {
  const settings = readJsonIfExists(settingsJsonPath(repoRoot));
  const hooks = settings?.hooks;
  if (!hooks || typeof hooks !== 'object') return false;
  const entries = (hooks as Record<string, unknown>).PostToolUseFailure;
  if (!Array.isArray(entries)) return false;
  return entries.some((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return false;
    const hookList = (entry as { hooks?: unknown }).hooks;
    return (
      Array.isArray(hookList) &&
      hookList.some(
        (h: unknown) =>
          !!h &&
          typeof h === 'object' &&
          typeof (h as { command?: unknown }).command === 'string' &&
          ((h as { command: string }).command.includes(AGENT_HOOK_MARKER_IN_COMMAND)),
      )
    );
  });
}

function auditAgentHook(ctx: SetupContext): AuditFinding {
  const raw = readTextIfExists(join(ctx.repoRoot, AGENT_HOOK_SCRIPT_RELATIVE_PATH));
  const scriptOurs = raw !== undefined && raw.includes(AGENT_HOOK_MARKER);
  const scriptForeign = raw !== undefined && !raw.includes(AGENT_HOOK_MARKER);
  const entryPresent = agentHookSettingsEntryPresent(ctx.repoRoot);

  if (scriptForeign) {
    return {
      state: 'partial',
      detail: `a differently-authored file occupies ${AGENT_HOOK_SCRIPT_RELATIVE_PATH} -- apply will refuse to clobber it`,
    };
  }
  const detail = [
    scriptOurs ? 'hook script installed' : 'hook script missing',
    entryPresent ? 'settings.json entry present' : 'settings.json entry missing',
  ].join('; ');
  if (scriptOurs && entryPresent) return { state: 'present', detail };
  if (!scriptOurs && !entryPresent) return { state: 'missing', detail };
  return { state: 'partial', detail };
}

function applyAgentHook(ctx: SetupContext): SetupApplyResult {
  const result = installAgentHook(ctx.repoRoot);
  if (result.status === 'refused') {
    return {
      id: 'agent-hook',
      ok: false,
      detail: `refused: a differently-authored file already exists at ${result.scriptPath}`,
    };
  }
  return {
    id: 'agent-hook',
    ok: true,
    detail:
      result.status === 'already-present'
        ? 'already installed (script refreshed, settings merged)'
        : 'hook script + settings.json entry installed',
  };
}

// ---------------------------------------------------------------------------
// item: chartroomignore
// ---------------------------------------------------------------------------

/** Minimal commented default. `.chartroomignore` scopes DOC DISCOVERY only (repo.ts
 * loadIgnoreRules) -- it never makes git ignore anything. No template ships in the package for
 * this today (checked), so the default lives here. */
export const CHARTROOMIGNORE_TEMPLATE = `# .chartroomignore -- paths Chart Room must NOT manage as docs (gitignore syntax).
# Chart Room also honors this repo's top-level .gitignore, so anything git already
# ignores needs no entry here. Typical additions:
node_modules/
dist/
# Chart Room's own index -- never a managed doc.
.docs/
`;

function auditChartroomignore(ctx: SetupContext): AuditFinding {
  return existsSync(join(ctx.repoRoot, '.chartroomignore'))
    ? { state: 'present', detail: '.chartroomignore present' }
    : { state: 'missing', detail: 'no .chartroomignore -- doc discovery is scoped by .gitignore only' };
}

function applyChartroomignore(ctx: SetupContext): SetupApplyResult {
  const path = join(ctx.repoRoot, '.chartroomignore');
  if (existsSync(path)) {
    // Never overwrite: the user's own scoping rules are exactly what this file is for.
    return { id: 'chartroomignore', ok: true, detail: 'already present -- left untouched' };
  }
  writeFileSync(path, CHARTROOMIGNORE_TEMPLATE, 'utf8');
  return { id: 'chartroomignore', ok: true, detail: 'default .chartroomignore written' };
}

// ---------------------------------------------------------------------------
// item: claude-md-section
// ---------------------------------------------------------------------------

/** Marker comment so the audit detects OUR appended section without false-negativing on a
 * hand-written one (any "Chart Room" heading also counts as present -- never duplicate). */
export const CLAUDE_MD_MARKER = '<!-- chartroom:managed-claude-md-section -->';
const CHART_ROOM_HEADING_RE = /^#{1,6}\s+.*Chart Room/im;

/** Modeled on the shareWork root CLAUDE.md's own "Chart Room" section. */
export const CLAUDE_MD_SECTION = `${CLAUDE_MD_MARKER}
## Chart Room (managed markdown docs)

This repo's markdown docs are managed by Chart Room. Doc links carry a hidden \`id:\` (see the
link's title attribute, \`"id:<id>"\`) that survives moves/renames -- if a linked path 404s, don't
ask the human where it went: read \`.docs/index.json\` directly, or run
\`chartroom resolve <id-or-path>\`. See the \`chart-room\` skill for the full workflow (id-based
links, \`:::llm\`/\`:::human\` blocks, \`:::ask-me\` questions).
`;

function claudeMdHasSection(raw: string): boolean {
  return raw.includes(CLAUDE_MD_MARKER) || CHART_ROOM_HEADING_RE.test(raw);
}

function auditClaudeMdSection(ctx: SetupContext): AuditFinding {
  const raw = readTextIfExists(join(ctx.repoRoot, 'CLAUDE.md'));
  if (raw === undefined) return { state: 'missing', detail: 'no CLAUDE.md' };
  return claudeMdHasSection(raw)
    ? { state: 'present', detail: 'CLAUDE.md carries a Chart Room section' }
    : { state: 'missing', detail: 'CLAUDE.md exists but has no Chart Room section' };
}

function applyClaudeMdSection(ctx: SetupContext): SetupApplyResult {
  const path = join(ctx.repoRoot, 'CLAUDE.md');
  const raw = readTextIfExists(path);
  if (raw !== undefined && claudeMdHasSection(raw)) {
    return { id: 'claude-md-section', ok: true, detail: 'Chart Room section already present -- left untouched' };
  }
  if (raw === undefined) {
    writeFileSync(path, `# CLAUDE.md\n\n${CLAUDE_MD_SECTION}`, 'utf8');
    return { id: 'claude-md-section', ok: true, detail: 'CLAUDE.md created with the Chart Room section' };
  }
  const separator = raw.endsWith('\n\n') ? '' : raw.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(path, raw + separator + CLAUDE_MD_SECTION, 'utf8');
  return { id: 'claude-md-section', ok: true, detail: 'Chart Room section appended to CLAUDE.md' };
}

// ---------------------------------------------------------------------------
// item: gitignore-entries
// ---------------------------------------------------------------------------

/** `.ship/` (Lookout state), `.docs/` (Chart Room index), `.ship-crew/` (crew stop-gate state,
 * plugins/crew/README.md's own instruction). */
export const GITIGNORE_ENTRIES = ['.ship/', '.docs/', '.ship-crew/'];

function missingGitignoreEntries(repoRoot: string): string[] {
  const raw = readTextIfExists(join(repoRoot, '.gitignore'));
  if (raw === undefined) return [...GITIGNORE_ENTRIES];
  const lines = new Set(raw.split(/\r?\n/).map((line) => line.trim()));
  return GITIGNORE_ENTRIES.filter((entry) => !lines.has(entry));
}

function auditGitignoreEntries(ctx: SetupContext): AuditFinding {
  const missing = missingGitignoreEntries(ctx.repoRoot);
  if (missing.length === 0) return { state: 'present', detail: `.gitignore covers ${GITIGNORE_ENTRIES.join(', ')}` };
  const detail = `missing from .gitignore: ${missing.join(', ')}`;
  return missing.length === GITIGNORE_ENTRIES.length ? { state: 'missing', detail } : { state: 'partial', detail };
}

function applyGitignoreEntries(ctx: SetupContext): SetupApplyResult {
  const missing = missingGitignoreEntries(ctx.repoRoot);
  if (missing.length === 0) {
    return { id: 'gitignore-entries', ok: true, detail: 'all entries already present -- no change' };
  }
  const path = join(ctx.repoRoot, '.gitignore');
  const raw = readTextIfExists(path);
  const block = `# ship framework state (Deck setup wizard)\n${missing.join('\n')}\n`;
  if (raw === undefined) {
    writeFileSync(path, block, 'utf8');
  } else {
    const separator = raw.length === 0 || raw.endsWith('\n') ? '' : '\n';
    writeFileSync(path, raw + separator + block, 'utf8');
  }
  return { id: 'gitignore-entries', ok: true, detail: `appended: ${missing.join(', ')}` };
}

// ---------------------------------------------------------------------------
// item: ship-scrutiny
// ---------------------------------------------------------------------------

function readScrutiny(repoRoot: string): string | undefined {
  const settings = readJsonIfExists(settingsJsonPath(repoRoot));
  const ship = settings?.ship;
  if (!ship || typeof ship !== 'object') return undefined;
  const scrutiny = (ship as { scrutiny?: unknown }).scrutiny;
  return typeof scrutiny === 'string' && scrutiny.trim().length > 0 ? scrutiny : undefined;
}

function auditShipScrutiny(ctx: SetupContext): AuditFinding {
  const scrutiny = readScrutiny(ctx.repoRoot);
  return scrutiny !== undefined
    ? { state: 'present', detail: `ship.scrutiny = "${scrutiny}"` }
    : { state: 'missing', detail: 'no ship.scrutiny in .claude/settings.json' };
}

/** mergeSettingsJson discipline (install-agent-hook.ts): read-tolerant, write back the WHOLE
 * object with only our key merged in -- other keys (hooks, enabledPlugins, permissions, ...) are
 * never clobbered. An existing scrutiny value is respected, not overwritten. */
function applyShipScrutiny(ctx: SetupContext): SetupApplyResult {
  const existing = readScrutiny(ctx.repoRoot);
  if (existing !== undefined) {
    return { id: 'ship-scrutiny', ok: true, detail: `ship.scrutiny already "${existing}" -- left untouched` };
  }
  const path = settingsJsonPath(ctx.repoRoot);
  const settings = readJsonIfExists(path) ?? {};
  const ship = settings.ship && typeof settings.ship === 'object' ? (settings.ship as Record<string, unknown>) : {};
  settings.ship = { ...ship, scrutiny: 'standard' };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return { id: 'ship-scrutiny', ok: true, detail: 'ship.scrutiny = "standard" written to .claude/settings.json' };
}

// ---------------------------------------------------------------------------
// item: lookout-init
// ---------------------------------------------------------------------------

function auditLookoutInit(ctx: SetupContext): AuditFinding {
  return existsSync(join(ctx.repoRoot, LOOKOUT_STATE_DIR, 'config.json'))
    ? { state: 'present', detail: `${LOOKOUT_STATE_DIR}/config.json present` }
    : { state: 'missing', detail: `no ${LOOKOUT_STATE_DIR}/config.json` };
}

function applyLookoutInit(ctx: SetupContext): SetupApplyResult {
  // scheduler's initConfig is itself idempotent: an existing config keeps its sessionId, an
  // existing resume prompt is never overwritten (Captain-approved workspace dep).
  const result = initConfig(join(ctx.repoRoot, LOOKOUT_STATE_DIR), { cwd: ctx.repoRoot });
  return {
    id: 'lookout-init',
    ok: true,
    detail: result.configCreated
      ? `lookout state initialized (launch: ${result.launchCommand})`
      : `lookout state already initialized (session ${result.config.sessionId}) -- left untouched`,
  };
}

// ---------------------------------------------------------------------------
// human items (commands per plugins/crew/README.md "Install" + "Quartermaster MCP registration")
// ---------------------------------------------------------------------------

function pluginInstalled(repoRoot: string): boolean {
  const settings = readJsonIfExists(settingsJsonPath(repoRoot));
  const enabled = settings?.enabledPlugins;
  if (!enabled || typeof enabled !== 'object') return false;
  return Object.entries(enabled as Record<string, unknown>).some(
    ([key, value]) => (key === 'ship-crew' || key.startsWith('ship-crew@')) && value === true,
  );
}

function mcpServerRegistered(repoRoot: string, serverName: string): boolean {
  const mcp = readJsonIfExists(join(repoRoot, '.mcp.json'));
  const servers = mcp?.mcpServers;
  return !!servers && typeof servers === 'object' && serverName in (servers as Record<string, unknown>);
}

function auditPluginMarketplaceAdd(ctx: SetupContext): AuditFinding {
  // Marketplace registration is per-user Claude config, not repo state -- the only honest
  // repo-local signal is its consequence: the installed plugin.
  return pluginInstalled(ctx.repoRoot)
    ? { state: 'present', detail: 'inferred from the installed ship-crew plugin' }
    : {
        state: 'missing',
        detail: 'not verifiable from repo files -- run `claude plugin marketplace list` to check',
      };
}

function auditPluginInstall(ctx: SetupContext): AuditFinding {
  return pluginInstalled(ctx.repoRoot)
    ? { state: 'present', detail: 'enabledPlugins lists ship-crew in .claude/settings.json' }
    : { state: 'missing', detail: 'no ship-crew entry in .claude/settings.json enabledPlugins' };
}

function auditMcpServer(serverName: string): (ctx: SetupContext) => AuditFinding {
  return (ctx) =>
    mcpServerRegistered(ctx.repoRoot, serverName)
      ? { state: 'present', detail: `${serverName} registered in .mcp.json (project scope)` }
      : {
          state: 'missing',
          detail: `no project-scope .mcp.json entry for ${serverName}; user/local-scope registrations are not visible from the repo -- verify with \`claude mcp list\``,
        };
}

// ---------------------------------------------------------------------------
// the canonical item table
// ---------------------------------------------------------------------------

const SETUP_ITEMS: SetupItemDef[] = [
  {
    id: 'chartroom-init',
    label: 'Chart Room init (doc ids, index, pre-commit hook)',
    kind: 'auto',
    audit: auditChartroomInit,
    apply: applyChartroomInit,
  },
  {
    id: 'chartroom-skill',
    label: 'chart-room skill (.claude/skills)',
    kind: 'auto',
    audit: auditChartroomSkill,
    apply: applyChartroomSkill,
  },
  {
    id: 'agent-hook',
    label: 'Chart Room agent hook (PostToolUseFailure + settings merge)',
    kind: 'auto',
    audit: auditAgentHook,
    apply: applyAgentHook,
  },
  {
    id: 'chartroomignore',
    label: '.chartroomignore (doc-discovery scope)',
    kind: 'auto',
    audit: auditChartroomignore,
    apply: applyChartroomignore,
  },
  {
    id: 'claude-md-section',
    label: 'CLAUDE.md Chart Room section',
    kind: 'auto',
    audit: auditClaudeMdSection,
    apply: applyClaudeMdSection,
  },
  {
    id: 'gitignore-entries',
    label: '.gitignore entries (.ship/, .docs/, .ship-crew/)',
    kind: 'auto',
    audit: auditGitignoreEntries,
    apply: applyGitignoreEntries,
  },
  {
    id: 'ship-scrutiny',
    label: 'Ship scrutiny preset (.claude/settings.json)',
    kind: 'auto',
    audit: auditShipScrutiny,
    apply: applyShipScrutiny,
  },
  {
    id: 'lookout-init',
    label: 'Lookout state (.ship/lookout)',
    kind: 'auto',
    audit: auditLookoutInit,
    apply: applyLookoutInit,
  },
  {
    id: 'plugin-marketplace-add',
    label: 'Claude plugin marketplace (shareWork suite)',
    kind: 'human',
    audit: auditPluginMarketplaceAdd,
    commandArgv: (ctx) => ['claude', 'plugin', 'marketplace', 'add', ctx.suiteRoot],
  },
  {
    id: 'plugin-install',
    label: 'ship-crew plugin (project scope)',
    kind: 'human',
    audit: auditPluginInstall,
    commandArgv: () => ['claude', 'plugin', 'install', 'ship-crew', '--scope', 'project'],
  },
  {
    id: 'mcp-ship-ledger',
    label: 'ship-ledger MCP server',
    kind: 'human',
    audit: auditMcpServer('ship-ledger'),
    commandArgv: (ctx) => [
      'claude',
      'mcp',
      'add',
      'ship-ledger',
      '--',
      'node',
      join(ctx.suiteRoot, 'packages', 'ship-ledger', 'dist', 'cli.js'),
      'mcp',
    ],
  },
  {
    id: 'mcp-ship-log',
    label: 'ship-log MCP server',
    kind: 'human',
    audit: auditMcpServer('ship-log'),
    commandArgv: (ctx) => [
      'claude',
      'mcp',
      'add',
      'ship-log',
      '--',
      'node',
      join(ctx.suiteRoot, 'packages', 'ship-log', 'dist', 'cli.js'),
      'mcp',
    ],
  },
];

const ITEMS_BY_ID = new Map(SETUP_ITEMS.map((item) => [item.id, item]));

export const SETUP_ITEM_IDS = SETUP_ITEMS.map((item) => item.id);
export const AUTO_ITEM_IDS = SETUP_ITEMS.filter((item) => item.kind === 'auto').map((item) => item.id);
export const HUMAN_ITEM_IDS = SETUP_ITEMS.filter((item) => item.kind === 'human').map((item) => item.id);

function contextFor(repoRoot: string, options: SetupOptions): SetupContext {
  return { repoRoot, suiteRoot: options.suiteRoot ?? defaultSuiteRoot() };
}

/** Pure read: the full checklist with per-item state. Never mutates the repo. */
export function auditRepoSetup(repoRoot: string, options: SetupOptions = {}): SetupAuditItem[] {
  const ctx = contextFor(repoRoot, options);
  return SETUP_ITEMS.map((item) => {
    let finding: AuditFinding;
    try {
      finding = item.audit(ctx);
    } catch (err) {
      // An audit must never take the whole checklist down -- report the one item honestly.
      finding = { state: 'missing', detail: `audit failed: ${(err as Error).message}` };
    }
    const result: SetupAuditItem = { id: item.id, label: item.label, kind: item.kind, ...finding };
    if (item.kind === 'human' && item.commandArgv) {
      result.command = formatCommand(item.commandArgv(ctx));
    }
    return result;
  });
}

/**
 * Applies the selected AUTO items, each idempotently, each wrapped so one failure never aborts
 * the rest. Throws (-> route 400) on unknown or human ids BEFORE anything is applied -- a bad
 * request must not half-run.
 */
export function applyRepoSetup(repoRoot: string, itemIds: string[], options: SetupOptions = {}): SetupApplyResult[] {
  for (const id of itemIds) {
    const item = ITEMS_BY_ID.get(id);
    if (!item) throw new Error(`unknown setup item '${id}'`);
    if (item.kind !== 'auto') {
      throw new Error(`'${id}' is a human step -- run its command instead (POST .../setup/run)`);
    }
  }
  const ctx = contextFor(repoRoot, options);

  // Execution order: chartroom-init LAST. It assigns ids to and indexes every doc, and other
  // items in the same batch may CREATE docs (claude-md-section writes CLAUDE.md) -- running init
  // after them makes one apply pass convergent, so the second run is a true no-op.
  const ordered = [...itemIds].sort((a, b) => Number(a === 'chartroom-init') - Number(b === 'chartroom-init'));

  const byId = new Map<string, SetupApplyResult>();
  for (const id of ordered) {
    const item = ITEMS_BY_ID.get(id) as SetupItemDef;
    try {
      byId.set(id, (item.apply as (c: SetupContext) => SetupApplyResult)(ctx));
    } catch (err) {
      byId.set(id, { id, ok: false, detail: `apply failed: ${(err as Error).message}` });
    }
  }
  // Results come back in the REQUESTED order regardless of execution order.
  return itemIds.map((id) => byId.get(id) as SetupApplyResult);
}

export interface HumanItemCommand {
  argv: string[];
  display: string;
}

/** Server-generated command for a HUMAN item (`POST .../setup/run` -- never client strings).
 * Returns undefined for unknown or auto ids (the route answers 400). */
export function humanItemCommand(
  repoRoot: string,
  itemId: string,
  options: SetupOptions = {},
): HumanItemCommand | undefined {
  const item = ITEMS_BY_ID.get(itemId);
  if (!item || item.kind !== 'human' || !item.commandArgv) return undefined;
  const argv = item.commandArgv(contextFor(repoRoot, options));
  return { argv, display: formatCommand(argv) };
}
