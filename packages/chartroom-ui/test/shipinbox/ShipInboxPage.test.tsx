import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShipAgentQuestion, ShipInboxItems, ShipPermissionRequest } from '../../src/api/client.js';
import type {
  InboxConsoleOverview,
  SessionWatchResponse,
  SendToSessionResponse,
  ShipQuestionResponse,
} from '../../src/api/inboxClient.js';

const fetchItemsMock = vi.fn<() => Promise<ShipInboxItems>>();
const decideMock = vi.fn<(id: string, decision: unknown) => Promise<ShipPermissionRequest>>();
const ackMock = vi.fn<(id: string) => Promise<ShipAgentQuestion>>();
const respondMock = vi.fn<(id: string, text: string) => Promise<ShipQuestionResponse>>();
const sendMock = vi.fn<(sessionId: string, text: string) => Promise<SendToSessionResponse>>();
const overviewMock = vi.fn<() => Promise<InboxConsoleOverview>>();
const watchMock = vi.fn<(sessionId: string, watched: boolean) => Promise<SessionWatchResponse>>();

vi.mock('../../src/api/client.js', () => ({
  fetchShipInboxItems: (...args: unknown[]) => fetchItemsMock(...(args as [])),
  decideShipPermission: (...args: unknown[]) => decideMock(...(args as [string, unknown])),
  ackShipQuestion: (...args: unknown[]) => ackMock(...(args as [string])),
}));

vi.mock('../../src/api/inboxClient.js', async () => {
  const real = await vi.importActual<typeof import('../../src/api/inboxClient.js')>('../../src/api/inboxClient.js');
  return {
    askHumanHash: real.askHumanHash,
    respondShipQuestion: (...args: unknown[]) => respondMock(...(args as [string, string])),
    sendTextToSession: (...args: unknown[]) => sendMock(...(args as [string, string])),
    fetchSessionsOverview: (...args: unknown[]) => overviewMock(...(args as [])),
    setSessionWatched: (...args: unknown[]) => watchMock(...(args as [string, boolean])),
  };
});

const { ShipInboxPage } = await import('../../src/shipinbox/ShipInboxPage.js');
const { suggestRule } = await import('../../src/shipinbox/PermissionCard.js');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const PERMISSION: ShipPermissionRequest = {
  id: 'perm-1',
  sessionId: 'sess-12345678',
  cwd: 'C:\\work\\proj',
  project: 'proj',
  toolName: 'Bash',
  toolInput: { command: 'git push origin main' },
  source: 'resolver',
  status: 'pending',
  decisionMessage: null,
  alwaysAllowRule: null,
  ruleBackupPath: null,
  createdAt: '2026-07-06T10:00:00.000Z',
  decidedAt: null,
};

const QUESTION: ShipAgentQuestion = {
  id: 'q-1',
  sessionId: 'sess-2',
  cwd: '/home/o/proj',
  project: 'proj',
  kind: 'agent_needs_input',
  message: 'Which deploy target?',
  status: 'open',
  createdAt: '2026-07-06T10:00:00.000Z',
  ackedAt: null,
};

const ITEMS: ShipInboxItems = {
  permissions: [PERMISSION],
  questions: [QUESTION],
  docs: [
    {
      repoId: 'repo-a',
      repoName: 'Repo A',
      docId: 'doc-1',
      docPath: 'doc-1.md',
      kind: 'ask-me',
      directiveId: 'ask-1',
      label: 'Which port?',
      type: 'text',
    },
  ],
};

const OVERVIEW: InboxConsoleOverview = {
  available: true,
  sessions: [
    {
      sessionId: 'sess-12345678',
      name: 'proj worker',
      repo: 'proj',
      cwd: 'C:\\work\\proj',
      kind: 'interactive',
      state: 'busy',
      startedAt: null,
      watched: true,
    },
  ],
  hidden: [
    {
      sessionId: 'sess-hidden-1',
      name: 'old worker',
      repo: 'old',
      cwd: 'C:\\work\\old',
      kind: 'interactive',
      state: 'idle',
      startedAt: null,
      watched: false,
    },
  ],
  counts: { total: 1, busy: 1, idle: 0, blocked: 0, done: 0 },
  pending: null,
  rollup: null,
  generatedAt: '2026-07-17T10:00:00.000Z',
};

