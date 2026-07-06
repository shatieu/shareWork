import { spawn as nodeSpawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Fleet access for the Comm (VoiceBridge_Spec §3): reading the fleet comes from
 * `claude agents --json` (verified live 2026-07-06: exits 0 headless, prints a JSON array of
 * session objects); talking to it uses the spec §7 built-in fallback `claude -p --resume`
 * (the `claude agents` view has no headless dispatch/send flags -- verified in the same pass).
 * Both sit behind injected interfaces with deterministic test seams, the same discipline as
 * ship-log's summarizer.
 */

/** Shape observed from `claude agents --json` (2026-07-06). Fields beyond these are ignored. */
export interface FleetSession {
  id?: string;
  sessionId: string;
  name?: string;
  cwd?: string;
  /** 'background' | 'interactive' */
  kind?: string;
  startedAt?: number;
  /** 'blocked' | 'done' (absent while simply running) */
  state?: string;
  /** 'busy' | 'idle' */
  status?: string;
  pid?: number;
}

/** Injected fleet reader. `null` = "couldn't see the fleet" -- callers always have a spoken
 * fallback, never an exception across the tool boundary. */
export interface FleetSource {
  list(): Promise<FleetSession[] | null>;
}

/** Injected fleet writer: fire-and-forget sends/dispatches (phase 1 gives a spoken ack, it does
 * not await the session's reply -- supervisor peek/reply is phase 2+ territory). */
export interface FleetControl {
  send(sessionId: string, text: string): Promise<boolean>;
  dispatch(repo: string, task: string): Promise<boolean>;
}

export type VoiceSpawnSync = (
  command: string,
  args: string[],
  options: { cwd?: string; encoding: 'utf8'; timeout: number; env: NodeJS.ProcessEnv },
) => SpawnSyncReturns<string>;

/**
 * Same PATH-walk as ship-log's summarize.ts (kept duplicated on purpose: stations never import
 * each other's internals -- Ship_Spec §2 discipline rule): Windows npm installs put a
 * `claude.cmd` shim on PATH which Node refuses to spawn without `shell: true`; the shim's real
 * target is `<dir>/node_modules/@anthropic-ai/claude-code/bin/claude.exe`.
 * `SHIP_VOICE_CLAUDE_PATH` is the documented override.
 */
export function resolveClaudeBinary(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = env.SHIP_VOICE_CLAUDE_PATH;
  if (override) return override;
  if (platform !== 'win32') return 'claude';
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (!dir) continue;
    const exe = join(dir, 'claude.exe');
    if (existsSync(exe)) return exe;
    if (existsSync(join(dir, 'claude.cmd')) || existsSync(join(dir, 'claude'))) {
      const shimTarget = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
      if (existsSync(shimTarget)) return shimTarget;
    }
  }
  return 'claude';
}

let cachedBinary: string | undefined;
function claudeBinary(): string {
  cachedBinary ??= resolveClaudeBinary();
  return cachedBinary;
}

const LIST_TIMEOUT_MS = 15_000;

/** Production fleet reader: `claude agents --json`. Any spawn failure, non-zero exit, or
 * unparsable output returns `null` (spoken fallback), never throws. */
export function createClaudeFleetSource(spawn: VoiceSpawnSync = spawnSync): FleetSource {
  return {
    async list(): Promise<FleetSession[] | null> {
      const result = spawn(claudeBinary(), ['agents', '--json'], {
        encoding: 'utf8',
        timeout: LIST_TIMEOUT_MS,
        env: process.env,
      });
      if (result.error || result.status !== 0 || !result.stdout) return null;
      try {
        const parsed = JSON.parse(result.stdout) as unknown;
        if (!Array.isArray(parsed)) return null;
        return parsed.filter(
          (s): s is FleetSession => typeof s === 'object' && s !== null && typeof (s as FleetSession).sessionId === 'string',
        );
      } catch {
        return null;
      }
    },
  };
}

