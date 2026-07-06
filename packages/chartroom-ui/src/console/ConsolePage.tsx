import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { fetchConsoleOverview, type ConsoleOverview, type ConsoleSession } from '../api/client.js';
import { SkillAnalyticsPanel } from '../skillanalytics/SkillAnalyticsPanel.js';

/** 10 s poll -- the fleet endpoint shells out to `claude agents --json` server-side, so the
 * console polls gently (half Voyage's cadence) and offers a manual refresh for impatience. */
const POLL_INTERVAL_MS = 10_000;

function formatStarted(startedAt: number | null): string {
  if (startedAt === null) return '—';
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString();
}

/** Known-state chip modifier; unknown states render neutral (open set, server-normalized). */
function stateClass(state: string): string {
  return ['busy', 'idle', 'blocked', 'done'].includes(state)
    ? `console-state console-state--${state}`
    : 'console-state';
}

function FleetRow({ session }: { session: ConsoleSession }): ReactElement {
  return (
    <tr className="console-fleet__row">
      <td className="console-fleet__name" title={session.cwd ?? undefined}>
        {session.name}
      </td>
      <td className="console-fleet__repo">{session.repo ?? '—'}</td>
      <td className="console-fleet__kind">{session.kind ?? '—'}</td>
      <td>
        <span className={stateClass(session.state)}>{session.state}</span>
      </td>
      <td className="console-fleet__started">{formatStarted(session.startedAt)}</td>
    </tr>
  );
}

/**
 * Console tab (Ship_Spec §6, package 9 -- deliberately thin): fleet list over
 * `claude agents --json`, state rollup chips, inbox pending badge, today's changelog digest.
 * One endpoint, refresh button + gentle poll; every missing input degrades to an honest label.
 */
export function ConsolePage(): ReactElement {
  const [data, setData] = useState<ConsoleOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => {
    setRefreshing(true);
    fetchConsoleOverview()
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch((err: unknown) => setError(String(err)))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (data === null) {
    return (
      <div className="console">
        {error !== null ? (
          <p className="console__error" role="alert">
            Console unavailable: {error}
          </p>
        ) : (
          <p className="console__loading">Reading the fleet…</p>
        )}
      </div>
    );
  }

  const { sessions, counts, pending, rollup } = data;
  const pendingTotal = pending ? pending.permissionsPending + pending.questionsOpen : 0;

  return (
    <div className="console">
      <div className="console__head">
        <h1 className="console__title">Console</h1>
        <span className="console__updated">as of {new Date(data.generatedAt).toLocaleTimeString()}</span>
        <button type="button" className="console__refresh" onClick={refresh} disabled={refreshing}>
          {refreshing ? 'refreshing…' : 'refresh'}
        </button>
      </div>

      {error !== null && (
        <p className="console__error" role="alert">
          Last refresh failed: {error} — showing the previous snapshot.
        </p>
      )}

      <div className="console-chips" aria-label="Fleet rollup">
        <span className="console-chip">
          <strong>{counts.total}</strong> session{counts.total === 1 ? '' : 's'}
        </span>
        <span className="console-chip console-chip--busy">
          <strong>{counts.busy}</strong> busy
        </span>
        <span className="console-chip">
          <strong>{counts.idle}</strong> idle
        </span>
        <span className="console-chip console-chip--blocked">
          <strong>{counts.blocked}</strong> blocked
        </span>
        <span className="console-chip console-chip--done">
          <strong>{counts.done}</strong> done
        </span>
        <button
          type="button"
          className={pendingTotal > 0 ? 'console-chip console-chip--inbox console-chip--alert' : 'console-chip console-chip--inbox'}
          onClick={() => {
            window.location.hash = '#/inbox';
          }}
          title={
            pending
              ? `${pending.permissionsPending} permission${pending.permissionsPending === 1 ? '' : 's'}, ${pending.questionsOpen} question${pending.questionsOpen === 1 ? '' : 's'}`
              : 'inbox station not mounted'
          }
        >
          inbox <strong>{pending ? pendingTotal : '—'}</strong>
        </button>
      </div>

      {!data.available ? (
        <p className="console__unavailable">
          Can’t see the fleet right now — <code>claude agents</code> didn’t answer. The list below may be empty; the
          badge and digest are still live.
        </p>
      ) : sessions.length === 0 ? (
        <p className="console__empty">No sessions underway. The fleet is in harbor.</p>
      ) : (
        <table className="console-fleet">
          <thead>
            <tr>
              <th scope="col">Session</th>
              <th scope="col">Repo</th>
              <th scope="col">Kind</th>
              <th scope="col">State</th>
              <th scope="col">Started</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <FleetRow key={session.sessionId} session={session} />
            ))}
          </tbody>
        </table>
      )}

      <section className="console-rollup" aria-label="Today across the fleet">
        <h2 className="console-rollup__title">Today across the fleet</h2>
        {rollup ? (
          <pre className="console-rollup__digest">{rollup.digest_md}</pre>
        ) : (
          <p className="console-rollup__none">No daily digest yet — it appears once the changelog rollup runs.</p>
        )}
      </section>

      {/* Skill analytics dashboard (Trio_Specs §A, package 11): fully self-contained — its own
          station fetches, styles and error states; degrades to an inline alert when the
          skill-analytics station isn't mounted. */}
      <SkillAnalyticsPanel />
    </div>
  );
}
