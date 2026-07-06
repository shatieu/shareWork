import { useCallback, useEffect, useState, type ReactElement } from 'react';
import './skillanalytics.css';

/**
 * Skill Analytics dashboard panel (Trio_Specs §A output: "a JSON endpoint the Ship console
 * renders as a dashboard panel"). SELF-CONTAINED and mountable (plan 11 collision rule):
 * package 9 owns Console-tab routing, so this component ships unmounted — it fetches
 * `/api/skill-analytics/*` itself (deliberately NOT via the shared api/client.ts) and brings
 * its own scoped stylesheet. Mount it anywhere inside the Deck to get the panel.
 */

const DECK_CLIENT_HEADER = 'x-ship-deck';

export interface SkillRow {
  name: string;
  category: 'skill' | 'agent';
  total: number;
  proactive: number;
  explicit: number;
  proactiveRatio: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
  firstSeen: string | null;
  lastSeen: string | null;
  projects: string[];
}

export interface DeadSkillRow {
  name: string;
  scope: string;
  origin: string;
  lastSeen: string | null;
  daysSilent: number | null;
}

export interface SkillAnalyticsSummary {
  generatedAt: string;
  options: { project: string | null; days: number | null; deadDays: number };
  totals: { invocations: number; skills: number; agents: number };
  skills: SkillRow[];
  agents: SkillRow[];
  trend: { date: string; count: number }[];
  deadSkills: DeadSkillRow[];
}

async function fetchSummary(): Promise<SkillAnalyticsSummary> {
  const response = await fetch('/api/skill-analytics/summary');
  if (!response.ok) throw new Error(`summary failed: HTTP ${response.status}`);
  return (await response.json()) as SkillAnalyticsSummary;
}

async function postCollect(): Promise<void> {
  const response = await fetch('/api/skill-analytics/collect', {
    method: 'POST',
    headers: { [DECK_CLIENT_HEADER]: '1' },
  });
  if (!response.ok) throw new Error(`collect failed: HTTP ${response.status}`);
}

const fmt = (n: number): string => n.toLocaleString('en-US');
const ratio = (r: number | null): string => (r === null ? '—' : `${Math.round(r * 100)}%`);
const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : '—');

function RowsTable({ rows, caption }: { rows: SkillRow[]; caption: string }): ReactElement {
  if (rows.length === 0) {
    return <p className="skill-analytics__empty">No invocations recorded yet.</p>;
  }
  return (
    <table className="skill-analytics__table">
      <caption className="skill-analytics__caption">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Total</th>
          <th scope="col">Proactive</th>
          <th scope="col">Explicit</th>
          <th scope="col">Ratio</th>
          <th scope="col">Tokens in / out</th>
          <th scope="col">Last seen</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.category}:${row.name}`}>
            <td className="skill-analytics__name">{row.name}</td>
            <td className="skill-analytics__num">{fmt(row.total)}</td>
            <td className="skill-analytics__num">{fmt(row.proactive)}</td>
            <td className="skill-analytics__num">{fmt(row.explicit)}</td>
            <td className="skill-analytics__num">{ratio(row.proactiveRatio)}</td>
            <td className="skill-analytics__num">
              {fmt(row.inputTokens)} / {fmt(row.outputTokens)}
            </td>
            <td>{day(row.lastSeen)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SkillAnalyticsPanel(): ReactElement {
  const [summary, setSummary] = useState<SkillAnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);

  const refresh = useCallback(() => {
    fetchSummary()
      .then((next) => {
        setSummary(next);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const collectNow = (): void => {
    setCollecting(true);
    postCollect()
      .then(refresh)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCollecting(false));
  };

  return (
    <section className="skill-analytics" aria-label="Skill analytics">
      <header className="skill-analytics__header">
        <h2 className="skill-analytics__title">Skill analytics</h2>
        <button
          type="button"
          className="skill-analytics__collect"
          onClick={collectNow}
          disabled={collecting}
        >
          {collecting ? 'Collecting…' : 'Collect now'}
        </button>
      </header>

      {error && (
        <p className="skill-analytics__error" role="alert">
          {error}
        </p>
      )}

      {summary === null ? (
        <p className="skill-analytics__empty">Loading…</p>
      ) : (
        <>
          <p className="skill-analytics__totals">
            {fmt(summary.totals.invocations)} invocations · {summary.totals.skills} skills/commands ·{' '}
            {summary.totals.agents} agent types
          </p>
          <RowsTable rows={summary.skills} caption="Skills & slash commands" />
          <RowsTable rows={summary.agents} caption="Agents (by subagent_type)" />
          <section className="skill-analytics__dead" aria-label="Dead skills">
            <h3 className="skill-analytics__subtitle">
              Dead skills (silent ≥ {summary.options.deadDays} days)
            </h3>
            {summary.deadSkills.length === 0 ? (
              <p className="skill-analytics__empty">None — every installed skill has fired recently.</p>
            ) : (
              <ul className="skill-analytics__dead-list">
                {summary.deadSkills.map((dead) => (
                  <li key={`${dead.scope}:${dead.origin}:${dead.name}`}>
                    <strong>{dead.name}</strong> [{dead.scope}]{' '}
                    {dead.lastSeen === null ? 'never fired' : `${dead.daysSilent}d silent (last ${day(dead.lastSeen)})`}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}