/** Production fleet writer: detached, fire-and-forget `claude -p` spawns.
 *  - send: `claude -p <text> --resume <sessionId>` (spec §7's built-in fallback channel).
 *  - dispatch: `claude -p <task>` with cwd=<repo> -- a new headless session on that repo.
 * Phase 1 never awaits the child; a failed *spawn* returns false (spoken error), a failed
 * *session* is the fleet's business and shows up in fleet_status. */
export function createClaudeFleetControl(spawner: typeof nodeSpawn = nodeSpawn): FleetControl {
  const fire = (args: string[], cwd?: string): boolean => {
    try {
      const child = spawner(claudeBinary(), args, {
        cwd,
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      child.on('error', () => {
        /* fire-and-forget: spawn errors after this tick surface via fleet_status, not here */
      });
      child.unref();
      return true;
    } catch {
      return false;
    }
  };
  return {
    async send(sessionId: string, text: string): Promise<boolean> {
      return fire(['-p', text, '--resume', sessionId]);
    },
    async dispatch(repo: string, task: string): Promise<boolean> {
      if (!existsSync(repo)) return false;
      return fire(['-p', task], repo);
    },
  };
}

/**
 * Test seams (ship-log's fakeSummarizerSeamActive discipline: both conditions checked at call
 * time, refused outside NODE_ENV=test, so a production hull can never silently serve a fake
 * fleet):
 *  - `SHIP_VOICE_FAKE_FLEET` -- JSON array served as the fleet.
 *  - `SHIP_VOICE_FAKE_CONTROL=1` -- send/dispatch succeed without spawning anything.
 */
export function fakeFleetSeamActive(env: NodeJS.ProcessEnv = process.env): boolean {
  return typeof env.SHIP_VOICE_FAKE_FLEET === 'string' && env.NODE_ENV === 'test';
}

export function fakeControlSeamActive(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SHIP_VOICE_FAKE_CONTROL === '1' && env.NODE_ENV === 'test';
}

const claudeFleetSource = createClaudeFleetSource();
const claudeFleetControl = createClaudeFleetControl();

export const defaultFleetSource: FleetSource = {
  async list(): Promise<FleetSession[] | null> {
    if (fakeFleetSeamActive()) {
      try {
        const parsed = JSON.parse(process.env.SHIP_VOICE_FAKE_FLEET as string) as FleetSession[];
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return claudeFleetSource.list();
  },
};

export const defaultFleetControl: FleetControl = {
  async send(sessionId: string, text: string): Promise<boolean> {
    if (fakeControlSeamActive()) return true;
    return claudeFleetControl.send(sessionId, text);
  },
  async dispatch(repo: string, task: string): Promise<boolean> {
    if (fakeControlSeamActive()) return existsSync(repo);
    return claudeFleetControl.dispatch(repo, task);
  },
};

/* ── fuzzy addressing (§4: "the auth one" resolves laptop-side) ── */

function tokensOf(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export interface NameResolution {
  match?: FleetSession;
  candidates: FleetSession[];
}

/**
 * Resolve a spoken session reference against the live fleet: score = fraction of query tokens
 * found among the session's name + repo-folder tokens. A unique best score wins; ties surface
 * as candidates for a spoken disambiguation. Ids never participate (§4 names-not-ids).
 */
export function resolveSessionName(query: string, sessions: FleetSession[]): NameResolution {
  const queryTokens = tokensOf(query);
  if (queryTokens.length === 0) return { candidates: [] };

  const scored = sessions
    .map((session) => {
      const haystack = new Set([
        ...tokensOf(session.name ?? ''),
        ...tokensOf(session.cwd?.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''),
      ]);
      const hits = queryTokens.filter((t) => haystack.has(t)).length;
      return { session, score: hits / queryTokens.length };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { candidates: [] };
  const best = scored[0].score;
  const top = scored.filter((s) => s.score === best);
  if (top.length === 1) return { match: top[0].session, candidates: [top[0].session] };
  return { candidates: top.map((s) => s.session) };
}