function primeDefaults(): void {
  fetchItemsMock.mockResolvedValue(ITEMS);
  overviewMock.mockRejectedValue(new Error('no console station'));
}

describe('ShipInboxPage (plan 06 §1.6 + wave2-E rework)', () => {
  it('renders all sections of the one page', async () => {
    primeDefaults();
    render(<ShipInboxPage onNavigate={vi.fn()} />);

    expect(await screen.findByText('Permission requests')).toBeInTheDocument();
    expect(screen.getByText('Agent questions')).toBeInTheDocument();
    expect(screen.getByText('Docs needing you')).toBeInTheDocument();
    expect(screen.getByText(/wants to run/)).toBeInTheDocument();
    expect(screen.getByText('Which deploy target?')).toBeInTheDocument();
    expect(screen.getByText('Which port?')).toBeInTheDocument();
  });

  it('allow/deny call the decision API and refetch', async () => {
    primeDefaults();
    decideMock.mockResolvedValue({ ...PERMISSION, status: 'allowed' });
    const onChanged = vi.fn();
    render(<ShipInboxPage onNavigate={vi.fn()} onChanged={onChanged} />);

    fireEvent.click(await screen.findByRole('button', { name: 'allow' }));
    await waitFor(() =>
      expect(decideMock).toHaveBeenCalledWith('perm-1', {
        behavior: 'allow',
        alwaysAllowRule: undefined,
        message: undefined,
      }),
    );
    await waitFor(() => expect(fetchItemsMock).toHaveBeenCalledTimes(2));
    expect(onChanged).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'deny' }));
    await waitFor(() =>
      expect(decideMock).toHaveBeenCalledWith('perm-1', {
        behavior: 'deny',
        alwaysAllowRule: undefined,
        message: undefined,
      }),
    );
  });

  it('deny with note sends the message field (D2) and says the note rides the transcript', async () => {
    primeDefaults();
    decideMock.mockResolvedValue({ ...PERMISSION, status: 'denied' });
    render(<ShipInboxPage onNavigate={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'deny with note…' }));
    expect(screen.getByText(/behavior-only hook schema/)).toBeInTheDocument();
    const noteInput = screen.getByLabelText('Deny note');
    fireEvent.change(noteInput, { target: { value: 'not on this branch' } });
    fireEvent.click(screen.getByRole('button', { name: 'deny + send note' }));
    await waitFor(() =>
      expect(decideMock).toHaveBeenCalledWith('perm-1', {
        behavior: 'deny',
        alwaysAllowRule: undefined,
        message: 'not on this branch',
      }),
    );
  });

  it("hook-source rows render record-only: no live buttons at all (D3)", async () => {
    fetchItemsMock.mockResolvedValue({
      permissions: [{ ...PERMISSION, id: 'perm-hook', source: 'hook' }],
      questions: [],
      docs: [],
    });
    overviewMock.mockRejectedValue(new Error('no console station'));
    render(<ShipInboxPage onNavigate={vi.fn()} />);

    expect(await screen.findByText(/Record only: this request arrived as telemetry/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'allow' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'deny' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'always allow…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'deny with note…' })).not.toBeInTheDocument();
  });

  it('always allow opens the rule panel pre-filled with the suggestion and sends the edited rule', async () => {
    primeDefaults();
    decideMock.mockResolvedValue({ ...PERMISSION, status: 'allowed' });
    render(<ShipInboxPage onNavigate={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'always allow…' }));
    const input = screen.getByLabelText('Permission rule') as HTMLInputElement;
    expect(input.value).toBe('Bash(git:*)'); // first-word suggestion from the command

    fireEvent.change(input, { target: { value: 'Bash(git push:*)' } });
    fireEvent.click(screen.getByRole('button', { name: 'allow + remember' }));
    await waitFor(() =>
      expect(decideMock).toHaveBeenCalledWith('perm-1', {
        behavior: 'allow',
        alwaysAllowRule: 'Bash(git push:*)',
        message: undefined,
      }),
    );
  });

  it('replying to a question stores + delivers and reports the honest transcript outcome (D1)', async () => {
    primeDefaults();
    respondMock.mockResolvedValue({
      ...QUESTION,
      status: 'answered' as never,
      responseText: 'use staging',
      respondedAt: '2026-07-17T10:00:00.000Z',
      responseDelivered: true,
      delivery: { delivered: true, transport: 'transcript-resume' },
    });
    const onChanged = vi.fn();
    render(<ShipInboxPage onNavigate={vi.fn()} onChanged={onChanged} />);

    fireEvent.click(await screen.findByRole('button', { name: 'reply…' }));
    // The honest transport label is visible BEFORE sending.
    expect(screen.getByText(/not injected into\s+the running task/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Reply to question/), { target: { value: 'use staging' } });
    fireEvent.click(screen.getByRole('button', { name: 'send reply' }));

    await waitFor(() => expect(respondMock).toHaveBeenCalledWith('q-1', 'use staging'));
    expect(await screen.findByText(/Reply saved and sent to the session/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('a failed delivery is reported, not hidden', async () => {
    primeDefaults();
    respondMock.mockResolvedValue({
      ...QUESTION,
      status: 'answered' as never,
      responseText: 'use staging',
      respondedAt: '2026-07-17T10:00:00.000Z',
      responseDelivered: false,
      delivery: { delivered: false, detail: 'session is not in the live fleet', transport: 'transcript-resume' },
    });
    render(<ShipInboxPage onNavigate={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'reply…' }));
    fireEvent.change(screen.getByLabelText(/Reply to question/), { target: { value: 'use staging' } });
    fireEvent.click(screen.getByRole('button', { name: 'send reply' }));

    expect(await screen.findByText(/delivery failed: session is not in the live fleet/)).toBeInTheDocument();
  });

  it('questions with pending ask-human forms link to the Deck ask page', async () => {
    fetchItemsMock.mockResolvedValue({
      permissions: [],
      questions: [{ ...QUESTION, askHumanPending: ['auth-strategy'] } as ShipAgentQuestion],
      docs: [],
    });
    overviewMock.mockRejectedValue(new Error('no console station'));
    render(<ShipInboxPage onNavigate={vi.fn()} />);

    const link = await screen.findByText('answer questions: auth-strategy');
    expect(link).toHaveAttribute('href', `#/askhuman/${encodeURIComponent('/home/o/proj')}/auth-strategy`);
  });

  it('dismissing a question calls ack; doc items deep-link via onNavigate', async () => {
    primeDefaults();
    ackMock.mockResolvedValue({ ...QUESTION, status: 'acknowledged' });
    const onNavigate = vi.fn();
    render(<ShipInboxPage onNavigate={onNavigate} />);

    fireEvent.click(await screen.findByRole('button', { name: /Dismiss question/ }));
    await waitFor(() => expect(ackMock).toHaveBeenCalledWith('q-1'));

    fireEvent.click(screen.getByText('Which port?').closest('button')!);
    expect(onNavigate).toHaveBeenCalledWith('repo-a', 'doc-1');
  });

  it('shows the empty state and surfaces action errors without losing the page', async () => {
    fetchItemsMock.mockResolvedValue({ permissions: [PERMISSION], questions: [], docs: [] });
    overviewMock.mockRejectedValue(new Error('no console station'));
    decideMock.mockRejectedValue(new Error('settings.local.json is not valid JSON'));
    render(<ShipInboxPage onNavigate={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'allow' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not valid JSON/));
    // The queue is still rendered -- a failed rule write must stay actionable.
    expect(screen.getByRole('button', { name: 'allow' })).toBeInTheDocument();
  });

  it('renders the empty message when nothing needs a human', async () => {
    fetchItemsMock.mockResolvedValue({ permissions: [], questions: [], docs: [] });
    overviewMock.mockRejectedValue(new Error('no console station'));
    render(<ShipInboxPage onNavigate={vi.fn()} />);
    expect(await screen.findByText('Nothing needs your attention right now.')).toBeInTheDocument();
  });

  it('surfaces a fetch error', async () => {
    fetchItemsMock.mockRejectedValue(new Error('hull down'));
    overviewMock.mockRejectedValue(new Error('no console station'));
    render(<ShipInboxPage onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/hull down/)).toBeInTheDocument());
  });
});

