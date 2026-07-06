import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * Structural checks for the Crew plugin's manifest + hooks registration (plan §5: "plugin
 * manifest: plugin.json + hooks.json parse and match the R2-verified schema"). Report
 * 04-bridge-phase1-researcher.md R2: `.claude-plugin/plugin.json`'s only REQUIRED field is
 * `name` (kebab-case); `hooks/hooks.json` at plugin root is the auto-loaded default, same shape
 * as settings-level hooks.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CREW_DIR = resolve(HERE, '..', '..', '..', 'plugins', 'crew');

const pluginJsonSchema = z.looseObject({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'must be kebab-case'),
});

const hookEntrySchema = z.object({
  type: z.literal('command'),
  command: z.string(),
  args: z.array(z.string()).optional(),
});

const hooksJsonSchema = z.object({
  hooks: z.record(
    z.string(),
    z.array(
      z.object({
        matcher: z.string().optional(),
        hooks: z.array(hookEntrySchema),
      }),
    ),
  ),
});

describe('plugins/crew manifest', () => {
  it('.claude-plugin/plugin.json parses and satisfies the R2-verified minimal schema (name is the only required field)', () => {
    const raw = readFileSync(resolve(CREW_DIR, '.claude-plugin', 'plugin.json'), 'utf8');
    const parsed = pluginJsonSchema.parse(JSON.parse(raw));
    expect(parsed.name).toBe('ship-crew');
  });

  it('hooks/hooks.json parses and every registered command uses ${CLAUDE_PLUGIN_ROOT}-relative exec form', () => {
    const raw = readFileSync(resolve(CREW_DIR, 'hooks', 'hooks.json'), 'utf8');
    const parsed = hooksJsonSchema.parse(JSON.parse(raw));

    const registeredEvents = Object.keys(parsed.hooks);
    // Phase 1 scope (plan §1.1): SessionStart/Stop/SessionEnd are mandatory; the plugin also
    // forwards Notification/TaskCreated/TaskCompleted generically now that ingest stores unknown
    // events without dropping them.
    for (const required of ['SessionStart', 'Stop', 'SessionEnd']) {
      expect(registeredEvents).toContain(required);
    }
    // PermissionRequest needs a blocking emitter variant (package 6) -- deliberately absent.
    expect(registeredEvents).not.toContain('PermissionRequest');

    for (const entries of Object.values(parsed.hooks)) {
      for (const entry of entries) {
        for (const hook of entry.hooks) {
          expect(hook.command).toBe('node');
          expect(hook.args?.[0]).toContain('${CLAUDE_PLUGIN_ROOT}');
          expect(hook.args?.[0]).toContain('emit.mjs');
        }
      }
    }
  });
});
