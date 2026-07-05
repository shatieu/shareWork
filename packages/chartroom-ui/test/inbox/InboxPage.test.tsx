import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InboxItem } from '../../src/api/client.js';

const fetchInboxMock = vi.fn<() => Promise<InboxItem[]>>();

vi.mock('../../src/api/client.js', () => ({
  fetchInbox: (...args: unknown[]) => fetchInboxMock(...(args as [])),
}));

// Imported *after* the mock is registered (vi.mock is hoisted, so this is safe either way, but
// kept below for readability).
const { InboxPage } = await import('../../src/inbox/InboxPage.js');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ITEMS: InboxItem[] = [
  { repoId: 'repo-a', repoName: 'Repo A', docId: 'doc-1', docPath: 'doc-1.md', kind: 'ask-me', directiveId: 'q-1', label: 'Question one', type: 'text' },
  { repoId: 'repo-a', repoName: 'Repo A', docId: 'doc-2', docPath: 'doc-2.md', kind: 'actions', directiveId: 'action-1', label: 'Approve deploy' },
  { repoId: 'repo-b', repoName: 'Repo B', docId: 'doc-3', docPath: 'doc-3.md', kind: 'ask-me', directiveId: 'q-2', label: 'Question two', type: 'yesno' },
];

describe('InboxPage (plan §8.3)', () => {
  it('renders a fixture inbox response grouped by repo', async () => {
    fetchInboxMock.mockResolvedValue(ITEMS);
    render(<InboxPage onNavigate={vi.fn()} />);

    expect(await screen.findByText('Repo A')).toBeInTheDocument();
    expect(screen.getByText('Repo B')).toBeInTheDocument();
    expect(screen.getByText('Question one')).toBeInTheDocument();
    expect(screen.getByText('Approve deploy')).toBeInTheDocument();
    expect(screen.getByText('Question two')).toBeInTheDocument();
  });

  it('clicking an item deep-links via onNavigate(repoId, docId)', async () => {
    fetchInboxMock.mockResolvedValue(ITEMS);
    const onNavigate = vi.fn();
    render(<InboxPage onNavigate={onNavigate} />);

    const button = await screen.findByText('Approve deploy');
    fireEvent.click(button.closest('button')!);
    expect(onNavigate).toHaveBeenCalledWith('repo-a', 'doc-2');
  });

  it('shows an empty-state message when nothing needs attention', async () => {
    fetchInboxMock.mockResolvedValue([]);
    render(<InboxPage onNavigate={vi.fn()} />);
    expect(await screen.findByText('Nothing needs your attention right now.')).toBeInTheDocument();
  });

  it('surfaces a fetch error', async () => {
    fetchInboxMock.mockRejectedValue(new Error('network down'));
    render(<InboxPage onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
  });
});
