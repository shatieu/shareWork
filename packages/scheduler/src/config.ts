import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  DEFAULT_GUARD_POLICY,
  DEFAULT_THRESHOLDS,
  DEFAULT_WAIT_POLICY,
  type GuardPolicy,
  type Thresholds,
  type UsageMode,
  type WaitPolicy,
} from 'reset-detector';

/**
 * Trio_Specs §C names the signal path: ".ship/lookout/" -- repo-local, so the
 * session, the guard, and a human all read the same canonical files (one
 * canonical signal path; stale copies burned a session once, see
 * LESSONS-LEARNED 2026-07-05).
 */
export const DEFAULT_STATE_DIR = '.ship/lookout';
export const CONFIG_FILE = 'config.json';
export const RESUME_PROMPT_FILE = 'resume-prompt.txt';

export interface LookoutConfig {
  /**
   * The pinned mission session id. Minted by `lookout init`; the mission MUST
   * be launched with `claude --session-id <this>` so the guard can
   * `--resume` it and never touch a foreign transcript.
   */
  sessionId: string | null;
  /** Repo root the guard resurrects in and measures git activity against. */
  repoRoot: string;
  /** Dirs (relative to repoRoot) whose newest file mtime counts as session activity. */
  activityDirs: string[];
  /** Sensor poll interval in seconds. Default 300 (= the oauth cache floor). */
  pollSeconds: number;
  thresholds: Thresholds;
  /** pause = free-window economy; spend = keep working into paid extra usage. */
  mode: UsageMode;
  guard: GuardPolicy;
  wait: WaitConfig;
}

/** The waiter's renewal/grace policy plus its loop-level self-expiry. */
export interface WaitConfig extends WaitPolicy {
  /**
   * The waiter exits (asking to be respawned) after this many hours -- a
   * background task must never be assumed immortal across a multi-day
   * mission. Default 24.
   */
  maxHours: number;
}

export const DEFAULT_WAIT_CONFIG: WaitConfig = { ...DEFAULT_WAIT_POLICY, maxHours: 24 };

export const DEFAULT_CONFIG: Omit<LookoutConfig, 'repoRoot'> = {
  sessionId: null,
  activityDirs: [],
  pollSeconds: 300,
  thresholds: { ...DEFAULT_THRESHOLDS },
  mode: 'pause',
  guard: { ...DEFAULT_GUARD_POLICY },
  wait: { ...DEFAULT_WAIT_CONFIG },
};

export function resolveStateDir(stateDir?: string, cwd: string = process.cwd()): string {
  const dir = stateDir ?? DEFAULT_STATE_DIR;
  return isAbsolute(dir) ? dir : resolve(cwd, dir);
}

export function configPath(stateDir: string): string {
  return join(stateDir, CONFIG_FILE);
}

export function resumePromptPath(stateDir: string): string {
  return join(stateDir, RESUME_PROMPT_FILE);
}

/**
 * Load config.json, layering file values over defaults. A missing file is not
 * an error (sensor-only usage needs no config at all); it yields defaults with
 * sessionId null -- which makes the guard REFUSE resurrection rather than
 * guess.
 */
export function loadConfig(stateDir: string, cwd: string = process.cwd()): LookoutConfig {
  const defaults: LookoutConfig = { ...structuredClone(DEFAULT_CONFIG), repoRoot: cwd };
  const path = configPath(stateDir);
  if (!existsSync(path)) return defaults;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<LookoutConfig>;
  return {
    ...defaults,
    ...raw,
    thresholds: { ...defaults.thresholds, ...(raw.thresholds ?? {}) },
    guard: { ...defaults.guard, ...(raw.guard ?? {}) },
    wait: { ...defaults.wait, ...(raw.wait ?? {}) },
  };
}

export const DEFAULT_RESUME_PROMPT = `Lookout Guard resurrection. Your previous session in this repository hit a usage hard cap and the usage window has reset. Re-orient from the repository's own tracking files (they, not conversation memory, carry continuity): read the mission/status notes referenced in CLAUDE.md or your project's tracking directory, verify the Lookout signal files under .ship/lookout/, then continue exactly where the tracking files say work stopped. Work autonomously and commit at every safe boundary.
`;

export interface InitResult {
  config: LookoutConfig;
  configCreated: boolean;
  promptCreated: boolean;
  /** The exact command the mission must be launched with (session pinning). */
  launchCommand: string;
}

/**
 * Mint the pinned session id and write config + a default resume prompt.
 * Idempotent: an existing config keeps its sessionId; an existing prompt is
 * never overwritten.
 */
export function initConfig(
  stateDir: string,
  opts: {
    cwd?: string;
    sessionId?: string;
    mode?: UsageMode;
    activityDirs?: string[];
    mintUuid?: () => string;
  } = {},
): InitResult {
  const cwd = opts.cwd ?? process.cwd();
  mkdirSync(stateDir, { recursive: true });

  const existing = existsSync(configPath(stateDir));
  const config = loadConfig(stateDir, cwd);
  if (opts.mode) config.mode = opts.mode;
  if (opts.activityDirs) config.activityDirs = opts.activityDirs;
  if (opts.sessionId) {
    config.sessionId = opts.sessionId;
  } else if (!config.sessionId) {
    config.sessionId = (opts.mintUuid ?? randomUUID)();
  }
  config.repoRoot = cwd;
  writeFileSync(configPath(stateDir), JSON.stringify(config, null, 2) + '\n');

  let promptCreated = false;
  if (!existsSync(resumePromptPath(stateDir))) {
    writeFileSync(resumePromptPath(stateDir), DEFAULT_RESUME_PROMPT);
    promptCreated = true;
  }

  return {
    config,
    configCreated: !existing,
    promptCreated,
    launchCommand: `claude --session-id ${config.sessionId}`,
  };
}

export function loadResumePrompt(stateDir: string): string | null {
  const path = resumePromptPath(stateDir);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8').trim();
  return text.length > 0 ? text : null;
}