describe('SessionsPanel (wave2-E: sessions become first-class on the inbox)', () => {
  it('lists watched sessions, sends free text to the exact session id, honest transport note', async () => {
    fetchItemsMock.mockResolvedValue({ permissions: [], questions: [], docs: [] });
    overviewMock.mockResolvedValue(OVERVIEW);
    sendMock.mockResolvedValue({ sessionId: 'sess-12345678', delivered: true, transport: 'transcript-resume' });
    render(<ShipInboxPage onNavigate={vi.fn()} />);

    expect(await screen.findByText('Tracked sessions')).toBeInTheDocument();
    expect(screen.getByText('proj worker')).toBeInTheDocument();
    // Hidden sessions are behind the toggle, not in the main list.
    expect(screen.queryByText('old worker')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'message…' }));
    fireEvent.change(screen.getByLabelText('Message to session proj worker'), {
      target: { value: 'wrap up and commit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    await waitFor(() => expect(sendMock).toHaveBeenCalledWith('sess-12345678', 'wrap up and commit'));
    expect(await screen.findByText(/Sent to the session’s transcript/)).toBeInTheDocument();
  });

  it('unwatch persists via the watch API and refreshes; hidden sessions can be rewatched', async () => {
    fetchItemsMock.mockResolvedValue({ permissions: [], questions: [], docs: [] });
    overviewMock.mockResolvedValue(OVERVIEW);
    watchMock.mockResolvedValue({ sessionId: 'sess-12345678', watched: false });
    render(<ShipInboxPage onNavigate={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Unwatch session proj worker' }));
    await waitFor(() => expect(watchMock).toHaveBeenCalledWith('sess-12345678', false));
    await waitFor(() => expect(overviewMock).toHaveBeenCalledTimes(2)); // refreshed after the flip

    // The rewatch affordance lives behind the unwatched toggle.
    fireEvent.click(screen.getByRole('button', { name: /show unwatched \(1\)/ }));
    watchMock.mockResolvedValue({ sessionId: 'sess-hidden-1', watched: true });
    fireEvent.click(screen.getByRole('button', { name: 'Rewatch session old worker' }));
    await waitFor(() => expect(watchMock).toHaveBeenCalledWith('sess-hidden-1', true));
  });

  it('renders nothing when no console station is mounted', async () => {
    fetchItemsMock.mockResolvedValue({ permissions: [], questions: [], docs: [] });
    overviewMock.mockRejectedValue(new Error('404'));
    render(<ShipInboxPage onNavigate={vi.fn()} />);
    await screen.findByText('Nothing needs your attention right now.');
    expect(screen.queryByText('Tracked sessions')).not.toBeInTheDocument();
  });
});

describe('suggestRule', () => {
  it('prefixes shell tools with the command first word, bare tool name otherwise', () => {
    expect(suggestRule('Bash', { command: 'git push origin' })).toBe('Bash(git:*)');
    expect(suggestRule('PowerShell', { command: 'pnpm test' })).toBe('PowerShell(pnpm:*)');
    expect(suggestRule('WebFetch', { url: 'https://x' })).toBe('WebFetch');
    expect(suggestRule('Bash', undefined)).toBe('Bash');
  });
});
