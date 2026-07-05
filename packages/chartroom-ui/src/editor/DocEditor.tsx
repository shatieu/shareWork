// Milkdown WYSIWYG editor component (plan §1.5/§3/§6/§7): mounts the block-diff-and-splice
// round-trip engine (`roundTrip.ts`) behind a real Milkdown editor, houses the Ctrl+K link-picker
// keydown listener and the image paste/drop handler, and exposes an explicit Save action (plan
// §5.2 — not autosave) to the host's paper-header button via `handleRef`.
//
// Two deliberate departures from the original @milkdown/react implementation, both fixing
// "edit mode renders a blank document" (found in a real browser, reproduced in
// test/editor/editor-mount.test.tsx):
//  1. The editor lifecycle is managed manually with a ref + effect — under React 19,
//     `useEditor`/`<Milkdown/>` never mounted the editor at all AND silently swallowed the error
//     below, leaving an empty root div.
//  2. The initial document is built with the LIVE editor's own schema after `.create()` and
//     dispatched as a full-doc replace transaction — the previous headless-engine →
//     `doc.toJSON()` → `defaultValueCtx {type:'json'}` handoff crossed two schema instances and
//     threw `RangeError: Expected value of type boolean for attribute spread on type list_item`
//     for any document containing a list (ProseMirror attribute validation), i.e. almost every
//     real document.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type ReactElement,
} from 'react';
import type { Editor } from '@milkdown/kit/core';
import { editorViewCtx } from '@milkdown/kit/core';
import {
  buildDocNodeFromBlocks,
  buildUncreatedEditor,
  extractCurrentBlocks,
  reconstructFile,
  wrapEditorCtx,
} from './roundTrip.js';
import { segmentDocument } from './segmentBlocks.js';
import { createImageDropPasteHandlers } from './ImagePasteHandler.js';
import { insertMarkdownAtCursor } from './insertAtCursor.js';
import { LinkPickerModal } from './LinkPickerModal.js';
import { saveDoc, type DocSummary } from '../api/client.js';

/** Imperative surface the host (`DocView`) uses to trigger a save from its own header button. */
export interface DocEditorHandle {
  save: () => Promise<void>;
}

export interface DocEditorProps {
  repoId: string;
  docId: string;
  docPath: string;
  raw: string;
  docs: DocSummary[];
  /** Called after a successful save with the newly-saved raw text, so the host (`DocView`/`App`)
   * can refresh its own state (plan §5.1/§8's App.tsx wiring). */
  onSaveComplete: (newRaw: string) => void;
  /** Host-owned ref populated with `{ save }` while the editor is mounted (null before/after) —
   * lets the Save button live in the paper's meta header instead of inside the document body. */
  handleRef?: MutableRefObject<DocEditorHandle | null>;
  /** Mirrors the in-flight save state up to the host's header button. */
  onSavingChange?: (saving: boolean) => void;
}

export function DocEditor({
  repoId,
  docId,
  docPath,
  raw,
  docs,
  onSaveComplete,
  handleRef,
  onSavingChange,
}: DocEditorProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkPickerSelectedText, setLinkPickerSelectedText] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Synchronous, pure segmentation — the round-trip engine's source of truth for which blocks are
  // editable prose vs protected opaque bytes (reused verbatim at save time).
  const segmented = useMemo(() => segmentDocument(raw), [raw]);

  // Manual create/destroy of the interactive editor (see module doc comment). An in-flight create
  // that loses a race with cleanup (unmount, doc switch, StrictMode's dev double-invoke) destroys
  // its own instance instead of leaking it.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let cancelled = false;
    setEditorReady(false);
    setError(null);
    void (async () => {
      try {
        const editor = await buildUncreatedEditor(root, '').create();
        if (cancelled) {
          void editor.destroy();
          return;
        }
        // Build the initial doc from the segmented blocks using the LIVE editor's schema and swap
        // it in as one transaction (departure #2 in the module doc comment). No history plugin is
        // installed, so this initial replace can't be undone into an empty document.
        const engine = wrapEditorCtx(editor.ctx);
        const doc = buildDocNodeFromBlocks(engine, segmented.blocks);
        const view = editor.ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content));
        editorRef.current = editor;
        setEditorReady(true);
      } catch (err) {
        if (!cancelled) setError(`editor failed to start: ${String(err)}`);
      }
    })();
    return () => {
      cancelled = true;
      const editor = editorRef.current;
      editorRef.current = null;
      setEditorReady(false);
      if (editor) void editor.destroy();
    };
  }, [segmented]);

  const handleSave = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    setSaving(true);
    onSavingChange?.(true);
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
      onSavingChange?.(false);
    }
  }, [segmented, repoId, docId, onSaveComplete, onSavingChange]);

  // Publish the imperative save handle to the host's header button for the mounted lifetime.
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = { save: handleSave };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, handleSave]);

  const imagePasteHandlers = useMemo(() => {
    const editor = editorRef.current;
    if (!editorReady || !editor) return undefined;
    return createImageDropPasteHandlers(editor.ctx, { repoId, docId });
  }, [editorReady, repoId, docId]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      const editor = editorRef.current;
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
    const editor = editorRef.current;
    if (!editor) return;
    insertMarkdownAtCursor(editor.ctx, markdown);
  }

  return (
    <div className="doc-editor">
      <div className="doc-editor__bar">
        <span className="doc-editor__hint">Ctrl+K insert link · Ctrl+S save{saving ? ' · saving…' : ''}</span>
        {error && (
          <span className="doc-editor__error" role="alert">
            {error}
          </span>
        )}
      </div>
      <div
        className="doc-editor__surface"
        ref={rootRef}
        onKeyDown={handleKeyDown}
        onPaste={imagePasteHandlers?.onPaste}
        onDrop={imagePasteHandlers?.onDrop}
      />
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
