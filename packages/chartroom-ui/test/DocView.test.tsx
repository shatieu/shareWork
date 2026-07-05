import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mocked so the checkbox-interactivity regression test below can render the *real* end-to-end
// pipeline (ReactMarkdown + remark-gfm parsing a genuine `- [ ]` checklist item, exactly the way
// production markdown does) without making a real network call when the click handler fires.
vi.mock('../src/api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client.js')>('../src/api/client.js');
  return {
    ...actual,
    toggleCheckbox: vi.fn().mockResolvedValue(undefined),
  };
});

import { DocView } from '../src/components/DocView.js';
import { toggleCheckbox, type DocDetail } from '../src/api/client.js';

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

  it('regression: a real GFM checklist item, parsed by the actual ReactMarkdown + remark-gfm pipeline, renders enabled and clickable', () => {
    // This is the true end-to-end reproduction of the reported bug: `mdast-util-to-hast` (bundled
    // transitively via `react-markdown`) hard-codes `disabled: true` in the hProperties of every
    // GFM task-list checkbox it emits, which flows through `DocView`'s own `input(props)` handler
    // into `<Checkbox {...props} .../>` verbatim. Unlike `Checkbox.test.tsx` (which constructs
    // `<Checkbox>` directly and previously never exercised that real `disabled` prop), this test
    // goes through the full real pipeline `DocView` actually uses in production.
    const rawWithChecklist: DocDetail = {
      doc: {
        path: 'doc-c.md',
        title: 'Doc C',
        headings: ['Doc C'],
        outbound: [],
      },
      raw: `---
id: doc-c
title: Doc C
---

# Doc C

- [ ] A bare checklist item
`,
      backlinks: [],
      brokenLinks: [],
    };

    render(<DocView repoId="repo-a" docId="doc-c" detail={rawWithChecklist} docs={[]} onSelectDoc={vi.fn()} onSaved={vi.fn()} />);

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    // The bug: react-markdown's default GFM rendering (and, before the fix, this app's own
    // `Checkbox` override) leaves this `disabled`, making it permanently unclickable in a real
    // browser (a disabled `<input>` never fires click/change events per the HTML spec).
    expect(checkbox.disabled).toBe(false);

    fireEvent.click(checkbox);
    expect(vi.mocked(toggleCheckbox)).toHaveBeenCalledWith('repo-a', 'doc-c', { directiveId: null, index: 0 }, true, false);
  });
});
