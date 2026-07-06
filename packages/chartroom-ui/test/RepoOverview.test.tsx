import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepoSummary } from '../src/api/client.js';
import { RepoOverview, type RepoOverviewProps } from '../src/components/RepoOverview.js';

afterEach(() => {
  cleanup();
});

const repoA: RepoSummary = {
  id: 'repo-a',
  name: 'alpha',
  absPath: 'C:/repos/alpha',
  docCount: 3,
  brokenLinkCount: 2,
  needsYouCount: 1,
};

const repoB: RepoSummary = {
  id: 'repo-b',
  name: 'bravo',
  absPath: 'C:/repos/bravo',
  docCount: 1,
  brokenLinkCount: 0,
  needsYouCount: 0,
};

function renderOverview(overrides: Partial<RepoOverviewProps> = {}): RepoOverviewProps {
  const props: RepoOverviewProps = {
    repos: [repoA, repoB],
    onSelect: vi.fn(),
    onAddRepo: vi.fn(),
    onOpenClaude: vi.fn(),
    claudeBusyRepoId: null,
    ...overrides,
  };
  render(<RepoOverview {...props} />);
  return props;
}

describe('RepoOverview', () => {
  it('renders one card per repo with name, path, and doc count from the /api/repos summary', () => {
    renderOverview();
    expect(screen.getByRole('heading', { name: 'Tracked repos' })).toBeInTheDocument();
    expect(screen.getByText('2 repos watched by the chart room. Pick one to browse its docs.')).toBeInTheDocument();

    const cardA = screen.getByRole('button', { name: 'Open alpha' });
    expect(within(cardA).getByText('C:/repos/alpha')).toBeInTheDocument();
    expect(within(cardA).getByText('3 docs')).toBeInTheDocument();
    const cardB = screen.getByRole('button', { name: 'Open bravo' });
    expect(within(cardB).getByText('1 doc')).toBeInTheDocument();
  });

  it('shows broken-link and needs-you badges only when non-zero', () => {
    renderOverview();
    const cardA = screen.getByRole('button', { name: 'Open alpha' });
    expect(within(cardA).getByTitle('2 broken links')).toHaveTextContent('2');
    expect(within(cardA).getByTitle('1 item need you')).toHaveTextContent('1');
    const cardB = screen.getByRole('button', { name: 'Open bravo' });
    expect(within(cardB).queryByTitle(/broken link/)).not.toBeInTheDocument();
    expect(within(cardB).queryByTitle(/need you/)).not.toBeInTheDocument();
  });

  it('card click selects that repo; the add button opens the modal flow', () => {
    const props = renderOverview();
    fireEvent.click(screen.getByRole('button', { name: 'Open bravo' }));
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith('repo-b');
    fireEvent.click(screen.getByRole('button', { name: '+ add repo' }));
    expect(props.onAddRepo).toHaveBeenCalledTimes(1);
  });

  it('per-card claude button opens a session and reflects the busy repo', () => {
    const props = renderOverview({ claudeBusyRepoId: 'repo-b' });
    fireEvent.click(screen.getByRole('button', { name: 'Open Claude session in alpha' }));
    expect(props.onOpenClaude).toHaveBeenCalledExactlyOnceWith('repo-a');
    expect(screen.getByRole('button', { name: 'Open Claude session in bravo' })).toBeDisabled();
  });
});
