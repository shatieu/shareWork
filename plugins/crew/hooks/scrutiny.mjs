#!/usr/bin/env node
/**
 * The Crew plugin's SessionStart scrutiny resolver (Ship_Spec §7, Bridge phase 4).
 *
 * Reads the project's scrutiny preset -- one word in `.claude/settings.json` under
 * `"ship": { "scrutiny": "standard" }`, overridable by `.claude/settings.local.json` -- and
 * injects a crew briefing into the session as SessionStart `additionalContext`. That briefing is
 * the "say 'help with X' anywhere and the right crew assembles silently" wiring: the session
 * learns its preset, pipeline, and gates with zero further setup.
 *
 * Also records the resolved preset to `~/.ship/crew/sessions/<session_id>.json` so the Stop
 * hook (`stop-gate.mjs`, paranoid enforcement) can key off the SAME resolution this session saw
 * -- the two scripts must never re-derive the preset independently and disagree mid-session.
 *
 * Hard constraints (same law as emit.mjs):
 *  - Stdlib only. A marketplace-distributed plugin resolves no workspace packages.
 *  - ALWAYS exits 0 (fail-open). A briefing hook must never block or degrade a session --
 *    any parse/read/write failure degrades to "standard preset, no context injected" silently
 *    (stderr only, visible in `claude --debug`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Built-in presets (Ship_Spec §7 table). `roles` is the dispatch pipeline in order;
 * `planGate` = human plan approval before implementation (rigorous+); `stopGate` = Stop-hook
 * enforced Inspector PASS before the session may report done (paranoid). */
const BUILTIN_PRESETS = {
  solo: { roles: [], planGate: false, stopGate: false },
  standard: { roles: ['navigator', 'shipwright', 'inspector'], planGate: false, stopGate: false },
  rigorous: {
    roles: ['navigator', 'devils-advocate', 'shipwright', 'inspector'],
    planGate: true,
    stopGate: false,
  },
  paranoid: {
    roles: ['navigator', 'devils-advocate', 'shipwright', 'inspector'],
    planGate: true,
    stopGate: true,
  },
};

const DEFAULT_PRESET_NAME = 'standard';

/** Test seam + power-user override: SHIP_CREW_HOME relocates the ~/.ship/crew state dir. */
function crewHomeDir() {
  return process.env.SHIP_CREW_HOME || homedir();
}

function sessionStatePath(homeDir, sessionId) {
  return join(homeDir, '.ship', 'crew', 'sessions', `${sessionId}.json`);
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    process.stderr.write(`ship-crew scrutiny.mjs: unparsable ${path}: ${err?.message ?? err}\n`);
    return undefined;
  }
}

function isValidCustomPreset(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Array.isArray(value.roles) &&
    value.roles.every((r) => typeof r === 'string' && r.length > 0)
  );
}

/**
 * Resolve { name, preset, source, warning } from the project's settings files.
 * `.claude/settings.local.json` wins over `.claude/settings.json`; custom presets under
 * `ship.crewPresets` (merged local-over-shared) extend/override the built-in table.
 */
function resolveScrutiny(cwd) {
  const shared = readJsonIfExists(join(cwd, '.claude', 'settings.json')) ?? {};
  const local = readJsonIfExists(join(cwd, '.claude', 'settings.local.json')) ?? {};

  const customPresets = {};
  for (const source of [shared, local]) {
    const defs = source?.ship?.crewPresets;
    if (defs && typeof defs === 'object') {
      for (const [name, def] of Object.entries(defs)) {
        if (isValidCustomPreset(def)) {
          customPresets[name] = {
            roles: def.roles,
            planGate: def.planGate === true,
            stopGate: def.stopGate === true,
          };
        }
      }
    }
  }

  const table = { ...BUILTIN_PRESETS, ...customPresets };

  const localName = typeof local?.ship?.scrutiny === 'string' ? local.ship.scrutiny : undefined;
  const sharedName = typeof shared?.ship?.scrutiny === 'string' ? shared.ship.scrutiny : undefined;
  const requested = localName ?? sharedName;
  const source =
    localName !== undefined
      ? '.claude/settings.local.json'
      : sharedName !== undefined
        ? '.claude/settings.json'
        : 'default';

  if (requested === undefined) {
    return { name: DEFAULT_PRESET_NAME, preset: table[DEFAULT_PRESET_NAME], source, warning: undefined };
  }
  if (!table[requested]) {
    return {
      name: DEFAULT_PRESET_NAME,
      preset: table[DEFAULT_PRESET_NAME],
      source,
      warning: `unknown scrutiny preset "${requested}" in ${source}; using "${DEFAULT_PRESET_NAME}" (built-ins: ${Object.keys(BUILTIN_PRESETS).join(', ')})`,
    };
  }
  return { name: requested, preset: table[requested], source, warning: undefined };
}

/** The crew briefing the session wakes up with. Compact on purpose -- it rides every session. */
function buildBriefing(resolved) {
  const { name, preset, source, warning } = resolved;
  const lines = [];
  lines.push(`[Ship crew] Scrutiny preset: ${name} (${source === 'default' ? 'default -- no ship.scrutiny set' : `from ${source}`}).`);
  if (warning) lines.push(`[Ship crew] WARNING: ${warning}`);
  if (preset.roles.length === 0) {
    lines.push('Crew: none -- solo preset, work directly. Ledger/changelog capture stays automatic (non-optional floor).');
  } else {
    lines.push(`Crew pipeline: ${preset.roles.join(' -> ')} (ship-crew plugin agents; dispatch per the ship-crew:crew skill).`);
  }
  lines.push(
    `Gates: plan-approval ${preset.planGate ? 'ON -- present the plan and get explicit human approval BEFORE any implementation code' : 'off'}; stop-gate ${preset.stopGate ? 'ON -- an Inspector PASS marker (.ship-crew/inspector-pass.json) is required before this session may finish (enforced by a Stop hook, not politeness)' : 'off'}.`,
  );
  lines.push(
    'For any multi-step coding task, load the ship-crew:crew skill first and assemble the crew accordingly; override verbally per session (e.g. "go rigorous on this one"). The quartermaster role answers long-horizon/progress questions from the ledger + changelog (needs the ship-ledger/ship-log MCP servers registered -- see the plugin README if its tools are missing).',
  );
  return lines.join('\n');
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    process.exit(0);
    return;
  }

  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const resolved = resolveScrutiny(cwd);

  // Record the resolution for stop-gate.mjs (same-session contract). Best-effort: a failed
  // write only weakens paranoid enforcement (stop-gate fails open), never the session.
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  if (sessionId) {
    try {
      const statePath = sessionStatePath(crewHomeDir(), sessionId);
      mkdirSync(join(statePath, '..'), { recursive: true });
      writeFileSync(
        statePath,
        JSON.stringify(
          {
            v: 1,
            session_id: sessionId,
            cwd,
            preset: resolved.name,
            stop_gate: resolved.preset.stopGate,
            recorded_at: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      );
    } catch (err) {
      process.stderr.write(`ship-crew scrutiny.mjs: state write failed: ${err?.message ?? err}\n`);
    }
  }

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: buildBriefing(resolved),
      },
    }),
  );
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`ship-crew scrutiny.mjs: unexpected error: ${err?.message ?? err}\n`);
  process.exit(0);
});
