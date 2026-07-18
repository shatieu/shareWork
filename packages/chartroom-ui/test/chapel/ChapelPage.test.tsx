import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChapelPage } from '../../src/chapel/ChapelPage.js';
import {
  ChapelApiError,
  chapelConfess,
  chapelOpenSession,
  fetchChapelBrief,
  fetchChapelProject,
  fetchChapelProjects,
  fetchRepos,
  type ChapelBrief,
  type RepoSummary,
} from '../../src/api/client.js';
import {
  chapelChat,
  fetchChapelChatLog,
  fetchChapelConfession,
  fetchChapelConfessions,
  fetchChapelRounds,
  fetchChapelRoundsDay,
  runChapelRounds,
} from '../../src/api/chapelClient.js';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    fetchChapelBrief: vi.fn(),
    fetchChapelProjects: vi.fn(),
    fetchChapelProject: vi.fn(),
    fetchRepos: vi.fn(),
    chapelConfess: vi.fn(),
    chapelOpenSession: vi.fn(),
  };
});

vi.mock('../../src/api/chapelClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/chapelClient.js')>();
  return {
    ...actual,
    chapelChat: vi.fn(),
    fetchChapelChatLog: vi.fn(),
    fetchChapelConfessions: vi.fn(),
    fetchChapelConfession: vi.fn(),
    fetchChapelRounds: vi.fn(),
    fetchChapelRoundsDay: vi.fn(),
    runChapelRounds: vi.fn(),
  };
});

const mocks = {
  fetchChapelBrief: vi.mocked(fetchChapelBrief),
  fetchChapelProjects: vi.mocked(fetchChapelProjects),
  fetchChapelProject: vi.mocked(fetchChapelProject),
  fetchRepos: vi.mocked(fetchRepos),
  chapelConfess: vi.mocked(chapelConfess),
  chapelOpenSession: vi.mocked(chapelOpenSession),
  chapelChat: vi.mocked(chapelChat),
  fetchChapelChatLog: vi.mocked(fetchChapelChatLog),
  fetchChapelConfessions: vi.mocked(fetchChapelConfessions),
  fetchChapelConfession: vi.mocked(fetchChapelConfession),
  fetchChapelRounds: vi.mocked(fetchChapelRounds),
  fetchChapelRoundsDay: vi.mocked(fetchChapelRoundsDay),
  runChapelRounds: vi.mocked(runChapelRounds),
};

/** Only `id`/`name` matter to the chip row; the rest is RepoSummary ballast. */
function repo(name: string): RepoSummary {
  return {
    id: name,
    name,
    absPath: `C:\\repos\\${name}`,
    docCount: 0,
    brokenLinkCount: 0,
    askMeCount: 0,
  } as unknown as RepoSummary;
}

const briefFixture: ChapelBrief = {
  brief: '# Standing brief\n\nThe crew ships **well**.\n\n| risk | state |\n| --- | --- |\n| scope creep | watched |',
  updatedAt: '2026-07-09T08:00:00.000Z',
};

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.fetchChapelBrief.mockResolvedValue(briefFixture);
  mocks.fetchChapelProjects.mockResolvedValue({
    projects: [
      { id: 'auth-rework', updatedAt: '2026-07-08T12:00:00.000Z' },
      { id: 'deck-chapel', updatedAt: '2026-07-09T07:00:00.000Z' },
    ],
  });
  mocks.fetchChapelProject.mockRejectedValue(new Error('not under test'));
  mocks.fetchRepos.mockResolvedValue([]);
  mocks.chapelConfess.mockResolvedValue({ ok: true });
  mocks.chapelOpenSession.mockResolvedValue({ ok: true });
  mocks.chapelChat.mockResolvedValue({ reply: 'Peace, Captain.', sessionId: 'chat-session-1' });
  mocks.fetchChapelChatLog.mockResolvedValue({ messages: [] });
  mocks.fetchChapelConfessions.mockResolvedValue({ confessions: [] });
  mocks.fetchChapelConfession.mockRejectedValue(new Error('not under test'));
  mocks.fetchChapelRounds.mockResolvedValue({ rounds: [] });
  mocks.fetchChapelRoundsDay.mockRejectedValue(new Error('not under test'));
  mocks.runChapelRounds.mockResolvedValue({ date: '2026-07-18', entryCount: 0, projectCount: 0, model: null });
});

