import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillAnalyticsPanel, type SkillAnalyticsSummary } from '../../src/skillanalytics/SkillAnalyticsPanel.js';

const summary: SkillAnalyticsSummary = {
  generatedAt: '2026-07-06T12:00:00.000Z',
  options: { project: null, days: null, deadDays: 30 },
  totals: { invocations: 4, skills: 2, agents: 1 },
  skills: [
    {
      name: 'lookout',
      category: 'skill',
      total: 3,
      proactive: 2,
      explicit: 1,
      proactiveRatio: 2 / 3,
      inputTokens: 1234,
      outputTokens: 56,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
      firstSeen: '2026-07-01T00:00:00.000Z',
      lastSeen: '2026-07-06T00:00:00.000Z',
      projects: ['shareWork'],
    },
    {
      name: 'model',
      category: 'skill',
      total: 1,
      proactive: 0,
      explicit: 1,
      proactiveRatio: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
      firstSeen: null,
      lastSeen: null,
      projects: [],
    },
  ],
  agents: [
    {
      name: 'wave-reviewer',
      category: 'agent',
      total: 1,
      proactive: 1,
      explicit: 0,
      proactiveRatio: 1,
      inputTokens: 10,
      outputTokens: 10,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
      firstSeen: null,
      lastSeen: null,
      projects: [],
    },
  ],
  trend: [{ date: '2026-07-06', count: 4 }],
  deadSkills: [
    { name: 'dusty-skill', scope: 'user', origin: 'C:/home/.claude/skills', lastSeen: null, daysSilent: null },
  ],
};

describe('SkillAnalyticsPanel', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/skill-analytics/summary')) {
          return new Response(JSON.stringify(summary), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders skill rows, the proactive ratio, agents and dead skills from the summary endpoint', async () => {
    render(<SkillAnalyticsPanel />);
    await waitFor(() => expect(screen.getByText('lookout')).toBeTruthy());

    expect(screen.getByText('Skills & slash commands')).toBeTruthy();
    expect(screen.getByText('67%')).toBeTruthy(); // 2/3 proactive ratio
    expect(screen.getByText('wave-reviewer')).toBeTruthy();
    expect(screen.getByText('dusty-skill')).toBeTruthy();
    expect(screen.getByText(/4 invocations/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collect now' })).toBeTruthy();
  });

  it('shows the endpoint error when the station is not mounted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    );
    render(<SkillAnalyticsPanel />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('HTTP 404'));
  });
});
