/**
 * Structural settings validation (plan 07 §3; the validate-before-write rail's brain).
 *
 * Trio_Specs §B demands validation "against the installed CC version (live-generated)". No
 * supported extraction mechanism exists for that today (parked in DECISIONS-NEEDED), so v1 ships
 * a structural validator typed from the current docs' settings table behind a provider seam --
 * a future live-generated schema drops in without touching the rails.
 *
 * Philosophy mirrors Claude Code's own tolerant parsing: UNKNOWN keys are warnings, never
 * blockers (CC ignores them); known keys with the WRONG SHAPE are errors (they'd change live
 * behavior unpredictably or mask typos like a string where an array belongs).
 */

export interface SchemaIssue {
  /** JSON-pointer-ish path, e.g. `permissions.allow[3]`. */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  /** Shape violations on known keys -- these BLOCK a write. */
  errors: SchemaIssue[];
  /** Unknown keys / advisory findings -- surfaced in the diff preview, never blocking. */
  warnings: SchemaIssue[];
}

export interface SchemaProvider {
  /** Human-readable provenance shown in the UI (e.g. "structural v1 (docs 2026-07-06)"). */
  readonly source: string;
  validate(document: Record<string, unknown>): ValidationResult;
}

export type KeyKind = 'string' | 'boolean' | 'number' | 'object' | 'string-array' | 'array' | 'string-or-boolean' | 'any';

/** Known top-level settings keys → expected shape (docs settings table, fetched 2026-07-06).
 * `any` = documented key whose value grammar is CC-owned and too volatile to pin.
 * Exported for catalog.ts (the add-modal's search source) -- a test pins the two in sync. */
export const KNOWN_TOP_LEVEL: Record<string, KeyKind> = {
  $schema: 'string',
  advisorModel: 'string',
  agent: 'string',
  agentPushNotifEnabled: 'boolean',
  allowAllClaudeAiMcps: 'boolean',
  allowedChannelPlugins: 'array',
  allowedHttpHookUrls: 'string-array',
  allowedMcpServers: 'array',
  allowManagedHooksOnly: 'boolean',
  allowManagedMcpServersOnly: 'boolean',
  allowManagedPermissionRulesOnly: 'boolean',
  alwaysThinkingEnabled: 'boolean',
  apiKeyHelper: 'string',
  askUserQuestionTimeout: 'string',
  attribution: 'object',
  autoCompactEnabled: 'boolean',
  autoMemoryDirectory: 'string',
  autoMemoryEnabled: 'boolean',
  autoMode: 'object',
  autoScrollEnabled: 'boolean',
  autoUpdatesChannel: 'string',
  availableModels: 'string-array',
  awaySummaryEnabled: 'boolean',
  awsAuthRefresh: 'string',
  awsCredentialExport: 'string',
  axScreenReader: 'boolean',
  blockedMarketplaces: 'array',
  channelsEnabled: 'boolean',
  claudeMd: 'string',
  claudeMdExcludes: 'string-array',
  cleanupPeriodDays: 'number',
  companyAnnouncements: 'string-array',
  defaultShell: 'string',
  deniedMcpServers: 'array',
  disableAgentView: 'boolean',
  disableAllHooks: 'boolean',
  disableArtifact: 'boolean',
  disableAutoMode: 'string-or-boolean',
  disableBundledSkills: 'boolean',
  disableClaudeAiConnectors: 'boolean',
  disableDeepLinkRegistration: 'string-or-boolean',
  disabledMcpjsonServers: 'string-array',
  disableRemoteControl: 'boolean',
  disableSideloadFlags: 'boolean',
  disableSkillShellExecution: 'boolean',
  disableWorkflows: 'boolean',
  editorMode: 'string',
  effortLevel: 'string',
  enableAllProjectMcpServers: 'boolean',
  enableArtifact: 'boolean',
  enabledMcpjsonServers: 'string-array',
  enabledPlugins: 'any',
  enforceAvailableModels: 'boolean',
  env: 'object',
  extraKnownMarketplaces: 'any',
  fallbackModel: 'any',
  fastModePerSessionOptIn: 'boolean',
  feedbackSurveyRate: 'number',
  fileCheckpointingEnabled: 'boolean',
  fileSuggestion: 'object',
  footerLinksRegexes: 'array',
  forceLoginMethod: 'string',
  forceLoginGatewayUrl: 'string',
  forceLoginOrgUUID: 'any',
  forceRemoteSettingsRefresh: 'boolean',
  gcpAuthRefresh: 'string',
  hooks: 'object',
  httpHookAllowedEnvVars: 'string-array',
  includeGitInstructions: 'boolean',
  inputNeededNotifEnabled: 'boolean',
  language: 'string',
  minimumVersion: 'string',
  model: 'string',
  modelOverrides: 'object',
  otelHeadersHelper: 'string',
  outputStyle: 'string',
  parentSettingsBehavior: 'string',
  permissions: 'object',
  plansDirectory: 'string',
  pluginSuggestionMarketplaces: 'string-array',
  pluginTrustMessage: 'string',
  policyHelper: 'object',
  preferredNotifChannel: 'string',
  prefersReducedMotion: 'boolean',
  prUrlTemplate: 'string',
  sandbox: 'object',
  statusLine: 'object',
  strictKnownMarketplaces: 'any',
  strictPluginOnlyCustomization: 'any',
  wslInheritsWindowsSettings: 'boolean',
};