afterEach(() => {
  cleanup();
});

describe('brief pane', () => {
  it('renders the brief as markdown (headings, gfm tables) with the updated stamp', async () => {
    render(<ChapelPage />);
    expect(await screen.findByRole('heading', { name: 'Standing brief' })).toBeInTheDocument();
    // remark-gfm proof: the pipe table becomes a real <table>
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('scope creep')).toBeInTheDocument();
    expect(screen.getByText(/brief updated/)).toBeInTheDocument();
  });

  it('shows the friendly empty pane when no brief exists yet -- and the confession box still works', async () => {
    mocks.fetchChapelBrief.mockResolvedValue({ brief: null, updatedAt: null });
    render(<ChapelPage />);
    expect(await screen.findByText('The Chaplain has not kept his brief yet.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Confession text'), { target: { value: 'first confession' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confess' }));
    await waitFor(() => expect(mocks.chapelConfess).toHaveBeenCalledExactlyOnceWith('first confession', undefined));
    expect(await screen.findByRole('status')).toHaveTextContent('Confession delivered to the Chaplain');
  });

  it('shows a readable error when the brief fetch fails', async () => {
    mocks.fetchChapelBrief.mockRejectedValue(new Error('hull unreachable'));
    render(<ChapelPage />);
    expect(await screen.findByText('Brief unavailable: hull unreachable')).toBeInTheDocument();
  });
});

describe('dossiers', () => {
  it('lists dossiers and opens one as markdown with a back button', async () => {
    mocks.fetchChapelProject.mockResolvedValue({
      id: 'auth-rework',
      content: '## Auth rework\n\nconfessions: 3',
      updatedAt: '2026-07-08T12:00:00.000Z',
    });
    render(<ChapelPage />);

    const dossiers = await screen.findByRole('region', { name: 'Dossiers' });
    fireEvent.click(within(dossiers).getByRole('button', { name: /auth-rework/ }));
    expect(await screen.findByRole('heading', { name: 'Auth rework' })).toBeInTheDocument();
    expect(mocks.fetchChapelProject).toHaveBeenCalledExactlyOnceWith('auth-rework');

    fireEvent.click(screen.getByRole('button', { name: '← all dossiers' }));
    expect(await within(dossiers).findByRole('button', { name: /deck-chapel/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Auth rework' })).not.toBeInTheDocument();
  });

  it('shows the empty state when the Chaplain keeps no dossiers', async () => {
    mocks.fetchChapelProjects.mockResolvedValue({ projects: [] });
    render(<ChapelPage />);
    expect(await screen.findByText('No dossiers yet.')).toBeInTheDocument();
  });

  it('surfaces a dossier fetch failure without leaving the list', async () => {
    mocks.fetchChapelProject.mockRejectedValue(new Error('no dossier: auth-rework'));
    render(<ChapelPage />);
    const dossiers = await screen.findByRole('region', { name: 'Dossiers' });
    fireEvent.click(within(dossiers).getByRole('button', { name: /auth-rework/ }));
    expect(await within(dossiers).findByRole('alert')).toHaveTextContent('no dossier: auth-rework');
    expect(within(dossiers).getByRole('button', { name: /deck-chapel/ })).toBeInTheDocument();
  });
});

describe('confession box', () => {
  it('sends text + selected project, clears the textarea, and toasts on success', async () => {
    render(<ChapelPage />);
    await screen.findByRole('heading', { name: 'Standing brief' });

    const textarea = screen.getByLabelText('Confession text');
    fireEvent.change(textarea, { target: { value: '  we cut the tests short  ' } });
    fireEvent.change(screen.getByLabelText('Confession project'), { target: { value: 'deck-chapel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confess' }));

    await waitFor(() =>
      expect(mocks.chapelConfess).toHaveBeenCalledExactlyOnceWith('we cut the tests short', 'deck-chapel'),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Confession delivered to the Chaplain');
    expect(textarea).toHaveValue('');
  });

  it('the Confess button is disabled while the textarea is empty/whitespace', async () => {
    render(<ChapelPage />);
    await screen.findByRole('heading', { name: 'Standing brief' });
    const button = screen.getByRole('button', { name: 'Confess' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Confession text'), { target: { value: '   ' } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Confession text'), { target: { value: 'x' } });
    expect(button).toBeEnabled();
  });

  it("shows the server's {error} message as an error toast and keeps the text for retry", async () => {
    mocks.chapelConfess.mockRejectedValue(new ChapelApiError('confession text is required', 400));
    render(<ChapelPage />);
    await screen.findByRole('heading', { name: 'Standing brief' });

    fireEvent.change(screen.getByLabelText('Confession text'), { target: { value: 'sins' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confess' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Confession failed: confession text is required');
    expect(screen.getByLabelText('Confession text')).toHaveValue('sins');
  });
});

describe('Open Chaplain session button', () => {
  it('disables while the request is pending, then toasts on success', async () => {
    let resolveSession: (value: { ok: true }) => void = () => undefined;
    mocks.chapelOpenSession.mockImplementation(() => new Promise((resolve) => (resolveSession = resolve)));
    render(<ChapelPage />);
    await screen.findByRole('heading', { name: 'Standing brief' });

    fireEvent.click(screen.getByRole('button', { name: 'Open Chaplain session' }));
    const pending = screen.getByRole('button', { name: 'session opening…' });
    expect(pending).toBeDisabled();

    await act(async () => {
      resolveSession({ ok: true });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Chaplain session opened');
    expect(screen.getByRole('button', { name: 'Open Chaplain session' })).toBeEnabled();
  });

  it('a 501 shows the returned message and leaves the button disabled', async () => {
    mocks.chapelOpenSession.mockRejectedValue(new ChapelApiError('no terminal spawner mounted on this hull', 501));
    render(<ChapelPage />);
    await screen.findByRole('heading', { name: 'Standing brief' });

    fireEvent.click(screen.getByRole('button', { name: 'Open Chaplain session' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no terminal spawner mounted on this hull');
    expect(screen.getByRole('button', { name: 'Open Chaplain session' })).toBeDisabled();
  });

  it('a non-501 failure shows an error toast and re-enables the button', async () => {
    mocks.chapelOpenSession.mockRejectedValue(new ChapelApiError('spawn failed: wt.exe not found', 500));
    render(<ChapelPage />);
    await screen.findByRole('heading', { name: 'Standing brief' });

    fireEvent.click(screen.getByRole('button', { name: 'Open Chaplain session' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chaplain session failed: spawn failed: wt.exe not found');
    expect(screen.getByRole('button', { name: 'Open Chaplain session' })).toBeEnabled();
  });
});

describe('confessor chat (the tab main feature)', () => {
  it('loads the persisted conversation: captain lines plain, chaplain replies as markdown', async () => {
    mocks.fetchChapelChatLog.mockResolvedValue({
      messages: [
        { role: 'captain', text: 'how is the wave going?', at: '2026-07-17T08:00:00.000Z' },
        { role: 'chaplain', text: '## Steady\n\nAll green so far.', at: '2026-07-17T08:00:20.000Z' },
      ],
    });
    render(<ChapelPage />);

    expect(await screen.findByText('how is the wave going?')).toBeInTheDocument();
    // Markdown proof: the chaplain's `##` becomes a real heading.
    expect(await screen.findByRole('heading', { name: 'Steady' })).toBeInTheDocument();
  });

  it('sends a message: shows the captain line at once, calls chapelChat, appends the reply', async () => {
    render(<ChapelPage />);
    await screen.findByRole('heading', { name: 'Standing brief' });

    fireEvent.change(screen.getByLabelText('Chat message'), { target: { value: '  am I on course?  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(screen.getByText('am I on course?')).toBeInTheDocument(); // optimistic captain line
    await waitFor(() => expect(mocks.chapelChat).toHaveBeenCalledExactlyOnceWith('am I on course?'));
    expect(await screen.findByText('Peace, Captain.')).toBeInTheDocument();
    expect(screen.getByLabelText('Chat message')).toHaveValue('');
  });

  it('the Send button stays disabled while the input is empty/whitespace', async () => {
    render(<ChapelPage />);
    await screen.findByRole('heading', { name: 'Standing brief' });
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Chat message'), { target: { value: '   ' } });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Chat message'), { target: { value: 'x' } });
    expect(send).toBeEnabled();
  });

  it('a failed send toasts the server error and restores the input for retry', async () => {
    mocks.chapelChat.mockRejectedValue(new ChapelApiError('chaplain chat failed: spawn claude ENOENT', 500));
    render(<ChapelPage />);
    await screen.findByRole('heading', { name: 'Standing brief' });

    fireEvent.change(screen.getByLabelText('Chat message'), { target: { value: 'hello?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Chaplain chat failed: chaplain chat failed: spawn claude ENOENT');
    expect(screen.getByLabelText('Chat message')).toHaveValue('hello?');
  });
});

describe('cross-project marker chips', () => {
  it('renders a chip per registered repo and click INSERTS a project: marker into the chat input', async () => {
    mocks.fetchRepos.mockResolvedValue([repo('shareWork'), repo('AllFrame')]);
    render(<ChapelPage />);

    const chipRow = await screen.findByRole('group', { name: 'Project markers' });
    fireEvent.click(within(chipRow).getByRole('button', { name: 'shareWork' }));
    expect(screen.getByLabelText('Chat message')).toHaveValue('project: sharework ');

    // A second chip appends -- markers are additive text, never a filter.
    fireEvent.click(within(chipRow).getByRole('button', { name: 'AllFrame' }));
    expect(screen.getByLabelText('Chat message')).toHaveValue('project: sharework project: allframe ');

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(mocks.chapelChat).toHaveBeenCalledExactlyOnceWith('project: sharework project: allframe'),
    );
  });

  it('no repos (or a failed fetch) simply hides the chip row', async () => {
    mocks.fetchRepos.mockRejectedValue(new Error('hull unreachable'));
    render(<ChapelPage />);
    await screen.findByRole('heading', { name: 'Standing brief' });
    expect(screen.queryByRole('group', { name: 'Project markers' })).not.toBeInTheDocument();
  });
});

describe('rounds section (wave2-J: machine-written daily digests)', () => {
  const twoDays = {
    rounds: [
      { date: '2026-07-18', updatedAt: '2026-07-18T06:00:00.000Z' },
      { date: '2026-07-17', updatedAt: '2026-07-17T06:00:00.000Z' },
    ],
  };

  function detail(date: string) {
    return {
      date,
      content: `# Rounds -- ${date}\n\nLead digest for ${date}.\n\n## alpha (1 session)`,
      updatedAt: `${date}T06:00:00.000Z`,
    };
  }

  it('auto-opens the newest digest as markdown with a date picker (newest first)', async () => {
    mocks.fetchChapelRounds.mockResolvedValue(twoDays);
    mocks.fetchChapelRoundsDay.mockImplementation(async (date: string) => detail(date));
    render(<ChapelPage />);

    const panel = await screen.findByRole('region', { name: 'Rounds' });
    expect(await within(panel).findByRole('heading', { name: 'Rounds -- 2026-07-18' })).toBeInTheDocument();
    expect(mocks.fetchChapelRoundsDay).toHaveBeenCalledWith('2026-07-18');

    const picker = within(panel).getByLabelText('Rounds date') as HTMLSelectElement;
    expect(Array.from(picker.options).map((option) => option.value)).toEqual(['2026-07-18', '2026-07-17']);
  });

  it('picking a past date fetches and renders that digest', async () => {
    mocks.fetchChapelRounds.mockResolvedValue(twoDays);
    mocks.fetchChapelRoundsDay.mockImplementation(async (date: string) => detail(date));
    render(<ChapelPage />);

    const panel = await screen.findByRole('region', { name: 'Rounds' });
    await within(panel).findByRole('heading', { name: 'Rounds -- 2026-07-18' });
    fireEvent.change(within(panel).getByLabelText('Rounds date'), { target: { value: '2026-07-17' } });

    expect(await within(panel).findByRole('heading', { name: 'Rounds -- 2026-07-17' })).toBeInTheDocument();
    expect(mocks.fetchChapelRoundsDay).toHaveBeenLastCalledWith('2026-07-17');
  });

  it('shows the empty state before the first rounds run', async () => {
    render(<ChapelPage />);
    const panel = await screen.findByRole('region', { name: 'Rounds' });
    expect(await within(panel).findByText('No rounds yet.')).toBeInTheDocument();
    expect(mocks.fetchChapelRoundsDay).not.toHaveBeenCalled();
  });

  it('"Run rounds now" disables while pending, toasts, then refreshes and opens the run date', async () => {
    mocks.runChapelRounds.mockResolvedValue({ date: '2026-07-18', entryCount: 3, projectCount: 2, model: 'haiku' });
    // First load: nothing; after the run the listing has the new day.
    mocks.fetchChapelRounds
      .mockResolvedValueOnce({ rounds: [] })
      .mockResolvedValue({ rounds: [{ date: '2026-07-18', updatedAt: '2026-07-18T06:00:00.000Z' }] });
    mocks.fetchChapelRoundsDay.mockImplementation(async (date: string) => detail(date));
    render(<ChapelPage />);

    const panel = await screen.findByRole('region', { name: 'Rounds' });
    await within(panel).findByText('No rounds yet.');

    fireEvent.click(within(panel).getByRole('button', { name: 'Run rounds now' }));
    expect(within(panel).getByRole('button', { name: 'making rounds…' })).toBeDisabled();

    await waitFor(() => expect(mocks.runChapelRounds).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('status')).toHaveTextContent('Rounds made for 2026-07-18');
    expect(await within(panel).findByRole('heading', { name: 'Rounds -- 2026-07-18' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Run rounds now' })).toBeEnabled();
  });

  it('a failed run toasts the server error and re-enables the button', async () => {
    mocks.runChapelRounds.mockRejectedValue(
      new ChapelApiError('rounds unavailable: the ship-log station is not mounted on this hull', 501),
    );
    render(<ChapelPage />);
    const panel = await screen.findByRole('region', { name: 'Rounds' });
    await within(panel).findByText('No rounds yet.');

    fireEvent.click(within(panel).getByRole('button', { name: 'Run rounds now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Rounds run failed: rounds unavailable: the ship-log station is not mounted on this hull',
    );
    expect(within(panel).getByRole('button', { name: 'Run rounds now' })).toBeEnabled();
  });

  it('a failed listing shows a readable error in the panel', async () => {
    mocks.fetchChapelRounds.mockRejectedValue(new Error('hull unreachable'));
    render(<ChapelPage />);
    const panel = await screen.findByRole('region', { name: 'Rounds' });
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Rounds unavailable: hull unreachable');
  });
});

describe('past confessions (archive panel)', () => {
  it('lists archive entries and opens one in full with a back button', async () => {
    mocks.fetchChapelConfessions.mockResolvedValue({
      confessions: [
        {
          stamp: '2026-07-16T17-48-43-472Z',
          project: 'sharework',
          excerpt: 'what if I add something here',
          updatedAt: '2026-07-16T17:48:43.472Z',
        },
      ],
    });
    mocks.fetchChapelConfession.mockResolvedValue({
      stamp: '2026-07-16T17-48-43-472Z',
      project: 'sharework',
      text: 'what if I add something here\n\nand a second thought',
      updatedAt: '2026-07-16T17:48:43.472Z',
    });
    render(<ChapelPage />);

    const panel = await screen.findByRole('region', { name: 'Past confessions' });
    expect(within(panel).getByText('what if I add something here')).toBeInTheDocument();
    expect(within(panel).getByText('project: sharework')).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: /what if I add something here/ }));
    await waitFor(() =>
      expect(mocks.fetchChapelConfession).toHaveBeenCalledExactlyOnceWith('2026-07-16T17-48-43-472Z'),
    );
    expect(await within(panel).findByText(/and a second thought/)).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: '← all confessions' }));
    expect(await within(panel).findByRole('button', { name: /what if I add something here/ })).toBeInTheDocument();
  });

  it('shows the empty state, and refreshes the listing after a successful confession', async () => {
    render(<ChapelPage />);
    expect(await screen.findByText('Nothing confessed yet.')).toBeInTheDocument();
    expect(mocks.fetchChapelConfessions).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Confession text'), { target: { value: 'a new sin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confess' }));
    await waitFor(() => expect(mocks.fetchChapelConfessions).toHaveBeenCalledTimes(2));
  });
});
