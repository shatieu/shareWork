// Milkdown WYSIWYG editor component (plan §1.5/§3/§6/§7): mounts the block-diff-and-splice
// round-trip engine (`roundTrip.ts`) behind a real `@milkdown/react` editor, houses the Ctrl+K
// link-picker keydown listener and the image paste/drop handler, and exposes an explicit Save
// action (plan §5.2 — not autosave).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react';
import { editorViewCtx } from '@milkdown/kit/core';
import type { JSONRecord } from '@milkdown/kit/transformer';
import {
  buildDocNodeFromBlocks,
  buildUncreatedEditor,
  createHeadlessEngine,
  extractCurrentBlocks,
  reconstructFile,
  wrapEditorCtx,
} from './roundTrip.js';
import { segmentDocument, type SegmentedDocument } from './segmentBlocks.js';
import { createImageDropPasteHandlers } from './ImagePasteHandler.js';
import { insertMarkdownAtCursor } from './insertAtCursor.js';
import { LinkPickerModal } from './LinkPickerModal.js';
import { saveDoc, type DocSummary } from '../api/client.js';

export interface DocEditorProps {
  repoId: string;
  docId: string;
  docPath: string;
  raw: string;
  docs: DocSummary[];
  /** Called after a successful save with the newly-saved raw text, so the host (`DocView`/`App`)
   * can refresh its own state (plan §5.1/§8's App.tsx wiring). */
  onSaveComplete: (newRaw: string) => void;
}

/** Builds the initial ProseMirror doc JSON once per (repoId, docId, raw) — async because it needs
 * a short-lived headless Milkdown engine (destroyed immediately after) purely to obtain a `Schema`
 * instance before the real, interactive editor exists (a Schema is only produced by creating an
 * Editor, so *some* editor has to exist first — plan §3.1 step 4's "concatenate blocks" design). */
function useInitialDoc(raw: string): {
  ready: boolean;
  segmented: SegmentedDocument | null;
  initialJson: JSONRecord | null;
} {
  const [state, setState] = useState<{ segmented: SegmentedDocument; initialJson: JSONRecord } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    setState(null);
    void (async () => {
      const engine = await createHeadlessEngine();
      try {
        const segmented = segmentDocument(raw);
        const doc = buildDocNodeFromBlocks(engine, segmented.blocks);
        const initialJson = doc.toJSON() as JSONRecord;
        if (!cancelled) setState({ segmented, initialJson });
      } finally {
        await engine.destroy();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [raw]);

  return { ready: state !== null, segmented: state?.segmented ?? null, initialJson: state?.initialJson ?? null };
}

function EditorInner({
  repoId,
  docId,
  docPath,
  docs,
  segmented,
  initialJson,
  onSaveComplete,
}: {
  repoId: string;
  docId: string;
  docPath: string;
  docs: DocSummary[];
  segmented: SegmentedDocument;
  initialJson: JSONRecord;
  onSaveComplete: (newRaw: string) => void;
}): ReactElement {
  const [, getInstance] = useInstance();
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkPickerSelectedText, setLinkPickerSelectedText] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEditor(
    (root) => buildUncreatedEditor(root, { type: 'json', value: initialJson }),
    [initialJson],
  );

  const handleSave = useCallback(async () => {
    const editor = getInstance();
    if (!editor) return;
    setSaving(true);
    setError(null);
    try {
      const engine = wrapEditorCtx(editor.ctx);
      const liveDoc = editor.ctx.get(editorViewCtx).state.doc;
      const currentBlocks = extractCurrentBlocks(engine, liveDoc);
      const newRaw = reconstructFile(engine, segmented, currentBlocks);
      await saveDoc(repoId, docId, newRaw);
      onSaveComplete(newRaw);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [getInstance, segmented, repoId, docId, onSaveComplete]);

  const imagePasteHandlers = useMemo(() => {
    const editor = getInstance();
    if (!editor) return undefined;
    return createImageDropPasteHandlers(editor.ctx, { repoId, docId });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed each render is fine (cheap closures)
  }, [repoId, docId, getInstance]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      const editor = getInstance();
      if (editor) {
        const { state } = editor.ctx.get(editorViewCtx);
        const { from, to, empty } = state.selection;
        setLinkPickerSelectedText(empty ? undefined : state.doc.textBetween(from, to, ' '));
      }
      setLinkPickerOpen(true);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void handleSave();
    }
  }

  function handleInsertLink(markdown: string): void {
    const editor = getInstance();
    if (!editor) return;
    insertMarkdownAtCursor(editor.ctx, markdown);
  }

  return (
    <div className="doc-editor">
      <div className="doc-editor__toolbar">
        <button type="button" onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {error && <span className="doc-editor__error">{error}</span>}
      </div>
      <div
        className="doc-editor__surface"
        ref={containerRef}
        onKeyDown={handleKeyDown}
        onPaste={imagePasteHandlers?.onPaste}
        onDrop={imagePasteHandlers?.onDrop}
      >
        <Milkdown />
      </div>
      {linkPickerOpen && (
        <LinkPickerModal
          docs={docs}
          currentDocPath={docPath}
          selectedText={linkPickerSelectedText}
          onInsert={handleInsertLink}
          onClose={() => setLinkPickerOpen(false)}
        />
      )}
    </div>
  );
}

export function DocEditor({ repoId, docId, docPath, raw, docs, onSaveComplete }: DocEditorProps): ReactElement {
  const { ready, segmented, initialJson } = useInitialDoc(raw);

  if (!ready || !segmented || !initialJson) {
    return <p className="doc-editor__loading">Loading editor…</p>;
  }

  return (
    <MilkdownProvider>
      <EditorInner
        repoId={repoId}
        docId={docId}
        docPath={docPath}
        docs={docs}
        segmented={segmented}
        initialJson={initialJson}
        onSaveComplete={onSaveComplete}
      />
    </MilkdownProvider>
  );
}
