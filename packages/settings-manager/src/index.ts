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
export {
  applyEdit,
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
  type EditorOptions,
  type SettingsEditErrorCode,
} from './editor.js';
export { structuralSchema, PERMISSION_MODES, type SchemaProvider, type ValidationResult } from './schema.js';
export { diffLines, formatUnifiedDiff, countChanges, type DiffOp } from './diff.js';
export { loadTemplatePacks, getTemplatePack, type TemplatePack } from './templates.js';
export { createSettingsManagerStation, type SettingsManagerStationOptions } from './station.js';