export const PERMISSION_MODES = [
  'default',
  'manual',
  'acceptEdits',
  'plan',
  'auto',
  'dontAsk',
  'bypassPermissions',
] as const;

const PERMISSION_ARRAY_KEYS = ['allow', 'deny', 'ask'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function kindMatches(kind: KeyKind, value: unknown): boolean {
  switch (kind) {
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string-array':
      return Array.isArray(value) && value.every((v) => typeof v === 'string');
    case 'string-or-boolean':
      return typeof value === 'string' || typeof value === 'boolean';
    case 'any':
      return true;
  }
}

function validatePermissions(permissions: Record<string, unknown>, errors: SchemaIssue[], warnings: SchemaIssue[]): void {
  for (const key of PERMISSION_ARRAY_KEYS) {
    const value = permissions[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      errors.push({ path: `permissions.${key}`, message: 'must be an array of rule strings' });
      continue;
    }
    value.forEach((entry, i) => {
      if (typeof entry !== 'string' || entry.length === 0) {
        errors.push({ path: `permissions.${key}[${i}]`, message: 'rule must be a non-empty string' });
        // eslint-disable-next-line no-control-regex
      } else if (entry.length > 1000 || /[\x00-\x1f\x7f]/.test(entry)) {
        errors.push({ path: `permissions.${key}[${i}]`, message: 'rule contains control characters or is implausibly long' });
      }
    });
  }
  const additional = permissions.additionalDirectories;
  if (additional !== undefined && !(Array.isArray(additional) && additional.every((v) => typeof v === 'string'))) {
    errors.push({ path: 'permissions.additionalDirectories', message: 'must be an array of paths' });
  }
  const mode = permissions.defaultMode;
  if (mode !== undefined) {
    if (typeof mode !== 'string') {
      errors.push({ path: 'permissions.defaultMode', message: 'must be a string' });
    } else if (!(PERMISSION_MODES as readonly string[]).includes(mode)) {
      warnings.push({ path: 'permissions.defaultMode', message: `'${mode}' is not a documented permission mode` });
    }
  }
  const disableBypass = permissions.disableBypassPermissionsMode;
  if (disableBypass !== undefined && typeof disableBypass !== 'boolean' && disableBypass !== 'disable') {
    errors.push({ path: 'permissions.disableBypassPermissionsMode', message: 'must be a boolean or "disable"' });
  }
  for (const key of Object.keys(permissions)) {
    if (
      !(PERMISSION_ARRAY_KEYS as readonly string[]).includes(key) &&
      !['additionalDirectories', 'defaultMode', 'disableBypassPermissionsMode', 'disableAutoMode'].includes(key)
    ) {
      warnings.push({ path: `permissions.${key}`, message: 'unknown permissions key (ignored by Claude Code if unrecognized)' });
    }
  }
}

/** The v1 structural provider. */
export const structuralSchema: SchemaProvider = {
  source: 'structural v1 (code.claude.com/docs/en/settings, fetched 2026-07-06)',
  validate(document: Record<string, unknown>): ValidationResult {
    const errors: SchemaIssue[] = [];
    const warnings: SchemaIssue[] = [];
    for (const [key, value] of Object.entries(document)) {
      const kind = KNOWN_TOP_LEVEL[key];
      if (kind === undefined) {
        warnings.push({ path: key, message: 'unknown top-level key (Claude Code ignores unrecognized keys)' });
        continue;
      }
      if (!kindMatches(kind, value)) {
        errors.push({ path: key, message: `wrong shape: expected ${kind}` });
      }
    }
    const permissions = document.permissions;
    if (isPlainObject(permissions)) {
      validatePermissions(permissions, errors, warnings);
    }
    return { ok: errors.length === 0, errors, warnings };
  },
};
