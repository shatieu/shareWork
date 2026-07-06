import { PERMISSION_MODES, type KeyKind } from './schema.js';

/**
 * The add-modal's searchable catalog (plan 14): every ADDABLE known top-level settings key
 * with type, one-line description (same provenance as schema.ts -- the docs settings table
 * fetched 2026-07-06), enum values where the documented value set is closed, and a sensible
 * prefill. Excluded on purpose: `$schema` (tooling boilerplate) and `permissions` (the object
 * -- its surface is covered by RULE_TEMPLATES + the `permissions.defaultMode` entry).
 * A test pins every entry's key+kind to schema.ts's KNOWN_TOP_LEVEL so the catalog can never
 * drift from the validator.
 */

export interface CatalogEntry {
  key: string;
  kind: KeyKind;
  description: string;
  /** Present when the documented value set is closed -- the UI renders a select. */
  enumValues?: readonly string[];
  /** Prefill for the value input. */
  defaultValue: unknown;
  /** Managed-settings-only keys are shown but flagged (they no-op outside managed scope). */
  managedOnly?: boolean;
}

export interface RuleTemplate {
  id: string;
  label: string;
  /** Editable prefill -- the human replaces the placeholder segment. */
  rule: string;
  defaultList: 'allow' | 'deny' | 'ask';
  description: string;
}

const entry = (
  key: string,
  kind: KeyKind,
  description: string,
  defaultValue: unknown,
  extra: Partial<Pick<CatalogEntry, 'enumValues' | 'managedOnly'>> = {},
): CatalogEntry => ({ key, kind, description, defaultValue, ...extra });

