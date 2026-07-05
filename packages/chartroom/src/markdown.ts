import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import { visit } from 'unist-util-visit';

// Read-only AST pipeline. Never stringified back to markdown — see plan §1.1/§6.2: all writes are
// surgical string splices against the original raw text, never a re-render of the parsed tree.
const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml']);

/** Minimal local node shape — avoids depending directly on @types/mdast (a transitive type-only
 * package pnpm's strict linking doesn't guarantee is directly resolvable from this package).
 *
 * Exported (phase 3 plan §3.4 decision (b), approved in DECISIONS-NEEDED.md) so `chartroom-ui`'s
 * editor round-trip engine can share this exact offset-bearing node contract for its own
 * (separately-constructed, remark-directive-augmented) parse pipeline, rather than redefining an
 * equivalent shape a second time. */
export interface AstNode {
  type: string;
  value?: string;
  children?: AstNode[];
  depth?: number;
  url?: string;
  title?: string | null;
  position?: { start: { offset: number }; end: { offset: number } };
  /**
   * GFM task-list checkbox state (phase 4 plan §3.3, additive) -- `remark-gfm` sets this on a
   * `listItem` node (`true`/`false` for `- [x]`/`- [ ]`, `null`/`undefined` for a non-task-list
   * item). Optional and additive: no existing consumer of `AstNode` reads this field, so this is a
   * zero-behavior-change type widening, same category as phase 3's own `AstNode` export.
   */
  checked?: boolean | null;
}

export interface OffsetRange {
  start: number;
  end: number;
}

export interface LinkNodeInfo {
  href: string;
  titleAttr?: string;
  /** offset range of the whole link/image node in the raw source string. */
  position: OffsetRange;
  /**
   * offset range of just the url/href text within the raw source string, if it could be
   * determined (inline `(url "title")` syntax only — reference links and autolinks have no
   * separately-splicable url and yield undefined here; see plan §10 risk #3 — remark/mdast does
   * not expose a distinct sub-position for the url, so this is derived pragmatically by locating
   * the literal url text inside the parenthesized portion of the node's own source slice).
   */
  urlPosition?: OffsetRange;
}

/** Parse the *entire* raw file (including any frontmatter block) so all offsets are absolute
 * positions into the original raw string — required for byte-exact splicing later. */
export function parseDocument(raw: string): AstNode {
  return processor.parse(raw) as unknown as AstNode;
}

/** Exported alongside `AstNode` (see comment above) — a small, tested text-extraction helper
 * `chartroom-ui`'s segmentation module can reuse instead of re-deriving an equivalent walk. */
export function nodeText(node: AstNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') {
    return node.value ?? '';
  }
  if (Array.isArray(node.children)) {
    return node.children.map(nodeText).join('');
  }
  return '';
}

/** Exported alongside `AstNode`/`nodeText` — thin, safe wrapper around `unist-util-visit` typed
 * against this package's own `AstNode` shape. */
export function visitType(tree: AstNode, type: string, fn: (node: AstNode) => void): void {
  // unist-util-visit's types want a `unist` Node; our local AstNode is structurally compatible
  // for every shape we actually produce, so a single `any` cast here keeps every call site clean.
  visit(tree as never, type, fn as never);
}

/** Heading text, in document order. */
export function extractHeadings(raw: string): string[] {
  const tree = parseDocument(raw);
  const headings: string[] = [];
  visitType(tree, 'heading', (node) => {
    headings.push(nodeText(node).trim());
  });
  return headings;
}

function findUrlOffset(raw: string, whole: OffsetRange, url: string): OffsetRange | undefined {
  const nodeSlice = raw.slice(whole.start, whole.end);
  const parenOpen = nodeSlice.lastIndexOf('(');
  if (parenOpen === -1) {
    // Reference-style ([text][ref]) or autolink (<url>) — no parenthesized href to splice.
    return undefined;
  }
  const afterParen = nodeSlice.slice(parenOpen + 1);
  const urlIdx = afterParen.indexOf(url);
  if (urlIdx === -1) {
    return undefined;
  }
  const start = whole.start + parenOpen + 1 + urlIdx;
  return { start, end: start + url.length };
}

function toLinkNodeInfo(raw: string, node: AstNode): LinkNodeInfo | undefined {
  if (!node.position || typeof node.url !== 'string') return undefined;
  const position = { start: node.position.start.offset, end: node.position.end.offset };
  return {
    href: node.url,
    titleAttr: node.title ?? undefined,
    position,
    urlPosition: findUrlOffset(raw, position, node.url),
  };
}

/** All outbound link nodes (inline `[text](href "title")`, reference, and autolink forms), in
 * document order, with best-effort url sub-offsets for the inline form. */
export function extractLinks(raw: string): LinkNodeInfo[] {
  const tree = parseDocument(raw);
  const links: LinkNodeInfo[] = [];
  visitType(tree, 'link', (node) => {
    const info = toLinkNodeInfo(raw, node);
    if (info) links.push(info);
  });
  return links;
}

/** All image nodes (`![alt](href)`), in document order. */
export function extractImages(raw: string): LinkNodeInfo[] {
  const tree = parseDocument(raw);
  const images: LinkNodeInfo[] = [];
  visitType(tree, 'image', (node) => {
    const info = toLinkNodeInfo(raw, node);
    if (info) images.push(info);
  });
  return images;
}

/** First `# Heading` (ATX, level 1) found in the body, or undefined. */
export function extractFirstH1(raw: string): string | undefined {
  const tree = parseDocument(raw);
  let result: string | undefined;
  visitType(tree, 'heading', (node) => {
    if (result === undefined && node.depth === 1) {
      result = nodeText(node).trim();
    }
  });
  return result;
}
