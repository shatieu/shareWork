import type { ReactElement } from 'react';

export interface RefTagProps {
  id: string;
}

/**
 * The recurring visual signature: a small monospace tag showing a doc's stable id -- the one
 * coordinate that survives a `git mv`. Appears anywhere a doc is referenced (sidebar row, doc
 * header, backlink entry) so the UI itself demonstrates Chart Room's actual novel mechanic
 * (resolve by id, not by path) rather than just describing it in prose.
 */
export function RefTag({ id }: RefTagProps): ReactElement {
  return <code className="ref-tag">id: {id}</code>;
}
