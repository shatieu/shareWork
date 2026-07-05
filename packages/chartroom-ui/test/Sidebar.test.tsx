import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../src/components/Sidebar.js';
import type { DocSummary } from '../src/api/client.js';

afterEach(() => {
  cleanup();
});

const docs: DocSummary[] = [
  { id: 'doc-a', path: 'docs/a.md', title: 'Doc A' },
  { id: null, path: 'docs/no-id.md', title: 'No Id Doc' },
];

describe('Sidebar doc list (v1.1: id-less docs listed by path key)', () => {
  it('renders identified AND unidentified docs', () => {
    render(<Sidebar docs={docs} onSelectDoc={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Doc A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No Id Doc' })).toBeInTheDocument();
  });

  it('selecting an id-less doc navigates by its path key; ids stay canonical for identified docs', () => {
    const onSelectDoc = vi.fn();
    render(<Sidebar docs={docs} onSelectDoc={onSelectDoc} />);
    fireEvent.click(screen.getByRole('button', { name: 'No Id Doc' }));
    expect(onSelectDoc).toHaveBeenCalledWith('docs/no-id.md');
    fireEvent.click(screen.getByRole('button', { name: 'Doc A' }));
    expect(onSelectDoc).toHaveBeenCalledWith('doc-a');
  });

  it('marks the active doc by key, including path keys', () => {
    render(<Sidebar docs={docs} activeDocId="docs/no-id.md" onSelectDoc={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'No Id Doc' })).toHaveClass('sidebar__doc-link--active');
    expect(screen.getByRole('button', { name: 'Doc A' })).not.toHaveClass('sidebar__doc-link--active');
  });
});
