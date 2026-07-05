// Image paste/drop interception (plan §6.2/§1.6). Deliberately the primary design named in the
// plan rather than `@milkdown/plugin-upload`'s own interception: a plain DOM `onPaste`/`onDrop`
// handler on the editor container, reading `event.clipboardData`/`event.dataTransfer` directly —
// zero dependency on getting `@milkdown/plugin-upload`'s exact config-key shape right (confirmed
// during the API spike to be `uploadConfig`, exported from `@milkdown/kit/plugin/upload` — real,
// not just assumed — but the plan's own reasoning for preferring a hand-rolled interception still
// holds: this ~30-line path achieves the same acceptance criterion with strictly less API surface
// to get right, and was already the recommended default even once the config shape was confirmed).

import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent } from 'react';
import type { Ctx } from '@milkdown/kit/ctx';
import { uploadAsset } from '../api/client.js';
import { insertMarkdownAtCursor } from './insertAtCursor.js';

/** Pure DOM-data extraction — no fetch, no Milkdown — so it's trivially unit-testable on its own. */
export function extractImageFiles(dataTransfer: DataTransfer | null | undefined): File[] {
  if (!dataTransfer) return [];
  const files: File[] = [];
  if (dataTransfer.files && dataTransfer.files.length > 0) {
    for (const file of Array.from(dataTransfer.files)) {
      if (file.type.startsWith('image/')) files.push(file);
    }
    return files;
  }
  if (dataTransfer.items) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
  }
  return files;
}

export interface ImagePasteContext {
  repoId: string;
  docId: string;
  /** Called once per successfully uploaded image, with the markdown image syntax to insert. */
  onImageReady: (markdown: string) => void;
}

/**
 * Uploads every image file found, in order, and reports each one's insertable markdown syntax via
 * `onImageReady` (plan §6.2 step 3: `![alt](relativeHref)`, empty alt initially). Pure aside from
 * the `uploadAsset` network call, so this is the piece `ImagePasteHandler.test.ts` exercises with a
 * mocked `fetch` (plan §8's named test file).
 */
export async function handleImageFiles(files: File[], ctx: ImagePasteContext): Promise<void> {
  for (const file of files) {
    const { href } = await uploadAsset(ctx.repoId, ctx.docId, file);
    ctx.onImageReady(`![](${href})`);
  }
}

/**
 * A plain React `onPaste`/`onDrop` handler factory — intercepts only when image files are present
 * (`event.preventDefault()` to stop ProseMirror's own default paste handling *for image data
 * specifically*; a paste with no image files is never prevented, so ordinary text/markdown paste
 * continues through Milkdown's normal handling unaffected, per plan §1.6 step 1).
 */
export function createImageDropPasteHandlers(
  ctx: Ctx,
  imageContext: Omit<ImagePasteContext, 'onImageReady'>,
): {
  onPaste: (event: ReactClipboardEvent) => void;
  onDrop: (event: ReactDragEvent) => void;
} {
  const onImageReady = (markdown: string) => insertMarkdownAtCursor(ctx, markdown);

  function handle(dataTransfer: DataTransfer | null | undefined, event: { preventDefault: () => void }): void {
    const files = extractImageFiles(dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    void handleImageFiles(files, { ...imageContext, onImageReady }).catch((err: unknown) => {
      console.error('chartroom-ui: image upload failed', err);
    });
  }

  return {
    onPaste: (event) => handle(event.clipboardData, event),
    onDrop: (event) => handle(event.dataTransfer, event),
  };
}
