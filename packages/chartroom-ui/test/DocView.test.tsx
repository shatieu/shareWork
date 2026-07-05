import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocView } from '../src/components/DocView.js';
import type { DocDetail } from '../src/api/client.js';

// @testing-library/react doesn't auto-unmount between tests under vitest (that wiring is
// jest-specific) -- without this, each `render()` call in this file would leave its tree in the
// jsdom document, causing later `getByText` queries to match multiple stale elements.
afterEach(() => {
  cleanup();
});

const RAW = `---
id: doc-a
title: Doc A
---

# Doc A

Intro paragraph.

:::llm{tldr="Quick summary of doc A"}
Full detailed context that should be collapsed by default.
:::

:::human
Human-only note, always visible.
:::

:::ask-me
Some ask-me block content, unrecognized directive.
:::

See [Gone](gone.md "id:gone") for details.
`;

function fixtureDetail(): DocDetail {
  return {
    doc: {
      path: 'doc-a.md',
      title: 'Doc A',
      headings: ['Doc A'],
      outbound: [{ targetId: 'gone', hrefAsWritten: 'gone.md', stale: false }],
    },
    raw: RAW,
    backlinks: [{ id: 'doc-b', path: 'doc-b.md', title: 'Doc B' }],
    brokenLinks: [
      {
        path: 'doc-a.md',
        targetId: 'gone',
        hrefAsWritten: 'gone.md',
        matchType: 'tombstone',
        lastPath: 'gone.md',
        deletedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
}

describe('DocView', () => {
  it('renders tombstone text for a broken link', () => {
    render(<DocView repoId="repo-a" docId="doc-a" detail={fixtureDetail()} docs={[]} onSelectDoc={vi.fn()} onSaved={vi.fn()} />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('gone.md');
    expect(note).toHaveTextContent('missing');
    expect(note).toHaveTextContent('gone since 2026-01-01T00:00:00.000Z');
  });

  it("renders the :::llm block's tldr visible with its body inside a closed <details>", () => {
    const { container } = render(<DocView repoId="repo-a" docId="doc-a" detail={fixtureDetail()} docs={[]} onSelectDoc={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText('Quick summary of doc A')).toBeInTheDocument();
    const details = container.querySelector('details.llm-block__body');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveTextContent('Full detailed context that should be collapsed by default.');
  });

  it(':::human renders plainly, always visible, no collapsing chrome', () => {
    const { container } = render(<DocView repoId="repo-a" docId="doc-a" detail={fixtureDetail()} docs={[]} onSelectDoc={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText('Human-only note, always visible.')).toBeInTheDocument();
    expect(container.querySelector('.human-block details')).toBeNull();
  });

  it('an unrecognized directive (:::ask-me) renders its plain content without throwing', () => {
    render(<DocView repoId="repo-a" docId="doc-a" detail={fixtureDetail()} docs={[]} onSelectDoc={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText('Some ask-me block content, unrecognized directive.')).toBeInTheDocument();
  });

  it('backlinks panel lists the expected entries', () => {
    render(<DocView repoId="repo-a" docId="doc-a" detail={fixtureDetail()} docs={[]} onSelectDoc={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText('Doc B')).toBeInTheDocument();
  });

  it('frontmatter block is not rendered as visible content', () => {
    render(<DocView repoId="repo-a" docId="doc-a" detail={fixtureDetail()} docs={[]} onSelectDoc={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByText(/^id: doc-a/)).not.toBeInTheDocument();
  });
});
