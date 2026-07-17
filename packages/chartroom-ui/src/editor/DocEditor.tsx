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
import { editorViewCtx, type Editor } from '@milkdown/kit/core';
import {
  buildDocNodeFromBlocks,
  buildUncreatedEditor,
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

function EditorInner({
  repoId,
  docId,
  docPath,
  docs,
  segmented,
  onSaveComplete,
}: {
  repoId: string;
  docId: string;
  docPath: string;
  docs: DocSummary[];
  segmented: SegmentedDocument;
  onSaveComplete: (newRaw: string) => void;
}): ReactElement {
  const [loading, getInstance] = useInstance();
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkPickerSelectedText, setLinkPickerSelectedText] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mountError, setMountError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEditor((root) => {
    const editor = buildUncreatedEditor(root, '');
    // `@milkdown/react`'s `useGetEditor` swallows `editor.create()` rejections into
    // `console.error` (read from its shipped lib during the wave2-A recon) — exactly how the
    // original "empty editor" bug shipped invisibly. Wrap `create` so any future mount failure
    // surfaces as a visible error state instead of console-only.
    const innerCreate = editor.create.bind(editor);
    // `create` is an own instance property assigned in Editor's constructor (confirmed in
    // @milkdown/core's shipped lib), so reassigning it works at runtime — only the published
    // type marks it readonly, hence the cast.
    (editor as { create: () => Promise<Editor> }).create = async () => {
      try {
        return await innerCreate();
      } catch (err) {
        setMountError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    };
    return editor;
  }, []);

  // Splices the initial document into the live editor once it exists (and re-splices when `raw` —
  // and therefore `segmented` — changes, e.g. the post-save refresh). The document is built with
  // `buildDocNodeFromBlocks` against the LIVE editor instance's own schema, via lenient
  // `NodeType.create` — deliberately never handed across as JSON: Milkdown resolves a
  // `{ type: 'json' }` DefaultValue through prosemirror-model's strict `Node.fromJSON`, whose attr
  // validation rejects Milkdown's own parser-produced list `spread` attr shape (string, schema
  // says boolean) and crashed mount for any doc containing a list — the wave2-A "edit makes all
  // text disappear" bug (see `listAttrCompat.ts` and `.ship-crew/exchange/wave2-a/findings.md`).
  const splicedForRef = useRef<SegmentedDocument | null>(null);
  useEffect(() => {
    if (loading) return;
    const editor = getInstance();
    if (!editor) return;
    if (splicedForRef.current === segmented) return;
    try {
      editor.action((ctx) => {
        const engine = wrapEditorCtx(ctx);
        const built = buildDocNodeFromBlocks(engine, segmented.blocks);
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        view.dispatch(
          state.tr
            .replaceWith(0, state.doc.content.size, built.content)
            .setMeta('addToHistory', false),
        );
      });
      splicedForRef.current = segmented;
    } catch (err) {
      setMountError(err instanceof Error ? err.message : String(err));
    }
  }, [loading, getInstance, segmented]);

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
      {mountError && (
        <div className="doc-editor__mount-error" role="alert">
          The editor failed to load this document (its content is safe and untouched on disk):{' '}
          {mountError}
        </div>
      )}
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
  // Pure, synchronous, Milkdown-independent segmentation — recomputed only when `raw` changes.
  // The document itself is deliberately NOT pre-built here: it is constructed against the live
  // editor's own schema and spliced in by `EditorInner`'s effect (see the comment there for why
  // the old headless-engine → `toJSON` → `defaultValueCtx { type: 'json' }` handoff was removed).
  const segmented = useMemo(() => segmentDocument(raw), [raw]);

  return (
    <MilkdownProvider>
      <EditorInner
        repoId={repoId}
        docId={docId}
        docPath={docPath}
        docs={docs}
        segmented={segmented}
        onSaveComplete={onSaveComplete}
      />
    </MilkdownProvider>
  );
}
