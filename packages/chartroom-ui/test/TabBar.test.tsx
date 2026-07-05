import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TabBar, type DeckTab } from '../src/components/TabBar.js';

afterEach(() => {
  cleanup();
});

const tabs: DeckTab[] = [
  { id: 'docs', title: 'Docs' },
  { id: 'voyage', title: 'Voyage' },
];

describe('TabBar', () => {
  it('renders one tab per DeckTab entry inside a labelled tablist', () => {
    render(<TabBar tabs={tabs} activeTabId="docs" onSelect={vi.fn()} />);
    expect(screen.getByRole('tablist', { name: 'Deck stations' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Docs' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Voyage' })).toBeInTheDocument();
  });

  it('marks only the active tab (class + aria-selected)', () => {
    render(<TabBar tabs={tabs} activeTabId="voyage" onSelect={vi.fn()} />);
    const voyage = screen.getByRole('tab', { name: 'Voyage' });
    const docs = screen.getByRole('tab', { name: 'Docs' });
    expect(voyage).toHaveClass('tab-bar__tab--active');
    expect(voyage).toHaveAttribute('aria-selected', 'true');
    expect(docs).not.toHaveClass('tab-bar__tab--active');
    expect(docs).toHaveAttribute('aria-selected', 'false');
  });

  it('emits the clicked tab id via onSelect', () => {
    const onSelect = vi.fn();
    render(<TabBar tabs={tabs} activeTabId="docs" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Voyage' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('voyage');
    fireEvent.click(screen.getByRole('tab', { name: 'Docs' }));
    expect(onSelect).toHaveBeenLastCalledWith('docs');
  });

  it('renders a single Docs tab in standalone (no-hull) mode', () => {
    render(<TabBar tabs={[{ id: 'docs', title: 'Docs' }]} activeTabId="docs" onSelect={vi.fn()} />);
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.queryByRole('tab', { name: 'Voyage' })).not.toBeInTheDocument();
  });
});
