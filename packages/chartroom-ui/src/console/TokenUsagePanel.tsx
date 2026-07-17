import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  fetchTokenSessions,
  TokenApiError,
  type TokenSessionEntry,
} from '../api/tokenClient.js';
import './tokenusage.css';

/**
 * Per-session token usage panel (wave2-I) — rides in the Console tab beside the
 * SkillAnalyticsPanel. Token COUNTS only, never cost estimates: model pricing drifts and cache
 * reads are billed nothing like fresh input, so a single "cost" number would be a lie. The
 * counts are message-id-deduped server-side (one API response = one count). Self-hides when
 * the skill-analytics station isn't mounted (404).
 */

const fmt = (n: number): string => n.toLocaleString('en-US');

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function lastActivity(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

const total = (s: TokenSessionEntry): number =>
  s.inputTokens + s.outputTokens + s.cacheCreateTokens + s.cacheReadTokens;

export function TokenUsagePanel(): ReactElement | null {
  const [sessions, setSessions] = useState<TokenSessionEntry[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchTokenSessions()
      .then((next) => {
        setSessions(next.sessions);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof TokenApiError && err.status === 404) {
          setHidden(true); // Station not mounted -> no panel, not an error banner.
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (hidden) return null;

  const sums = (sessions ?? []).reduce(
    (acc, s) => ({
      input: acc.input + s.inputTokens,
      output: acc.output + s.outputTokens,
      cacheCreate: acc.cacheCreate + s.cacheCreateTokens,
      cacheRead: acc.cacheRead + s.cacheReadTokens,
    }),
    { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
  );
  const grand = sums.input + sums.output + sums.cacheCreate + sums.cacheRead;

  return (
    <section className="token-usage" aria-label="Token usage">
      <header className="token-usage__header">
        <h2 className="token-usage__title">Token usage</h2>
        <button type="button" className="token-usage__refresh" onClick={refresh}>
          refresh usage
        </button>
      </header>

      {error && (
        <p className="token-usage__error" role="alert">
          {error}
        </p>
      )}

      {sessions === null ? (
        <p className="token-usage__empty">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="token-usage__empty">No session usage recorded yet — run a collect first.</p>
      ) : (
        <>
          <p className="token-usage__sums" aria-label="Token usage totals">
            {fmt(grand)} tokens across {sessions.length} session{sessions.length === 1 ? '' : 's'} ·{' '}
            {fmt(sums.input)} in · {fmt(sums.output)} out · {fmt(sums.cacheCreate)} cache write ·{' '}
            {fmt(sums.cacheRead)} cache read
          </p>
          <table className="token-usage__table">
            <thead>
              <tr>
                <th scope="col">Session</th>
                <th scope="col">Input</th>
                <th scope="col">Output</th>
                <th scope="col">Cache write</th>
                <th scope="col">Cache read</th>
                <th scope="col">Total</th>
                <th scope="col">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.sessionId} className={s.watched === false ? 'token-usage__row--unwatched' : undefined}>
                  <td className="token-usage__session" title={s.transcriptPath}>
                    <span className="token-usage__project">{s.project ?? '—'}</span>{' '}
                    <code className="token-usage__id">{shortId(s.sessionId)}</code>
                  </td>
                  <td className="token-usage__num">{fmt(s.inputTokens)}</td>
                  <td className="token-usage__num">{fmt(s.outputTokens)}</td>
                  <td className="token-usage__num">{fmt(s.cacheCreateTokens)}</td>
                  <td className="token-usage__num">{fmt(s.cacheReadTokens)}</td>
                  <td className="token-usage__num token-usage__total">{fmt(total(s))}</td>
                  <td className="token-usage__last">{lastActivity(s.lastTs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="token-usage__footnote">
            Counts, not costs: cache reads are far cheaper than fresh input tokens, so the totals
            above are volume, not spend.
          </p>
        </>
      )}
    </section>
  );
}
