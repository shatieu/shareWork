import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkDirectiveRehype from 'remark-directive-rehype';
import rehypeSlug from 'rehype-slug';
import rehypeSectionize from '../rehype/rehype-sectionize.js';
// Phase 4 plan §2.1: a real, non-type-only cross-package import of `chartroom`'s own executable
// extraction/splice logic, verified safe against a real `vite build` (not just `tsc`) at the
// Developer stage's own mandated checkpoint -- see that report for the checkpoint's findings.
import {
  extractInteractiveBlocks,
  type AskMeAnswerValue as SharedAskMeAnswerValue,
  type AskMeQuestion,
  type CheckboxRef,
} from 'chartroom/interactive-blocks';
import {
  rawAssetUrl,
  resolveAuthorName,
  submitAskMeAnswer,
  toggleCheckbox,
  type DocDetail,
  type DocSummary,
} from '../api/client.js';
import { TombstoneBadge } from './TombstoneBadge.js';
import { BacklinksPanel } from './BacklinksPanel.js';
import { LlmBlock } from './LlmBlock.js';
import { HumanBlock } from './HumanBlock.js';
import { AskMeBlock } from './AskMeBlock.js';
import { ActionsBlock } from './ActionsBlock.js';
import { Checkbox } from './Checkbox.js';
import { DocEditor } from '../editor/DocEditor.js';

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
  docId: string;
  detail: DocDetail;
  /** Full per-repo doc list (already fetched by `App.tsx`), needed by the editor's Ctrl+K link
   * picker (plan §7) — reused verbatim, no new fetch. */
  docs: DocSummary[];
  onSelectDoc: (docId: string) => void;
  /** Called after a successful save so the host can re-fetch this doc's fresh detail (plan §8's
   * App.tsx wiring: "thread a save-completion callback... mirrors the existing re-fetch pattern"). */
  onSaved: () => void;
}

/**
 * Renders one doc (plan §3/§6): `ReactMarkdown` fed the doc's raw content (frontmatter stripped),
 * with the full directive + collapsing + slug pipeline, plus a tombstone-badge block and the
 * backlinks panel around it -- or, in edit mode (plan §3 phase-3 addition), `DocEditor`'s Milkdown
 * WYSIWYG view over the same `detail` prop.
 */
export function DocView({ repoId, docId, detail, docs, onSelectDoc, onSaved }: DocViewProps): ReactElement {
  const [isEditing, setIsEditing] = useState(false);
  const body = stripFrontmatter(detail.raw);
  const docDir = docDirOf(detail.doc.path);
  // Pre-parsed once per doc render (plan §4.3/§4.7) -- `AskMeBlock` is dispatched the structured
  // `AskMeQuestion` object looked up from here by directive id, never react-markdown's own
  // `children`/attribute props, since the `choices`/`min`/`max` shape isn't otherwise recoverable.
  const interactiveBlocks = useMemo(() => extractInteractiveBlocks(body), [body]);

  const handleToggleCheckbox = async (ref: CheckboxRef, checked: boolean): Promise<void> => {
    await toggleCheckbox(repoId, docId, ref.scope, checked, ref.checked);
    onSaved();
  };

  const handleSubmitAskMe = async (question: AskMeQuestion, value: SharedAskMeAnswerValue): Promise<void> => {
    const author = resolveAuthorName();
    await submitAskMeAnswer(repoId, docId, question.directiveId, value, author);
    onSaved();
  };

  // Render-order counter into `interactiveBlocks.checkboxes` (plan §4.3): both this counter and
  // `extractInteractiveBlocks`'s own array are driven by the identical document-order traversal,
  // skipping an ask-me block's own choice-list checkboxes entirely (never rendered here either,
  // since `AskMeBlock` dispatches to a structured widget instead of rendering `children` for an
  // unanswered question) -- so the Nth checkbox actually rendered always corresponds to
  // `checkboxes[N]`, with no separate scope-recomputation needed in `Checkbox` itself.
  let checkboxCursor = 0;

  const components: Components = {
    img({ src, alt, ...props }) {
      const resolvedSrc = typeof src === 'string' ? resolveImageSrc(repoId, docDir, src) : src;
      return <img src={resolvedSrc} alt={alt ?? ''} {...props} />;
    },
    input(props) {
      if (props.type !== 'checkbox') {
        return <input {...props} />;
      }
      const ref = interactiveBlocks.checkboxes[checkboxCursor];
      checkboxCursor += 1;
      return <Checkbox {...props} checkboxData={ref} onCheckToggle={handleToggleCheckbox} />;
    },
    // `remark-directive-rehype` produces non-standard tag names (llm, human, ask-me, actions, ...)
    // for parsed :::name directives -- react-markdown's `components` map dispatches on any
    // lowercase key exactly like it does for standard tags (plan §1.4). Cast needed since
    // `Components`'s own type is keyed against known HTML tag names only. Only `ask-me`/`actions`
    // change in this phase -- `llm`/`human` rendering stays completely untouched.
    ...({
      llm: LlmBlock,
      human: HumanBlock,
      'ask-me': (props: { id?: string; children?: ReactNode }) => (
        <AskMeBlock
          question={interactiveBlocks.askMe.find((q) => q.directiveId === props.id)}
          onSubmit={handleSubmitAskMe}
        >
          {props.children}
        </AskMeBlock>
      ),
      actions: (props: { children?: ReactNode }) => <ActionsBlock>{props.children}</ActionsBlock>,
    } as Partial<Components>),
  };

  return (
    <article className="doc-view">
      <div className="doc-view__header">
        <h1>{detail.doc.title}</h1>
        <button type="button" className="doc-view__edit-toggle" onClick={() => setIsEditing((v) => !v)}>
          {isEditing ? 'View' : 'Edit'}
        </button>
      </div>

      {detail.brokenLinks.length > 0 && (
        <div className="doc-view__tombstones">
          {detail.brokenLinks.map((issue, i) => (
            <TombstoneBadge key={`${issue.targetId}-${i}`} issue={issue} />
          ))}
        </div>
      )}

      {isEditing ? (
        <DocEditor
          repoId={repoId}
          docId={docId}
          docPath={detail.doc.path}
          raw={detail.raw}
          docs={docs}
          onSaveComplete={() => {
            onSaved();
          }}
        />
      ) : (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkDirective, remarkDirectiveRehype]}
          rehypePlugins={[rehypeSlug, rehypeSectionize]}
          components={components}
        >
          {body}
        </ReactMarkdown>
      )}

      <BacklinksPanel repoId={repoId} backlinks={detail.backlinks} onSelectDoc={onSelectDoc} />
    </article>
  );
}
