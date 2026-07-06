import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsolePage } from '../../src/console/ConsolePage.js';
import { fetchConsoleOverview, type ConsoleOverview, type ConsoleSession } from '../../src/api/client.js';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return { ...actual, fetchConsoleOverview: vi.fn() };
});

const mockFetch = vi.mocked(fetchConsoleOverview);

function session(overrides: Partial<ConsoleSession> & Pick<ConsoleSession, 'sessionId' | 'name'>): ConsoleSession {
  return {
    repo: null,
    cwd: null,
    kind: null,
    state: 'running',
    startedAt: null,
    ...overrides,
  };
}

const fixture: ConsoleOverview = {
  available: true,
  sessions: [
    session({
      sessionId: 'aaaa',
      name: 'auth token refactor',
      repo: 'auth-service',
      cwd: 'C:\\repos\\auth-service',
      kind: 'interactive',
      state: 'busy',
      startedAt: Date.UTC(2026, 6, 6, 9, 30),
    }),
    session({ sessionId: 'bbbb', name: 'team-tasks', repo: 'team-tasks', state: 'blocked' }),
  ],
  counts: { total: 2, busy: 1, idle: 0, blocked: 1, done: 0 },
  pending: { permissionsPending: 2, questionsOpen: 1 },
  rollup: { date: '2026-07-06', digest_md: '- **auth-service**: token refresh refactor landed.' },
  generatedAt: '2026-07-06T12:00:00.000Z',
};

/** Empty skill-analytics summary: the embedded SkillAnalyticsPanel (package 11) renders its
 * quiet empty state — no extra tables, no extra role="alert" — so every fleet assertion below
 * stays exact. The panel's own behavior is covered in test/skillanalytics/. */
const emptySkillSummary = {
  generatedAt: '2026-07-06T12:00:00.000Z',
  options: { project: null, days: null, deadDays: 30 },
  totals: { invocations: 0, skills: 0, agents: 0 },
  skills: [],
  agents: [],
  trend: [],
  deadSkills: [],
};

beforeEach(() => {
  window.location.hash = '';
  mockFetch.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(emptySkillSummary), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ConsolePage', () => {
  it('renders fleet table, rollup chips, inbox badge, and the daily digest', async () => {
    mockFetch.mockResolvedValue(fixture);
    render(<ConsolePage />);

    expect(await screen.findByRole('heading', { name: 'Console' })).toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(within(table).getByText('auth token refactor')).toBeInTheDocument();
    expect(within(table).getByText('auth-service')).toBeInTheDocument();
    expect(within(table).getByText('busy')).toBeInTheDocument();
    expect(within(table).getByText('blocked')).toBeInTheDocument();

    const chips = screen.getByLabelText('Fleet rollup');
    expect(chips).toHaveTextContent('2 sessions');
    expect(chips).toHaveTextContent('1 busy');
    expect(chips).toHaveTextContent('1 blocked');
    const inboxChip = within(chips).getByRole('button', { name: /inbox 3/ });
    expect(inboxChip).toHaveAttribute('title', '2 permissions, 1 question');

    expect(screen.getByText('- **auth-service**: token refresh refactor landed.')).toBeInTheDocument();

    // Package 11: the self-contained skill-analytics dashboard rides at the bottom of the tab.
    expect(await screen.findByRole('heading', { name: 'Skill analytics' })).toBeInTheDocument();
  });

  it('inbox chip navigates to #/inbox', async () => {
    mockFetch.mockResolvedValue(fixture);
    render(<ConsolePage />);
    fireEvent.click(await screen.findByRole('button', { name: /inbox 3/ }));
    expect(window.location.hash).toBe('#/inbox');
  });

  it('available:false shows the honest fleet-unavailable note, badge and digest still shown', async () => {
    mockFetch.mockResolvedValue({ ...fixture, available: false, sessions: [], counts: { total: 0, busy: 0, idle: 0, blocked: 0, done: 0 } });
    render(<ConsolePage />);
    expect(await screen.findByText(/Can’t see the fleet right now/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /inbox 3/ })).toBeInTheDocument();
    expect(screen.getByText('- **auth-service**: token refresh refactor landed.')).toBeInTheDocument();
  });

  it('empty available fleet reads as "in harbor", not an outage', async () => {
    mockFetch.mockResolvedValue({
      ...fixture,
      sessions: [],
      counts: { total: 0, busy: 0, idle: 0, blocked: 0, done: 0 },
      pending: null,
      rollup: null,
    });
    render(<ConsolePage />);
    expect(await screen.findByText('No sessions underway. The fleet is in harbor.')).toBeInTheDocument();
    // No inbox station mounted -> em-dash badge; no digest yet -> honest placeholder.
    expect(screen.getByRole('button', { name: /inbox —/ })).toBeInTheDocument();
    expect(screen.getByText(/No daily digest yet/)).toBeInTheDocument();
  });

  it('first fetch failing shows the error state', async () => {
    mockFetch.mockRejectedValue(new Error('station absent'));
    render(<ConsolePage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Console unavailable: Error: station absent');
  });

  it('refresh button refetches; a failing refresh keeps the previous snapshot with an alert', async () => {
    mockFetch.mockResolvedValueOnce(fixture);
    render(<ConsolePage />);
    await screen.findByRole('table');

    mockFetch.mockRejectedValueOnce(new Error('fleet flaked'));
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Last refresh failed');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('polls the overview every 10 s', async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(fixture);
    render(<ConsolePage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