export const SETTINGS_CATALOG: readonly CatalogEntry[] = [
  entry('advisorModel', 'string', 'Model for the server-side advisor tool.', 'opus'),
  entry('agent', 'string', 'Run the main thread as a named subagent.', ''),
  entry('agentPushNotifEnabled', 'boolean', 'Push notifications when background tasks finish.', true),
  entry('allowAllClaudeAiMcps', 'boolean', 'Load claude.ai connectors alongside managed MCPs.', true, { managedOnly: true }),
  entry('allowedChannelPlugins', 'array', 'Allowlist of channel plugins that may push messages.', [], { managedOnly: true }),
  entry('allowedHttpHookUrls', 'string-array', 'Allowlist of URLs HTTP hooks may call.', []),
  entry('allowedMcpServers', 'array', 'Allowlist of MCP servers.', [], { managedOnly: true }),
  entry('allowManagedHooksOnly', 'boolean', 'Only managed/SDK/force-enabled-plugin hooks load.', true, { managedOnly: true }),
  entry('allowManagedMcpServersOnly', 'boolean', 'Only the managed MCP allowlist is respected.', true, { managedOnly: true }),
  entry('allowManagedPermissionRulesOnly', 'boolean', 'Only managed permission rules apply.', true, { managedOnly: true }),
  entry('alwaysThinkingEnabled', 'boolean', 'Enable extended thinking by default.', true),
  entry('apiKeyHelper', 'string', 'Shell command that returns an auth value.', ''),
  entry('askUserQuestionTimeout', 'string', 'Auto-continue timeout for question dialogs (e.g. "5m").', '5m'),
  entry('attribution', 'object', 'Customize git commit / PR attribution lines.', {}),
  entry('autoCompactEnabled', 'boolean', 'Auto-compact when context approaches the limit.', true),
  entry('autoMemoryDirectory', 'string', 'Custom directory for auto memory.', ''),
  entry('autoMemoryEnabled', 'boolean', 'Enable auto memory.', true),
  entry('autoMode', 'object', 'Customize the auto-mode classifier rules.', {}),
  entry('autoScrollEnabled', 'boolean', 'Follow new output in fullscreen rendering.', true),
  entry('autoUpdatesChannel', 'string', 'Release channel for auto-updates.', 'stable', { enumValues: ['latest', 'stable'] }),
  entry('availableModels', 'string-array', 'Restrict which models are selectable.', []),
  entry('awaySummaryEnabled', 'boolean', 'Show a recap when returning after a few minutes.', true),
  entry('awsAuthRefresh', 'string', 'Script refreshing the .aws directory credentials.', ''),
  entry('awsCredentialExport', 'string', 'Script outputting AWS credentials JSON.', ''),
  entry('axScreenReader', 'boolean', 'Render screen-reader friendly output.', true),
  entry('blockedMarketplaces', 'array', 'Blocklist of plugin-marketplace sources.', [], { managedOnly: true }),
  entry('channelsEnabled', 'boolean', 'Allow channels for the organization.', true, { managedOnly: true }),
  entry('claudeMd', 'string', 'Organization-wide CLAUDE.md content.', '', { managedOnly: true }),
  entry('claudeMdExcludes', 'string-array', 'Glob patterns of CLAUDE.md files to skip.', []),
  entry('cleanupPeriodDays', 'number', 'Session file retention period in days (default 30).', 30),
  entry('companyAnnouncements', 'string-array', 'Announcements displayed at startup.', []),
  entry('defaultShell', 'string', 'Default shell for ! commands.', 'bash', { enumValues: ['bash', 'powershell'] }),
  entry('deniedMcpServers', 'array', 'Denylist of MCP servers.', [], { managedOnly: true }),
  entry('disableAgentView', 'boolean', 'Disable background agents and the agent view.', true),
  entry('disableAllHooks', 'boolean', 'Disable all hooks and the custom status line.', true),
  entry('disableArtifact', 'boolean', 'Disable the Artifact tool.', true),
  entry('disableAutoMode', 'string-or-boolean', 'Prevent auto mode from activating.', 'disable'),
  entry('disableBundledSkills', 'boolean', 'Disable bundled skills and workflows.', true),
  entry('disableClaudeAiConnectors', 'boolean', 'Disable claude.ai MCP connectors.', true),
  entry('disableDeepLinkRegistration', 'string-or-boolean', 'Prevent claude-cli:// protocol registration.', 'disable'),
  entry('disabledMcpjsonServers', 'string-array', 'Reject specific MCP servers from .mcp.json.', []),
  entry('disableRemoteControl', 'boolean', 'Disable Remote Control on this device.', true),
  entry('disableSideloadFlags', 'boolean', 'Reject --plugin-dir / --mcp-config CLI flags at startup.', true, { managedOnly: true }),
  entry('disableSkillShellExecution', 'boolean', 'Disable inline shell execution in skills.', true),
  entry('disableWorkflows', 'boolean', 'Disable dynamic workflows.', true),
  entry('editorMode', 'string', 'Key-binding mode.', 'normal', { enumValues: ['normal', 'vim'] }),
  entry('effortLevel', 'string', 'Persisted effort level.', 'high', { enumValues: ['low', 'medium', 'high', 'xhigh'] }),
  entry('enableAllProjectMcpServers', 'boolean', 'Auto-approve all project .mcp.json servers.', true),
  entry('enableArtifact', 'boolean', 'Enable the Artifact tool for this user.', true),
  entry('enabledMcpjsonServers', 'string-array', 'Approve specific MCP servers from .mcp.json.', []),
  entry('enforceAvailableModels', 'boolean', 'Extend the model allowlist to the Default model.', true),
  entry('env', 'object', 'Environment variables applied to every session.', {}),
  entry('fallbackModel', 'any', 'Fallback model chain when the primary is overloaded.', []),
  entry('fastModePerSessionOptIn', 'boolean', 'Require per-session fast-mode opt-in.', true),
  entry('feedbackSurveyRate', 'number', 'Survey appearance probability (0-1).', 0.05),
  entry('fileCheckpointingEnabled', 'boolean', 'Snapshot files before edits for /rewind.', true),
  entry('fileSuggestion', 'object', 'Custom script for @ file autocomplete.', {}),
  entry('footerLinksRegexes', 'array', 'Render clickable badges in the footer.', []),
  entry('forceLoginMethod', 'string', 'Restrict how users may log in.', 'claudeai', { enumValues: ['claudeai', 'console', 'gateway'] }),
  entry('forceLoginGatewayUrl', 'string', 'Pre-fill the gateway URL.', '', { managedOnly: true }),
  entry('forceLoginOrgUUID', 'any', 'Require a specific org UUID (or list).', ''),
  entry('forceRemoteSettingsRefresh', 'boolean', 'Block startup until remote managed settings are fetched.', true, { managedOnly: true }),
  entry('gcpAuthRefresh', 'string', 'Script refreshing GCP credentials.', ''),
  entry('hooks', 'object', 'Custom lifecycle event commands.', {}),
  entry('httpHookAllowedEnvVars', 'string-array', 'Env vars HTTP hooks may read.', []),
  entry('includeGitInstructions', 'boolean', 'Include the built-in git workflow instructions.', true),
  entry('inputNeededNotifEnabled', 'boolean', 'Push notification when input is needed.', true),
  entry('language', 'string', 'Preferred response language.', ''),
  entry('minimumVersion', 'string', 'Floor version for auto-updates.', ''),
  entry('model', 'string', 'Default model for Claude Code.', 'claude-sonnet-5'),
  entry('modelOverrides', 'object', 'Map Anthropic model IDs to provider IDs.', {}),
  entry('otelHeadersHelper', 'string', 'Script for dynamic OpenTelemetry headers.', ''),
  entry('outputStyle', 'string', 'Output style adjusting the system prompt.', ''),
  entry('parentSettingsBehavior', 'string', 'Merge vs first-wins for SDK-embedded settings.', 'merge', {
    enumValues: ['merge', 'first-wins'],
    managedOnly: true,
  }),
  entry('plansDirectory', 'string', 'Custom directory for plan files.', './plans'),
  entry('pluginSuggestionMarketplaces', 'string-array', 'Marketplaces used for install suggestions.', [], { managedOnly: true }),
  entry('pluginTrustMessage', 'string', 'Custom message on the plugin trust warning.', '', { managedOnly: true }),
  entry('policyHelper', 'object', 'Admin executable for dynamic managed settings.', {}, { managedOnly: true }),
  entry('preferredNotifChannel', 'string', 'Notification method.', 'terminal_bell'),
  entry('prefersReducedMotion', 'boolean', 'Reduce UI animations (accessibility).', true),
  entry('prUrlTemplate', 'string', 'URL template for PR badges.', ''),
  entry('sandbox', 'object', 'OS-level sandbox configuration for Bash.', {}),
  entry('statusLine', 'object', 'Custom status line configuration.', {}),
  entry('strictKnownMarketplaces', 'any', 'Restrict which marketplace sources users can add.', [], { managedOnly: true }),
  entry('strictPluginOnlyCustomization', 'any', 'Block skills/agents/hooks/MCP from non-plugin sources.', true, { managedOnly: true }),
  entry('wslInheritsWindowsSettings', 'boolean', 'WSL also reads the Windows managed policy chain.', true, { managedOnly: true }),
  // The one nested entry: closed documented value set, scalar-override semantics (plan 14).
  entry('permissions.defaultMode', 'string', 'Default permission mode when no rule matches.', 'default', {
    enumValues: PERMISSION_MODES,
  }),
];

