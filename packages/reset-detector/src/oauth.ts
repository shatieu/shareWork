import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { UsageSnapshot } from './types.js';

export const OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
export const OAUTH_BETA_HEADER = 'oauth-2025-04-20';

/**
 * The endpoint is undocumented and aggressively rate-limited; the spec's rule
 * is "cache >= 5 min". The default poll interval equals this floor.
 */
export const OAUTH_MIN_INTERVAL_MS = 300_000;

export interface OauthUsageSourceOptions {
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable token reader (tests). Defaults to ~/.claude/.credentials.json. */
  readAccessToken?: () => string;
  /** Path to the credentials file for the default token reader. */
  credentialsPath?: string;
  /**
   * Minimum ms between real fetches; reads inside the interval are served
   * from cache. Default 300 000. Lowering below 5 min is for tests only --
   * the endpoint is rate-limited (Trio_Specs §C).
   */
  minIntervalMs?: number;
  /** Injectable clock (tests). */
  now?: () => Date;
  /** Fetch timeout in ms. */
  timeoutMs?: number;
}

export interface OauthReadResult {
  /**
   * Freshest snapshot available. After a failed fetch this is the last known
   * good snapshot with stale:true -- NEVER a throw, and never a retry inside
   * the interval (the prototype's "never hammer on failure" rule).
   */
  snapshot: UsageSnapshot | null;
  /** True when served from cache (interval not elapsed, or fetch failed). */
  fromCache: boolean;
  /** Present when the most recent real fetch attempt failed. */
  error?: string;
}

export interface OauthUsageSource {
  read(): Promise<OauthReadResult>;
}

export function defaultAccessTokenReader(credentialsPath?: string): () => string {
  const path = credentialsPath ?? join(homedir(), '.claude', '.credentials.json');
  return () => {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      claudeAiOauth?: { accessToken?: string };
    };
    const token = raw.claudeAiOauth?.accessToken;
    if (!token) throw new Error(`no claudeAiOauth.accessToken in ${path}`);
    return token;
  };
}

interface OauthUsagePayload {
  five_hour?: { utilization?: number; resets_at?: string };
  seven_day?: { utilization?: number; resets_at?: string };
}

/**
 * Cached reader over the undocumented oauth usage endpoint -- the one signal
 * the Lookout prototype ran a full overnight mission on.
 */
export function createOauthUsageSource(opts: OauthUsageSourceOptions = {}): OauthUsageSource {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const readToken = opts.readAccessToken ?? defaultAccessTokenReader(opts.credentialsPath);
  const minIntervalMs = opts.minIntervalMs ?? OAUTH_MIN_INTERVAL_MS;
  const now = opts.now ?? (() => new Date());
  const timeoutMs = opts.timeoutMs ?? 20_000;

  let last: UsageSnapshot | null = null;
  let lastError: string | undefined;
  let lastAttemptMs = -Infinity;

  return {
    async read(): Promise<OauthReadResult> {
      const nowDate = now();
      const nowMs = nowDate.getTime();
      if (nowMs - lastAttemptMs < minIntervalMs) {
        // Inside the cache window: no network, whatever the last outcome was.
        return {
          snapshot: last ? { ...last, stale: lastError !== undefined } : null,
          fromCache: true,
          ...(lastError !== undefined ? { error: lastError } : {}),
        };
      }
      lastAttemptMs = nowMs;
      try {
        const token = readToken();
        const resp = await fetchImpl(OAUTH_USAGE_URL, {
          headers: {
            Authorization: `Bearer ${token}`,
            'anthropic-beta': OAUTH_BETA_HEADER,
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!resp.ok) throw new Error(`oauth usage endpoint HTTP ${resp.status}`);
        const body = (await resp.json()) as OauthUsagePayload;
        const fiveHour = body.five_hour ?? {};
        const sevenDay = body.seven_day ?? {};
        if (typeof fiveHour.utilization !== 'number' || typeof fiveHour.resets_at !== 'string') {
          throw new Error('oauth usage payload missing five_hour.utilization/resets_at');
        }
        last = {
          five_hour_pct: fiveHour.utilization,
          seven_day_pct: typeof sevenDay.utilization === 'number' ? sevenDay.utilization : 0,
          resets_at: fiveHour.resets_at,
          checked_at: nowDate.toISOString(),
          source: 'oauth',
        };
        lastError = undefined;
        return { snapshot: { ...last }, fromCache: false };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        return {
          snapshot: last ? { ...last, stale: true } : null,
          fromCache: true,
          error: lastError,
        };
      }
    },
  };
}
