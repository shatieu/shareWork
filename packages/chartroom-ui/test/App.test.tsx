import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.js';
import {
  fetchDoc,
  fetchDocs,
  fetchHullStations,
  fetchInbox,
  fetchRepos,
  fetchVoyage,
  openClaudeSession,
  type RepoSummary,
  type VoyageResponse,
} from '../src/api/client.js';

vi.mock('../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/client.js')>();
  return {
    ...actual,
    fetchRepos: vi.fn(),
    fetchDocs: vi.fn(),
    fetchDoc: vi.fn(),
    fetchInbox: vi.fn(),
    fetchHullStations: vi.fn(),
    fetchVoyage: vi.fn(),
    openClaudeSession: vi.fn(),
  };
});

const mocks = {
  fetchRepos: vi.mocked(fetchRepos),
  fetchDocs: vi.mocked(fetchDocs),
  fetchDoc: vi.mocked(fetchDoc),
  fetchInbox: vi.mocked(fetchInbox),
  fetchHullStations: vi.mocked(fetchHullStations),
  fetchVoyage: vi.mocked(fetchVoyage),
  openClaudeSession: vi.mocked(openClaudeSession),
};

const repoA: RepoSummary = {
  id: 'repo-a',
  name: 'alpha',
  absPath: 'C:/repos/alpha',
  docCount: 1,
  brokenLinkCount: 0,
  needsYouCount: 0,
};

const voyageFixture: VoyageResponse = {
  file: 'suite-design/overnight/progress.json',
  updatedAt: '2026-07-05T20:52:55.732Z',
  packages: [
    {
      id: 3,
      title: 'Captains Deck',
      status: 'implementing',
      stage_progress: 60,
      difficulty: 'XL',
      remaining_guess_h: 10,
    },
  ],
};

beforeEach(() => {
  window.location.hash = '';
  window.localStorage.clear();
  vi.restoreAllMocks();
  mocks.fetchRepos.mockResolvedValue([repoA]);
  mocks.fetchDocs.mockResolvedValue([{ id: 'doc-a', path: 'docs/a.md', title: 'Doc A' }]);
  mocks.fetchDoc.mockRejectedValue(new Error('not under test'));
  mocks.fetchInbox.mockResolvedValue([]);
  mocks.fetchHullStations.mockRejectedValue(new Error('no hull (standalone chartroom serve)'));
  mocks.fetchVoyage.mockRejectedValue(new Error('404'));
  mocks.openClaudeSession.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Deck shell tabs', () => {
  it('standalone mode (hull stations fetch fails): Docs tab only, no Voyage', async () => {
    render(<App />);
    expect(await screen.findByRole('tab', { name: 'Docs' })).toBeInTheDocument();
    // repos load proves all startup fetches settled
    expect(await screen.findByText('1 watched')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Voyage' })).not.toBeInTheDocument();
  });

  it('hull mode with voyage data: Voyage tab appended; selecting it routes to #/voyage', async () => {
    mocks.fetchHullStations.mockResolvedValue([{ name: 'chartroom', tab: { id: 'docs', title: 'Docs' } }]);
    mocks.fetchVoyage.mockResolvedValue(voyageFixture);
    render(<App />);
    const voyageTab = await screen.findByRole('tab', { name: 'Voyage' });
    fireEvent.click(voyageTab);
    expect(window.location.hash).toBe('#/voyage');
    expect(await screen.findByRole('heading', { name: 'Voyage' })).toBeInTheDocument();
    expect(await screen.findByText('Captains Deck')).toBeInTheDocument();
  });

  it('hull mode without a voyage file (404): tabs stay Docs-only', async () => {
    mocks.fetchHullStations.mockResolvedValue([{ name: 'chartroom', tab: { id: 'docs', title: 'Docs' } }]);
    render(<App />);
    expect(await screen.findByText('1 watched')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Voyage' })).not.toBeInTheDocument();
  });

  it('deep link #/voyage renders the voyage view directly', async () => {
    mocks.fetchHullStations.mockResolvedValue([{ name: 'chartroom', tab: { id: 'docs', title: 'Docs' } }]);
    mocks.fetchVoyage.mockResolvedValue(voyageFixture);
    window.location.hash = '#/voyage';
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Voyage' })).toBeInTheDocument();
    // the voyage deep link must NOT be hijacked by auto-select-first-repo
    expect(window.location.hash).toBe('#/voyage');
  });

  it('auto-selects the first repo on a bare hash (deep-link behavior preserved)', async () => {
    render(<App />);
    await waitFor(() => expect(window.location.hash).toBe('#/repo/repo-a'));
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('button', { name: 'Open Claude session in alpha' })).toBeEnabled();
  });
});

/** the chrome chip (the RepoTree rows carry a claude button with the same accessible name). */
function chromeChip(name = 'Open Claude session in alpha'): HTMLElement {
  return within(screen.getByRole('banner')).getByRole('button', { name });
}

describe('claude chip', () => {
  it('is disabled with an explanatory tooltip when no repo is active', async () => {
    mocks.fetchRepos.mockResolvedValue([]);
    render(<App />);
    expect(await screen.findByText('No repos registered yet')).toBeInTheDocument();
    const chip = screen.getByRole('button', { name: 'Open Claude session' });
    expect(chip).toBeDisabled();
    expect(chip).toHaveAttribute('title', 'Select a repo to open a Claude session');
  });

  it('shows the busy state while the session request is in flight', async () => {
    let resolveSession: (value: { ok: true }) => void = () => undefined;
    mocks.openClaudeSession.mockImplementation(
      () => new Promise((resolve) => (resolveSession = resolve)),
    );
    window.location.hash = '#/repo/repo-a';
    render(<App />);
    await waitFor(() => expect(chromeChip()).toBeEnabled());
    fireEvent.click(chromeChip());
    expect(await screen.findByText('session opening…')).toBeInTheDocument();
    expect(chromeChip()).toBeDisabled();
    await act(async () => {
      resolveSession({ ok: true });
    });
    expect(mocks.openClaudeSession).toHaveBeenCalledExactlyOnceWith('repo-a');
    expect(screen.queryByText('session opening…')).not.toBeInTheDocument();
  });

  it('success toast auto-dismisses after ~4s', async () => {
    window.location.hash = '#/repo/repo-a';
    vi.useFakeTimers();
    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(chromeChip());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Claude session opened in alpha');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('failure shows an error toast that is manually dismissable', async () => {
    mocks.openClaudeSession.mockRejectedValue(new Error('spawn failed: wt.exe not found'));
    window.location.hash = '#/repo/repo-a';
    render(<App />);
    await waitFor(() => expect(chromeChip()).toBeEnabled());
    fireEvent.click(chromeChip());
    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent('Claude session failed: spawn failed: wt.exe not found');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
