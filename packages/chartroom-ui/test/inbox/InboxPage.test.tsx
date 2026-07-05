import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocDetail, InboxItem } from '../../src/api/client.js';

const fetchInboxMock = vi.fn<() => Promise<InboxItem[]>>();
const fetchDocMock = vi.fn<(repoId: string, docKey: string) => Promise<DocDetail>>();
const submitAskMeAnswerMock = vi.fn();

vi.mock('../../src/api/client.js', () => ({
  fetchInbox: (...args: unknown[]) => fetchInboxMock(...(args as [])),
  fetchDoc: (...args: [string, string]) => fetchDocMock(...args),
  submitAskMeAnswer: (...args: unknown[]) => submitAskMeAnswerMock(...args),
  resolveAuthorName: () => 'tester',
}));

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

const DOC_1: DocDetail = {
  id: 'doc-1',
  key: 'doc-1',
  doc: { path: 'doc-1.md', title: 'Doc One', headings: [], outbound: [] },
  raw: `---\nid: doc-1\n---\n\n:::ask-me{id="q-1" type="text"}\nWhat is the rollback window?\n:::\n`,
  backlinks: [],
  brokenLinks: [],
};

describe('InboxPage — The Ask screen', () => {
  it('lists every open item in the queue', async () => {
    fetchInboxMock.mockResolvedValue(ITEMS);
    fetchDocMock.mockResolvedValue(DOC_1);
    render(<InboxPage onNavigate={vi.fn()} />);

    expect(await screen.findByRole('button', { name: /Question one/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve deploy/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Question two/ })).toBeInTheDocument();
  });

  it('auto-selects the first ask-me and renders its question on the paper', async () => {
    fetchInboxMock.mockResolvedValue(ITEMS);
    fetchDocMock.mockResolvedValue(DOC_1);
    render(<InboxPage onNavigate={vi.fn()} />);

    expect(await screen.findByText('What is the rollback window?')).toBeInTheDocument();
    expect(fetchDocMock).toHaveBeenCalledWith('repo-a', 'doc-1');
  });

  it('"open in reader →" deep-links via onNavigate(repoId, docKey)', async () => {
    fetchInboxMock.mockResolvedValue(ITEMS);
    fetchDocMock.mockResolvedValue(DOC_1);
    const onNavigate = vi.fn();
    render(<InboxPage onNavigate={onNavigate} />);

    const open = await screen.findByText('open in reader →');
    fireEvent.click(open);
    expect(onNavigate).toHaveBeenCalledWith('repo-a', 'doc-1');
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
