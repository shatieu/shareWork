import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import { visit } from 'unist-util-visit';
import GithubSlugger from 'github-slugger';

// Independent, pure pre-pass over the raw markdown (plan §1.6) -- parse-only, never stringified,
// structurally similar to (but not imported from) phase-1's markdown.ts::extractHeadings, extended
// to also capture heading depth and a slug. Uses the same remark stack already added for
// DocView's rendering pipeline (remark-gfm, remark-directive), plus remark-parse/unified (needed
// as direct dependencies here since pnpm's strict node_modules doesn't expose react-markdown's own
// transitive copies for direct import by this package).
const processor = unified().use(remarkParse).use(remarkGfm).use(remarkDirective);

// `remark-frontmatter` is deliberately not in this pipeline (plan §6.1: neither DocView's render
// pipeline nor this pre-pass needs to *parse* the YAML block, just skip it) -- without stripping
// it first, remark-parse's CommonMark setext-heading rule would misinterpret the frontmatter's
// closing `---` as turning the preceding YAML line into a spurious h2. Same
// `FRONTMATTER_RE`-style leading-block regex phase-1's frontmatter.ts uses, reimplemented as a
// 2-line local helper (not cross-package imported, same reasoning as the rest of this pre-pass).
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/;

function stripFrontmatter(raw: string): string {
  const match = FRONTMATTER_RE.exec(raw);
  return match ? raw.slice(match[0].length) : raw;
}

/** Minimal local node shape -- avoids depending directly on @types/mdast, mirroring phase-1's
 * markdown.ts's own convention. */
interface AstNode {
  type: string;
  value?: string;
  children?: AstNode[];
  depth?: number;
}

export interface TocEntry {
  depth: number;
  text: string;
  slug: string;
}

function nodeText(node: AstNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') {
    return node.value ?? '';
  }
  if (Array.isArray(node.children)) {
    return node.children.map(nodeText).join('');
  }
  return '';
}

/**
 * Heading depth/text/slug extraction. Slugs are computed via `github-slugger` -- `rehype-slug`'s
 * own underlying slug library (confirmed its own dependency, plan §1.6) -- with one slugger
 * instance per call so duplicate-heading-text de-duplication (`heading`, `heading-1`, ...) matches
 * `rehype-slug`'s own de-dup convention exactly, keeping TOC links and in-document anchor ids
 * (set by the real `rehype-slug` during DocView's render) always in agreement.
 */
export function extractToc(raw: string): TocEntry[] {
  const tree = processor.parse(stripFrontmatter(raw)) as unknown as AstNode;
  const slugger = new GithubSlugger();
  const entries: TocEntry[] = [];

  visit(tree as never, 'heading', (node: unknown) => {
    const heading = node as AstNode;
    const text = nodeText(heading).trim();
    entries.push({ depth: heading.depth ?? 1, text, slug: slugger.slug(text) });
  });

  return entries;
}
