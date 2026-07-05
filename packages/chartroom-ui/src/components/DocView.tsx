import type { ReactElement } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkDirectiveRehype from 'remark-directive-rehype';
import rehypeSlug from 'rehype-slug';
import rehypeSectionize from '../rehype/rehype-sectionize.js';
import { rawAssetUrl, type DocDetail } from '../api/client.js';
import { TombstoneBadge } from './TombstoneBadge.js';
import { BacklinksPanel } from './BacklinksPanel.js';
import { LlmBlock } from './LlmBlock.js';
import { HumanBlock } from './HumanBlock.js';
import { DirectiveFallback } from './DirectiveFallback.js';

// Matches a leading YAML frontmatter block, same shape as phase-1's frontmatter.ts::FRONTMATTER_RE
// (deliberately reimplemented locally, not cross-package imported -- plan §6.1/§1.6: react-markdown
// doesn't need to *render* the block, just skip it, and this UI package never depends on
// `chartroom`'s internals). The already-parsed title/id come from the API response's `doc` field.
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/;

function stripFrontmatter(raw: string): string {
  const match = FRONTMATTER_RE.exec(raw);
  return match ? raw.slice(match[0].length) : raw;
}

function isUrlOrAbsolute(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');
}

/** Joins the current doc's directory with a written relative href, mirroring exactly the
 * relative-path convention phase-1's link-paths.ts::computeExpectedHref already encodes for links
 * (plan §4.1/§6.4) -- same mental model, no new logic invented. */
function resolveImageSrc(repoId: string, docDir: string, href: string): string {
  if (isUrlOrAbsolute(href)) return href; // URL images pass through untouched
  const joined = docDir ? `${docDir}/${href}` : href;
  const segments = joined.split('/').filter((segment) => segment.length > 0 && segment !== '.');
  return rawAssetUrl(repoId, segments.join('/'));
}

function docDirOf(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash === -1 ? '' : path.slice(0, lastSlash);
}

export interface DocViewProps {
  repoId: string;
  detail: DocDetail;
  onSelectDoc: (docId: string) => void;
}

/**
 * Renders one doc (plan §3/§6): `ReactMarkdown` fed the doc's raw content (frontmatter stripped),
 * with the full directive + collapsing + slug pipeline, plus a tombstone-badge block and the
 * backlinks panel around it.
 */
export function DocView({ repoId, detail, onSelectDoc }: DocViewProps): ReactElement {
  const body = stripFrontmatter(detail.raw);
  const docDir = docDirOf(detail.doc.path);

  const components: Components = {
    img({ src, alt, ...props }) {
      const resolvedSrc = typeof src === 'string' ? resolveImageSrc(repoId, docDir, src) : src;
      return <img src={resolvedSrc} alt={alt ?? ''} {...props} />;
    },
    // `remark-directive-rehype` produces non-standard tag names (llm, human, ask-me, ...) for
    // parsed :::name directives -- react-markdown's `components` map dispatches on any lowercase
    // key exactly like it does for standard tags (plan §1.4). Cast needed since `Components`'s own
    // type is keyed against known HTML tag names only.
    ...({
      llm: LlmBlock,
      human: HumanBlock,
      'ask-me': DirectiveFallback,
      actions: DirectiveFallback,
    } as Partial<Components>),
  };

  return (
    <article className="doc-view">
      <h1>{detail.doc.title}</h1>

      {detail.brokenLinks.length > 0 && (
        <div className="doc-view__tombstones">
          {detail.brokenLinks.map((issue, i) => (
            <TombstoneBadge key={`${issue.targetId}-${i}`} issue={issue} />
          ))}
        </div>
      )}

      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkDirective, remarkDirectiveRehype]}
        rehypePlugins={[rehypeSlug, rehypeSectionize]}
        components={components}
      >
        {body}
      </ReactMarkdown>

      <BacklinksPanel repoId={repoId} backlinks={detail.backlinks} onSelectDoc={onSelectDoc} />
    </article>
  );
}
