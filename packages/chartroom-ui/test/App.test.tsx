import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.js';
import {
  fetchChapelBrief,
  fetchChapelProjects,
  fetchConsoleOverview,
  fetchDoc,
  fetchDocs,
  fetchHullStations,
  fetchInbox,
  fetchRepos,
  fetchVoyage,
  openClaudeSession,
  registerRepoRequest,
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
    fetchChapelBrief: vi.fn(),
    fetchChapelProjects: vi.fn(),
    fetchConsoleOverview: vi.fn(),
    openClaudeSession: vi.fn(),
    registerRepoRequest: vi.fn(),
  };
});

const mocks = {
  fetchRepos: vi.mocked(fetchRepos),
  fetchDocs: vi.mocked(fetchDocs),
  fetchDoc: vi.mocked(fetchDoc),
  fetchInbox: vi.mocked(fetchInbox),
  fetchHullStations: vi.mocked(fetchHullStations),
  fetchVoyage: vi.mocked(fetchVoyage),
  fetchChapelBrief: vi.mocked(fetchChapelBrief),
  fetchChapelProjects: vi.mocked(fetchChapelProjects),
  fetchConsoleOverview: vi.mocked(fetchConsoleOverview),
  openClaudeSession: vi.mocked(openClaudeSession),
  registerRepoRequest: vi.mocked(registerRepoRequest),
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
  mocks.fetchChapelBrief.mockRejectedValue(new Error('no hull (standalone chartroom serve)'));
  mocks.fetchChapelProjects.mockRejectedValue(new Error('no hull (standalone chartroom serve)'));
  mocks.fetchConsoleOverview.mockRejectedValue(new Error('404 (no ship-console station)'));
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

  it('hull mode with ship-console: Console tab from the station list; selecting it routes to #/console', async () => {
    mocks.fetchHullStations.mockResolvedValue([
      { name: 'chartroom', tab: { id: 'docs', title: 'Docs' } },
      { name: 'ship-console', tab: { id: 'console', title: 'Console' } },
    ]);
    mocks.fetchConsoleOverview.mockResolvedValue({
      available: true,
      sessions: [
        { sessionId: 'aaaa', name: 'auth refactor', repo: 'auth-service', cwd: null, kind: null, state: 'busy', startedAt: null },
      ],
      counts: { total: 1, busy: 1, idle: 0, blocked: 0, done: 0 },
      pending: { permissionsPending: 0, questionsOpen: 0 },
      rollup: null,
      generatedAt: '2026-07-06T12:00:00.000Z',
    });
    render(<App />);
    const consoleTab = await screen.findByRole('tab', { name: 'Console' });
    fireEvent.click(consoleTab);
    expect(window.location.hash).toBe('#/console');
    expect(await screen.findByRole('heading', { name: 'Console' })).toBeInTheDocument();
    expect(await screen.findByText('auth refactor')).toBeInTheDocument();
  });

  it('hull mode with chapel routes: Chapel tab appended when the brief probe resolves; selecting it routes to #/chapel', async () => {
    mocks.fetchHullStations.mockResolvedValue([{ name: 'chartroom', tab: { id: 'docs', title: 'Docs' } }]);
    // null brief is still a 200 -- the tab must appear before the Chaplain ever writes one
    mocks.fetchChapelBrief.mockResolvedValue({ brief: null, updatedAt: null });
    mocks.fetchChapelProjects.mockResolvedValue({ projects: [] });
    render(<App />);
    const chapelTab = await screen.findByRole('tab', { name: 'Chapel' });
    fireEvent.click(chapelTab);
    expect(window.location.hash).toBe('#/chapel');
    expect(await screen.findByRole('heading', { name: 'Chapel' })).toBeInTheDocument();
    expect(await screen.findByText('The Chaplain has not kept his brief yet.')).toBeInTheDocument();
    // breadcrumb reflects the chapel route
    expect(within(screen.getByRole('banner')).getByText('chapel')).toBeInTheDocument();
  });

  it('standalone mode (chapel probe rejects): no Chapel tab', async () => {
    mocks.fetchHullStations.mockResolvedValue([{ name: 'chartroom', tab: { id: 'docs', title: 'Docs' } }]);
    render(<App />);
    expect(await screen.findByText('1 watched')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Chapel' })).not.toBeInTheDocument();
  });

  it('hull mode with voyage AND chapel: both tabs appended', async () => {
    mocks.fetchHullStations.mockResolvedValue([{ name: 'chartroom', tab: { id: 'docs', title: 'Docs' } }]);
    mocks.fetchVoyage.mockResolvedValue(voyageFixture);
    mocks.fetchChapelBrief.mockResolvedValue({ brief: '# hello', updatedAt: '2026-07-09T08:00:00.000Z' });
    mocks.fetchChapelProjects.mockResolvedValue({ projects: [] });
    render(<App />);
    expect(await screen.findByRole('tab', { name: 'Voyage' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Chapel' })).toBeInTheDocument();
  });

  it('deep link #/chapel renders the chapel view directly', async () => {
    mocks.fetchHullStations.mockResolvedValue([{ name: 'chartroom', tab: { id: 'docs', title: 'Docs' } }]);
    mocks.fetchChapelBrief.mockResolvedValue({ brief: '# hello', updatedAt: null });
    mocks.fetchChapelProjects.mockResolvedValue({ projects: [] });
    window.location.hash = '#/chapel';
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Chapel' })).toBeInTheDocument();
    // the chapel deep link must NOT be hijacked by the docs-tab restore logic
    expect(window.location.hash).toBe('#/chapel');
  });

  it('a bare hash renders the tracked-repos overview (no auto-select jump, package 15)', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Tracked repos' })).toBeInTheDocument();
    // the landing route stays put -- no #/repo/... hijack
    expect(window.location.hash).toBe('');
    const card = screen.getByRole('button', { name: 'Open alpha' });
    expect(within(card).getByText('C:/repos/alpha')).toBeInTheDocument();
    expect(within(card).getByText('1 doc')).toBeInTheDocument();
    // breadcrumb reflects the overview
    expect(within(screen.getByRole('banner')).getByText('repos')).toBeInTheDocument();
  });

  it('overview card click navigates to that repo', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open alpha' }));
    expect(window.location.hash).toBe('#/repo/repo-a');
    expect(await screen.findByRole('heading', { name: 'alpha' })).toBeInTheDocument();
  });
});

describe('add-repo modal (package 15)', () => {
  it('the overview add button opens the modal; a successful registration refreshes the repo list', async () => {
    const repoB: RepoSummary = {
      id: 'repo-b',
      name: 'bravo',
      absPath: 'C:/repos/bravo',
      docCount: 0,
      brokenLinkCount: 0,
      needsYouCount: 0,
    };
    mocks.fetchRepos.mockResolvedValueOnce([repoA]).mockResolvedValue([repoA, repoB]);
    mocks.registerRepoRequest.mockResolvedValue({
      id: 'repo-b',
      name: 'bravo',
      absPath: 'C:/repos/bravo',
      alreadyRegistered: false,
    });
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '+ add repo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a repo' });
    fireEvent.change(within(dialog).getByLabelText(/absolute path/i), { target: { value: 'C:/repos/bravo' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'add repo' }));

    // modal success pane + registration call with the exact path
    expect(await within(dialog).findByText('✓ Registered')).toBeInTheDocument();
    expect(mocks.registerRepoRequest).toHaveBeenCalledExactlyOnceWith('C:/repos/bravo');
    // the shell refreshed /api/repos, navigated to the new repo, and toasted
    await waitFor(() => expect(window.location.hash).toBe('#/repo/repo-b'));
    expect(await screen.findByText('2 watched')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('bravo registered — indexing and watching now');

    // Done closes the modal
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Add a repo' })).not.toBeInTheDocument();
  });

  it('the repo-tree + add button opens the same modal', async () => {
    window.location.hash = '#/repo/repo-a';
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add repo' }));
    expect(await screen.findByRole('dialog', { name: 'Add a repo' })).toBeInTheDocument();
  });

  it('the no-repos empty state offers the add-repo CTA alongside the CLI hint', async () => {
    mocks.fetchRepos.mockResolvedValue([]);
    render(<App />);
    expect(await screen.findByText('No repos registered yet')).toBeInTheDocument();
    expect(screen.getByText('chartroom register <path>')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ add repo' }));
    expect(await screen.findByRole('dialog', { name: 'Add a repo' })).toBeInTheDocument();
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