export const RULE_TEMPLATES: readonly RuleTemplate[] = [
  {
    id: 'bash-prefix',
    label: 'Bash command prefix',
    rule: 'Bash(npm run *)',
    defaultList: 'allow',
    description: 'Shell commands starting with a prefix (trailing " *" enforces a word boundary).',
  },
  {
    id: 'bash-exact',
    label: 'Bash exact command',
    rule: 'Bash(npm run build)',
    defaultList: 'allow',
    description: 'One exact shell command, nothing else.',
  },
  {
    id: 'read-path',
    label: 'Read a path',
    rule: 'Read(./.env)',
    defaultList: 'deny',
    description: 'File reads matching a gitignore-style pattern (//=root, ~/=home, /=settings dir).',
  },
  {
    id: 'edit-path',
    label: 'Edit a path',
    rule: 'Edit(/src/**)',
    defaultList: 'allow',
    description: 'File edits matching a gitignore-style pattern.',
  },
  {
    id: 'webfetch-domain',
    label: 'WebFetch domain',
    rule: 'WebFetch(domain:example.com)',
    defaultList: 'allow',
    description: 'Web fetches to a hostname (*.example.com matches subdomains, not the apex).',
  },
  {
    id: 'mcp-server',
    label: 'MCP server (all tools)',
    rule: 'mcp__server',
    defaultList: 'allow',
    description: 'Every tool from one configured MCP server.',
  },
  {
    id: 'mcp-tool',
    label: 'MCP single tool',
    rule: 'mcp__server__tool',
    defaultList: 'allow',
    description: 'One specific tool from one MCP server.',
  },
  {
    id: 'bare-tool',
    label: 'Whole tool',
    rule: 'WebSearch',
    defaultList: 'deny',
    description: 'Every use of a tool; as a deny rule it removes the tool from context entirely.',
  },
];

export interface Catalog {
  settings: readonly CatalogEntry[];
  ruleTemplates: readonly RuleTemplate[];
  modes: readonly string[];
}

export function getCatalog(): Catalog {
  return { settings: SETTINGS_CATALOG, ruleTemplates: RULE_TEMPLATES, modes: PERMISSION_MODES };
}
