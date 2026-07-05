// Shared helper: inserts an arbitrary markdown snippet at the current cursor position by parsing
// it through Milkdown's own real parser (so the inserted node(s) are correctly-typed, not hand-
// constructed) and replacing the current selection with the parsed inline content — standard
// ProseMirror, not Milkdown-specific. Used by both the image-paste handler (plan §6.2) and the
// Ctrl+K link picker (plan §7), so the two features can't drift on how insertion actually happens.

import type { Ctx } from '@milkdown/kit/ctx';
import { editorViewCtx, parserCtx } from '@milkdown/kit/core';

export function insertMarkdownAtCursor(ctx: Ctx, markdown: string): void {
  const view = ctx.get(editorViewCtx);
  const parse = ctx.get(parserCtx);
  const parsedDoc = parse(markdown);
  const firstChild = parsedDoc.firstChild;
  const inlineContent = firstChild?.firstChild;
  if (!inlineContent) return;
  const { state } = view;
  const tr = state.tr.replaceSelectionWith(inlineContent, false);
  view.dispatch(tr);
  view.focus();
}
