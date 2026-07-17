import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenUsagePanel } from '../../src/console/TokenUsagePanel.js';
import type { TokenSessionEntry } from '../../src/api/tokenClient.js';

const sessions: TokenSessionEntry[] = [
  {
    sessionId: '2cce1eab-164a-4702-8888-000000000001',
    project: 'shareWork',
    cwd: 'C:\\thisismydesign\\shareWork',
    transcriptPath: 'C:/home/.claude/projects/C--thisismydesign-shareWork/2cce1eab.jsonl',
    inputTokens: 1_000,
    outputTokens: 200,
    cacheCreateTokens: 50,
    cacheReadTokens: 4_000,
    messageCount: 12,
    model: 'claude-fable-5',
    firstTs: '2026-07-10T08:00:00.000Z',
    lastTs: '2026-07-10T09:30:00.000Z',
    watched: true,
  },
  {
    sessionId: 'beefbeef-0000-4702-8888-000000000002',
    project: 'team-tasks',
    cwd: null,
    transcriptPath: 'C:/home/.claude/projects/C--x-team-tasks/beefbeef.jsonl',
    inputTokens: 300,
    outputTokens: 100,
    cacheCreateTokens: 0,
    cacheReadTokens: 600,
    messageCount: 3,
    model: null,
    firstTs: null,
    lastTs: '2026-07-09T12:00:00.000Z',
  },
];

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TokenUsagePanel', () => {
  it('renders per-session rows, the sum header, and the honest cache footnote', async () => {
    const fetchMock = stubFetch(200, { generatedAt: 't', sessions });
    render(<TokenUsagePanel />);

    expect(await screen.findByRole('heading', { name: 'Token usage' })).toBeInTheDocument();
    // Deck-gated route -> the header rides on the GET.
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string>)['x-ship-deck']).toBe('1');

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1); // drop the header row
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('shareWork');
    expect(rows[0]).toHaveTextContent('2cce1eab…');
    expect(rows[0]).toHaveTextContent('1,000');
    expect(rows[0]).toHaveTextContent('4,000');
    expect(rows[0]).toHaveTextContent('5,250'); // per-session total incl. cache columns
    expect(rows[1]).toHaveTextContent('team-tasks');

    // Sum header: totals across sessions.
    const sums = screen.getByLabelText('Token usage totals');
    expect(sums).toHaveTextContent('6,250 tokens across 2 sessions');
    expect(sums).toHaveTextContent('1,300 in');
    expect(sums).toHaveTextContent('300 out');
    expect(sums).toHaveTextContent('50 cache write');
    expect(sums).toHaveTextContent('4,600 cache read');

    // Honest footnote: counts, not costs.
    expect(screen.getByText(/cache reads are far cheaper than fresh input tokens/)).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('self-hides when the station is not mounted (404)', async () => {
    const fetchMock = stubFetch(404, { error: 'nope' });
    const { container } = render(<TokenUsagePanel />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows an alert (not a blank panel) on non-404 errors', async () => {
    stubFetch(403, { error: 'gated' });
    render(<TokenUsagePanel />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('HTTP 403'));
  });

  it('renders the quiet empty state when no usage exists yet', async () => {
    stubFetch(200, { generatedAt: 't', sessions: [] });
    render(<TokenUsagePanel />);
    expect(await screen.findByText(/No session usage recorded yet/)).toBeInTheDocument();
  });
});
