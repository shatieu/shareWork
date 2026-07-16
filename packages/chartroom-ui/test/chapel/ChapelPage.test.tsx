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
  type ChapelBrief,
} from '../../src/api/client.js';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    fetchChapelBrief: vi.fn(),
    fetchChapelProjects: vi.fn(),
    fetchChapelProject: vi.fn(),
    chapelConfess: vi.fn(),
    chapelOpenSession: vi.fn(),
  };
});

const mocks = {
  fetchChapelBrief: vi.mocked(fetchChapelBrief),
  fetchChapelProjects: vi.mocked(fetchChapelProjects),
  fetchChapelProject: vi.mocked(fetchChapelProject),
  chapelConfess: vi.mocked(chapelConfess),
  chapelOpenSession: vi.mocked(chapelOpenSession),
};

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
  mocks.chapelConfess.mockResolvedValue({ ok: true });
  mocks.chapelOpenSession.mockResolvedValue({ ok: true });
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
