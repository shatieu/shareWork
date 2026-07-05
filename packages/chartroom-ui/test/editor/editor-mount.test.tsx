// Regression test for the "edit mode renders a blank document" bug (wave-1 polish): the real,
// interactive DocEditor must actually render document content into the DOM the way a browser
// sees it. Two historical causes, both covered here:
//  1. `@milkdown/react`'s useEditor never mounted anything under React 19 (and swallowed errors);
//     DocEditor now manages the editor lifecycle manually.
//  2. The headless-engine → toJSON → defaultValueCtx handoff threw a ProseMirror attribute
//     validation RangeError for any doc containing a LIST — so the raw here deliberately includes
//     one, plus an opaque directive block.
import { describe, expect, it } from 'vitest';
import { useRef, type MutableRefObject } from 'react';
import { render, waitFor } from '@testing-library/react';
import { DocEditor, type DocEditorHandle } from '../../src/editor/DocEditor.js';

const RAW = [
  '# Hello Title',
  '',
  'Some visible paragraph text.',
  '',
  '- one',
  '- two',
  '',
  ':::llm{model="opus"}',
  'Protected directive body.',
  ':::',
  '',
].join('\n');

function Host({ onHandle }: { onHandle: (ref: MutableRefObject<DocEditorHandle | null>) => void }) {
  const handleRef = useRef<DocEditorHandle | null>(null);
  onHandle(handleRef);
  return (
    <DocEditor
      repoId="r1"
      docId="d1"
      docPath="notes/a.md"
      raw={RAW}
      docs={[]}
      onSaveComplete={() => {}}
      handleRef={handleRef}
    />
  );
}

describe('DocEditor real mount', () => {
  it('renders doc text (incl. a list) in the surface and publishes the save handle', async () => {
    let handleRef: MutableRefObject<DocEditorHandle | null> | undefined;
    const { container } = render(<Host onHandle={(ref) => (handleRef = ref)} />);

    await waitFor(
      () => {
        const surface = container.querySelector('.doc-editor__surface');
        expect(surface, 'surface should exist').toBeTruthy();
        const text = surface!.textContent ?? '';
        expect(text).toContain('Some visible paragraph text.');
        expect(text).toContain('one');
        // Opaque directive renders as the protected placeholder block, not editable prose.
        expect(container.querySelector('[data-chartroom-opaque]')).toBeTruthy();
        // The imperative save handle must be published for DocView's header Save button.
        expect(handleRef?.current?.save).toBeTypeOf('function');
        // And no mount error surfaced.
        expect(container.querySelector('.doc-editor__error')).toBeNull();
      },
      { timeout: 8000 },
    );
  }, 20000);
});
