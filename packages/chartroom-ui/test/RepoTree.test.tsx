import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoTree, type RepoTreeProps } from '../src/components/RepoTree.js';
import type { DocSummary, RepoSummary } from '../src/api/client.js';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  window.localStorage.clear();
});

const repoA: RepoSummary = {
  id: 'repo-a',
  name: 'alpha',
  absPath: 'C:/repos/alpha',
  docCount: 3,
  brokenLinkCount: 2,
  needsYouCount: 3,
};

const repoB: RepoSummary = {
  id: 'repo-b',
  name: 'bravo',
  absPath: 'C:/repos/bravo',
  docCount: 0,
  brokenLinkCount: 0,
  needsYouCount: 0,
};

const docsA: DocSummary[] = [
  { id: 'doc-a', path: 'docs/a.md', title: 'Doc A' },
  { id: null, path: 'docs/no-id.md', title: 'No Id Doc' },
  { id: 'root-doc', path: 'readme.md', title: 'Readme' },
];

function renderTree(overrides: Partial<RepoTreeProps> = {}): RepoTreeProps {
  const props: RepoTreeProps = {
    repos: [repoA, repoB],
    docsByRepo: { 'repo-a': docsA },
    expandedRepos: new Set(['repo-a']),
    onToggleRepo: vi.fn(),
    onSelectDoc: vi.fn(),
    collapsed: false,
    onSetCollapsed: vi.fn(),
    onOpenClaude: vi.fn(),
    claudeBusyRepoId: null,
    onAddRepo: vi.fn(),
    ...overrides,
  };
  render(<RepoTree {...props} />);
  return props;
}

describe('RepoTree', () => {
  it('is an ARIA tree: treeitems with aria-expanded and nested groups', () => {
    renderTree();
    const tree = screen.getByRole('tree', { name: 'Repos and docs' });
    const repoItem = within(tree).getByRole('treeitem', { name: 'alpha' });
    expect(repoItem).toHaveAttribute('aria-expanded', 'true');
    expect(within(tree).getByRole('treeitem', { name: 'bravo' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(repoItem).getAllByRole('group').length).toBeGreaterThan(0);
    const folderItem = within(repoItem).getByRole('treeitem', { name: 'docs' });
    expect(folderItem).toHaveAttribute('aria-expanded', 'true');
  });

  it('toggles a repo row via onToggleRepo', () => {
    const props = renderTree();
    fireEvent.click(screen.getByRole('button', { name: 'alpha' }));
    expect(props.onToggleRepo).toHaveBeenCalledExactlyOnceWith('repo-a');
  });

  it('selecting a doc emits its route key: id when identified, path when id-less', () => {
    const props = renderTree();
    fireEvent.click(screen.getByRole('button', { name: /no-id\.md/ }));
    expect(props.onSelectDoc).toHaveBeenCalledWith('repo-a', 'docs/no-id.md');
    fireEvent.click(screen.getByRole('button', { name: /a\.md/ }));
    expect(props.onSelectDoc).toHaveBeenCalledWith('repo-a', 'doc-a');
  });

  it('marks the active doc row', () => {
    renderTree({ activeRepoId: 'repo-a', activeDocKey: 'doc-a' });
    expect(screen.getByRole('button', { name: /a\.md/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /no-id\.md/ })).not.toHaveAttribute('aria-current');
  });

  it('shows red broken-link and amber needs-you badges only when counts are non-zero', () => {
    renderTree();
    const badgeAlert = screen.getByTitle('2 broken links');
    expect(badgeAlert).toHaveClass('badge-alert');
    expect(badgeAlert).toHaveTextContent('2');
    const badgeNeeds = screen.getByTitle('3 items need you');
    expect(badgeNeeds).toHaveClass('badge-needs');
    expect(badgeNeeds).toHaveTextContent('3');
    // repo-b is clean -- exactly one badge of each kind in the whole tree
    expect(document.querySelectorAll('.badge-alert')).toHaveLength(1);
    expect(document.querySelectorAll('.badge-needs')).toHaveLength(1);
  });

  it('per-repo claude button calls back with the repo id and shows the busy state', () => {
    const props = renderTree({ claudeBusyRepoId: 'repo-b' });
    fireEvent.click(screen.getByRole('button', { name: 'Open Claude session in alpha' }));
    expect(props.onOpenClaude).toHaveBeenCalledExactlyOnceWith('repo-a');
    const busyButton = screen.getByRole('button', { name: 'Open Claude session in bravo' });
    expect(busyButton).toBeDisabled();
    expect(busyButton).toHaveTextContent('…');
  });

  it('indents folder and doc rows with the same paddingLeft scale (no marginLeft mix)', () => {
    renderTree();
    const folderRow = screen.getByRole('button', { name: /docs/ });
    expect(folderRow).toHaveStyle({ paddingLeft: '22px' });
    const nestedDoc = screen.getByRole('button', { name: /no-id\.md/ });
    expect(nestedDoc).toHaveStyle({ paddingLeft: '38px' });
    expect(nestedDoc.style.marginLeft).toBe('');
    const rootDoc = screen.getByRole('button', { name: /readme\.md/ });
    expect(rootDoc).toHaveStyle({ paddingLeft: '22px' });
  });

  it('head carries the + add button wired to onAddRepo (package 15)', () => {
    const props = renderTree();
    const addButton = screen.getByRole('button', { name: 'Add repo' });
    expect(addButton).toHaveTextContent('+ add');
    fireEvent.click(addButton);
    expect(props.onAddRepo).toHaveBeenCalledTimes(1);
  });

  it('collapsed rail: repo initials with an alert dot, expanding un-collapses', () => {
    const props = renderTree({ collapsed: true });
    const expand = screen.getByRole('button', { name: 'Expand repo panel' });
    fireEvent.click(expand);
    expect(props.onSetCollapsed).toHaveBeenCalledWith(false);
    const repoButton = screen.getByRole('button', { name: 'Expand alpha' });
    expect(repoButton.querySelector('.repo-rail__repo-badge')).not.toBeNull();
    fireEvent.click(repoButton);
    expect(props.onToggleRepo).not.toHaveBeenCalled(); // already expanded
  });
});
