import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShipAgentQuestion, ShipInboxItems, ShipPermissionRequest } from '../../src/api/client.js';

const fetchItemsMock = vi.fn<() => Promise<ShipInboxItems>>();
const decideMock = vi.fn<(id: string, decision: unknown) => Promise<ShipPermissionRequest>>();
const ackMock = vi.fn<(id: string) => Promise<ShipAgentQuestion>>();

vi.mock('../../src/api/client.js', () => ({
  fetchShipInboxItems: (...args: unknown[]) => fetchItemsMock(...(args as [])),
  decideShipPermission: (...args: unknown[]) => decideMock(...(args as [string, unknown])),
  ackShipQuestion: (...args: unknown[]) => ackMock(...(args as [string])),
}));

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

describe('ShipInboxPage (plan 06 §1.6)', () => {
  it('renders all three sections of the one page', async () => {
    fetchItemsMock.mockResolvedValue(ITEMS);
    render(<ShipInboxPage onNavigate={vi.fn()} />);

    expect(await screen.findByText('Permission requests')).toBeInTheDocument();
    expect(screen.getByText('Agent questions')).toBeInTheDocument();
    expect(screen.getByText('Docs needing you')).toBeInTheDocument();
    expect(screen.getByText(/wants to run/)).toBeInTheDocument();
    expect(screen.getByText('Which deploy target?')).toBeInTheDocument();
    expect(screen.getByText('Which port?')).toBeInTheDocument();
  });

  it('allow/deny call the decision API and refetch', async () => {
    fetchItemsMock.mockResolvedValue(ITEMS);
    decideMock.mockResolvedValue({ ...PERMISSION, status: 'allowed' });
    const onChanged = vi.fn();
    render(<ShipInboxPage onNavigate={vi.fn()} onChanged={onChanged} />);

    fireEvent.click(await screen.findByRole('button', { name: 'allow' }));
    await waitFor(() => expect(decideMock).toHaveBeenCalledWith('perm-1', { behavior: 'allow', alwaysAllowRule: undefined }));
    await waitFor(() => expect(fetchItemsMock).toHaveBeenCalledTimes(2));
    expect(onChanged).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'deny' }));
    await waitFor(() => expect(decideMock).toHaveBeenCalledWith('perm-1', { behavior: 'deny', alwaysAllowRule: undefined }));
  });

  it('always allow opens the rule panel pre-filled with the suggestion and sends the edited rule', async () => {
    fetchItemsMock.mockResolvedValue(ITEMS);
    decideMock.mockResolvedValue({ ...PERMISSION, status: 'allowed' });
    render(<ShipInboxPage onNavigate={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'always allow…' }));
    const input = screen.getByLabelText('Permission rule') as HTMLInputElement;
    expect(input.value).toBe('Bash(git:*)'); // first-word suggestion from the command

    fireEvent.change(input, { target: { value: 'Bash(git push:*)' } });
    fireEvent.click(screen.getByRole('button', { name: 'allow + remember' }));
    await waitFor(() =>
      expect(decideMock).toHaveBeenCalledWith('perm-1', { behavior: 'allow', alwaysAllowRule: 'Bash(git push:*)' }),
    );
  });

  it('dismissing a question calls ack; doc items deep-link via onNavigate', async () => {
    fetchItemsMock.mockResolvedValue(ITEMS);
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
    decideMock.mockRejectedValue(new Error('settings.local.json is not valid JSON'));
    render(<ShipInboxPage onNavigate={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'allow' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not valid JSON/));
    // The queue is still rendered -- a failed rule write must stay actionable.
    expect(screen.getByRole('button', { name: 'allow' })).toBeInTheDocument();
  });

  it('renders the empty message when nothing needs a human', async () => {
    fetchItemsMock.mockResolvedValue({ permissions: [], questions: [], docs: [] });
    render(<ShipInboxPage onNavigate={vi.fn()} />);
    expect(await screen.findByText('Nothing needs your attention right now.')).toBeInTheDocument();
  });

  it('surfaces a fetch error', async () => {
    fetchItemsMock.mockRejectedValue(new Error('hull down'));
    render(<ShipInboxPage onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/hull down/)).toBeInTheDocument());
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
