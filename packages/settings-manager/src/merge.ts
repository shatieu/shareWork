import type { ScopeFile, ScopeName } from './scopes.js';

/**
 * Effective-settings computation (plan 07 §3; docs facts plan §2, fetched 2026-07-06):
 *  - permission ARRAYS (allow/deny/ask + additionalDirectories) MERGE across scopes;
 *  - every other setting OVERRIDES by precedence: managed → (CLI, not file-backed) → local →
 *    project → user. `ScopeFile[]` input is expected highest-precedence-first, as produced by
 *    `loadScopes`.
 * Malformed scopes never contribute -- they're surfaced in `excluded` so the UI can show why.
 * Read-only by construction (pure functions over already-loaded scope data).
 */

export interface AttributedRule {
  rule: string;
  scope: ScopeName;
  /** Absolute path of the settings file the rule came from. */
  file: string;
}

export interface AttributedValue {
  value: unknown;
  scope: ScopeName;
  file: string;
  /** Lower-precedence scopes that also define this key (shadowed, not applied). */
  overridden: { scope: ScopeName; file: string; value: unknown }[];
}

export interface EffectiveSettings {
  /** Non-permission top-level keys, key → winning value with provenance. */
  values: Record<string, AttributedValue>;
  permissions: {
    allow: AttributedRule[];
    deny: AttributedRule[];
    ask: AttributedRule[];
    additionalDirectories: AttributedRule[];
    /** Winning defaultMode (scalar override semantics), when any scope sets one. */
    defaultMode?: AttributedValue;
  };
  /** Scopes excluded from the merge because they failed to parse. */
  excluded: { scope: ScopeName; file: string; error: string }[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function computeEffectiveSettings(scopes: ScopeFile[]): EffectiveSettings {
  const values: Record<string, AttributedValue> = {};
  const allow: AttributedRule[] = [];
  const deny: AttributedRule[] = [];
  const ask: AttributedRule[] = [];
  const additionalDirectories: AttributedRule[] = [];
  let defaultMode: AttributedValue | undefined;
  const excluded: EffectiveSettings['excluded'] = [];

  for (const scopeFile of scopes) {
    if (!scopeFile.exists) continue;
    if (scopeFile.error !== undefined || scopeFile.settings === undefined) {
      excluded.push({ scope: scopeFile.scope, file: scopeFile.path, error: scopeFile.error ?? 'unreadable' });
      continue;
    }
    const doc = scopeFile.settings;

    for (const [key, value] of Object.entries(doc)) {
      if (key === 'permissions') continue;
      const existing = values[key];
      if (existing) {
        existing.overridden.push({ scope: scopeFile.scope, file: scopeFile.path, value });
      } else {
        values[key] = { value, scope: scopeFile.scope, file: scopeFile.path, overridden: [] };
      }
    }

    const permissions = doc.permissions;
    if (!isPlainObject(permissions)) continue;
    for (const rule of stringArray(permissions.allow)) {
      allow.push({ rule, scope: scopeFile.scope, file: scopeFile.path });
    }
    for (const rule of stringArray(permissions.deny)) {
      deny.push({ rule, scope: scopeFile.scope, file: scopeFile.path });
    }
    for (const rule of stringArray(permissions.ask)) {
      ask.push({ rule, scope: scopeFile.scope, file: scopeFile.path });
    }
    for (const rule of stringArray(permissions.additionalDirectories)) {
      additionalDirectories.push({ rule, scope: scopeFile.scope, file: scopeFile.path });
    }
    if (typeof permissions.defaultMode === 'string') {
      if (defaultMode) {
        defaultMode.overridden.push({ scope: scopeFile.scope, file: scopeFile.path, value: permissions.defaultMode });
      } else {
        defaultMode = {
          value: permissions.defaultMode,
          scope: scopeFile.scope,
          file: scopeFile.path,
          overridden: [],
        };
      }
    }
  }

  return {
    values,
    permissions: { allow, deny, ask, additionalDirectories, defaultMode },
    excluded,
  };
}
