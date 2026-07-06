export {
  defaultManagedPath,
  loadScopes,
  readScopeFile,
  scopePath,
  SCOPE_ORDER,
  WRITABLE_SCOPES,
  type ScopeFile,
  type ScopeName,
  type ScopePathOptions,
  type WritableScopeName,
} from './scopes.js';
export {
  computeEffectiveSettings,
  type AttributedRule,
  type AttributedValue,
  type EffectiveSettings,
} from './merge.js';
export { simulate, type DecidingRule, type SimulateOptions, type Verdict, type VerdictBehavior } from './simulator.js';
export {
  matchRule,
  parseRule,
  splitCompoundCommand,
  type MatchOutcome,
  type RuleContext,
  type ToolCall,
} from './rules.js';
export { getCatalog, SETTINGS_CATALOG, RULE_TEMPLATES, type Catalog, type CatalogEntry, type RuleTemplate } from './catalog.js';
export {
  applyEdit,
  computeAddSettings,
  computeAdditiveRules,
  computeRemoveAllowRule,
  hashContent,
  listBackups,
  previewEdit,
  readBackup,
  backupsDir,
  SettingsEditError,
  type ApplyResult,
  type BackupEntry,
  type EditPreview,
  type AddSettingsResult,
  type EditorOptions,
  type SettingsAdditions,
  type SettingsEditErrorCode,
} from './editor.js';
export { structuralSchema, KNOWN_TOP_LEVEL, PERMISSION_MODES, type KeyKind, type SchemaProvider, type ValidationResult } from './schema.js';
export { diffLines, formatUnifiedDiff, countChanges, type DiffOp } from './diff.js';
export { loadTemplatePacks, getTemplatePack, type TemplatePack } from './templates.js';
export { createSettingsManagerStation, type SettingsManagerStationOptions } from './station.js';
