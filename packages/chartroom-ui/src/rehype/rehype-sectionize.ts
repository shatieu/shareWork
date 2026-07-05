// Hand-rolled rehype plugin (plan §1.5): a single linear pass over the hast root's children. On
// each heading node encountered, starts a new <details open><summary>{heading}</summary>...
// </details> wrapper and collects every subsequent sibling into it until the next heading of
// equal-or-shallower depth. Nesting (an h2 following an h1) naturally produces nested <details> by
// recursing the same grouping rule one level per depth-jump.
//
// Minimal local hast node shape -- avoids depending on `@types/hast` as a new package, mirroring
// phase-1's markdown.ts's own "minimal local node shape" convention for mdast.

export interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
  [key: string]: unknown;
}

function headingDepth(node: HastNode): number | undefined {
  if (node.type !== 'element' || typeof node.tagName !== 'string') return undefined;
  const match = /^h([1-6])$/.exec(node.tagName);
  return match ? Number(match[1]) : undefined;
}

function makeElement(tagName: string, properties: Record<string, unknown>, children: HastNode[]): HastNode {
  return { type: 'element', tagName, properties, children };
}

/**
 * Group a flat list of hast sibling nodes into a nested `<details>` structure. Pure function --
 * takes/returns plain hast-shaped objects, no DOM/React involved, so it's trivially unit-testable
 * (plan §8.1). A list with no heading nodes at all is returned unchanged (no spurious wrapping).
 */
export function groupIntoSections(nodes: HastNode[]): HastNode[] {
  const result: HastNode[] = [];
  let i = 0;

  while (i < nodes.length) {
    const node = nodes[i];
    const depth = headingDepth(node);

    if (depth === undefined) {
      result.push(node);
      i += 1;
      continue;
    }

    const sectionBody: HastNode[] = [];
    i += 1;
    while (i < nodes.length) {
      const nextDepth = headingDepth(nodes[i]);
      if (nextDepth !== undefined && nextDepth <= depth) break;
      sectionBody.push(nodes[i]);
      i += 1;
    }

    const nestedBody = groupIntoSections(sectionBody);
    const summary = makeElement('summary', {}, [node]);
    const details = makeElement('details', { open: true }, [summary, ...nestedBody]);
    result.push(details);
  }

  return result;
}

/** Unified/rehype plugin factory -- pass in `rehypePlugins` alongside `rehypeSlug` (which must run
 * first so the collapsed headings still carry their anchor `id`s). */
export default function rehypeSectionize() {
  return (tree: HastNode): void => {
    if (!Array.isArray(tree.children)) return;
    tree.children = groupIntoSections(tree.children);
  };
}
