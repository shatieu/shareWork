// Mount-level regression tests for the wave2-A "edit makes all text disappear" bug
// (`.ship-crew/exchange/wave2-a/findings.md`): before the fix, `DocEditor` handed its initial
// document to the live Milkdown editor as `{ type: 'json' }`, Milkdown resolved it through
// prosemirror-model's strict `Node.fromJSON`, the list `spread` attr (string, schema said
// boolean) threw at mount, and `@milkdown/react` swallowed the rejection into `console.error` —
// toolbar rendered, editor surface stayed empty. These tests mount the REAL `DocEditor` (real
// Milkdown editor in jsdom, no mocks) and assert the text actually renders, catching the whole
// "create()/initial-doc failure → silently empty editor" class, plus a sweep over the full
// frontmatter + directive + list handoff.

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DocEditor } from '../../src/editor/DocEditor.js';

afterEach(cleanup);

function renderEditor(raw: string): ReturnType<typeof render> {
  return render(
    <DocEditor
      repoId="repo1"
      docId="doc1"
      docPath="notes/doc.md"
      raw={raw}
      docs={[]}
      onSaveComplete={() => {}}
    />,
  );
}

function surfaceText(container: HTMLElement): string {
  return container.querySelector('.doc-editor__surface')?.textContent ?? '';
}

describe('DocEditor mount (wave2-A regression)', () => {
  it('renders bullet-list text (the minimal repro that previously mounted empty)', async () => {
    const { container } = renderEditor('- one\n- two\n');
    await waitFor(() => {
      expect(surfaceText(container)).toContain('one');
    });
    expect(surfaceText(container)).toContain('two');
    expect(container.querySelector('.doc-editor__mount-error')).toBeNull();
  });

  it('mounts a whole realistic doc: frontmatter + directives + bullet/ordered/task lists (sweep)', async () => {
    const raw = [
      '---',
      'id: sweep-fixture',
      'title: Sweep',
      '---',
      '',
      '# Heading',
      '',
      'Intro paragraph.',
      '',
      ':::llm',
      'agent-only note',
      ':::',
      '',
      '- alpha',
      '- beta',
      '',
      '1. first',
      '2. second',
      '',
      '- [ ] todo item',
      '',
    ].join('\n');
    const { container } = renderEditor(raw);
    await waitFor(() => {
      const text = surfaceText(container);
      expect(text).toContain('Heading');
      expect(text).toContain('alpha');
      expect(text).toContain('first');
      expect(text).toContain('todo item');
    });
    // Frontmatter is stripped before segmentation — it must never appear in the editable surface.
    expect(surfaceText(container)).not.toContain('sweep-fixture');
    expect(container.querySelector('.doc-editor__mount-error')).toBeNull();
  });
});
