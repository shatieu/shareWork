import {
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkDirectiveRehype from 'remark-directive-rehype';
import rehypeSlug from 'rehype-slug';
import rehypeSectionize from '../rehype/rehype-sectionize.js';
// Phase 4 plan §2.1: a real, non-type-only cross-package import of `chartroom`'s own executable
// extraction/splice logic, verified safe against a real `vite build` (not just `tsc`).
import {
  extractInteractiveBlocks,
  type AskMeAnswerValue as SharedAskMeAnswerValue,
  type AskMeQuestion,
  type CheckboxRef,
} from 'chartroom/interactive-blocks';
import {
  docKeyOf,
  rawAssetUrl,
  resolveAuthorName,
  submitAskMeAnswer,
  toggleCheckbox,
  type BrokenLinkIssue,
  type DocDetail,
  type DocSummary,
} from '../api/client.js';
import { TombstoneBadge } from './TombstoneBadge.js';
import { BacklinksPanel } from './BacklinksPanel.js';
import { RefTag } from './RefTag.js';
import { LlmBlock } from './LlmBlock.js';
import { HumanBlock } from './HumanBlock.js';
import { AskMeBlock } from './AskMeBlock.js';
import { ActionsBlock } from './ActionsBlock.js';
import { Checkbox } from './Checkbox.js';
import { DocEditor, type DocEditorHandle } from '../editor/DocEditor.js';

// Matches a leading YAML frontmatter block.
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/;

function stripFrontmatter(raw: string): string {
  const match = FRONTMATTER_RE.exec(raw);
  return match ? raw.slice(match[0].length) : raw;
}

function isUrlOrAbsolute(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');
}

function resolveImageSrc(repoId: string, docDir: string, href: string): string {
  if (isUrlOrAbsolute(href)) return href;
  const joined = docDir ? `${docDir}/${href}` : href;
  const segments = joined.split('/').filter((segment) => segment.length > 0 && segment !== '.');
  return rawAssetUrl(repoId, segments.join('/'));
}

function docDirOf(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash === -1 ? '' : path.slice(0, lastSlash);
}

/** Resolves a relative `.md` href against the current doc's directory to a normalized
 * repo-relative path (handles `./`, `../`, bare siblings), matching phase-1's link-path
 * convention. */
function resolveRelativeDocPath(docDir: string, href: string): string {
  const base = docDir ? docDir.split('/') : [];
  const segments = [...base, ...href.split('/')];
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return out.join('/');
}

/** Strips query/fragment, percent-decoding, and backslashes from an as-written href, returning a
 * clean forward-slash path to resolve. */
function cleanHrefPath(href: string): string {
  let path = href.split(/[?#]/)[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    /* malformed escapes: resolve the literal text instead */
  }
  return path.replace(/\\/g, '/');
}

/** True for an unmodified left click — the only case the SPA intercepts. Modified clicks
 * (ctrl/cmd/shift/alt) and middle clicks fall through to the browser so "open in new tab/window"
 * works exactly like any normal link. */
function isPlainLeftClick(event: ReactMouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export interface DocViewProps {
  repoId: string;
  docId: string;
  detail: DocDetail;
  docs: DocSummary[];
  onSelectDoc: (docKey: string) => void;
  onSaved: () => void;
}

/**
 * Renders one doc on the brass-framed paper (design 2a center): meta row (id chip + path + edit),
 * then the full markdown pipeline with clickable in-app links (id-links, relative `.md` links,
 * broken-link tombstones, anchors, external), interactive checkboxes and ask-me widgets. Edit mode
 * swaps in `DocEditor` (Milkdown) over the same `detail`.
 */
export function DocView({ repoId, docId, detail, docs, onSelectDoc, onSaved }: DocViewProps): ReactElement {
  const [isEditing, setIsEditing] = useState(false);
  // The editor publishes its imperative save into this ref so the Save control can live up here
  // in the paper's meta header (next to the edit/view toggle) instead of inside the doc body.
  const editorHandleRef = useRef<DocEditorHandle | null>(null);
  const [saving, setSaving] = useState(false);
  const body = stripFrontmatter(detail.raw);
  const docDir = docDirOf(detail.doc.path);
  const interactiveBlocks = useMemo(() => extractInteractiveBlocks(body), [body]);

  const brokenById = useMemo(() => {
    const map = new Map<string, BrokenLinkIssue>();
    for (const issue of detail.brokenLinks) map.set(issue.targetId, issue);
    return map;
  }, [detail.brokenLinks]);

  // Map repo-relative doc path -> route key, for resolving relative `.md` links to in-app nav.
  const keyByPath = useMemo(() => {
    const map = new Map<string, string>();
    for (const doc of docs) map.set(doc.path, docKeyOf(doc));
    return map;
  }, [docs]);

  // Case-insensitive path map + basename index: humans write links from memory (wrong case,
  // repo-root-relative from a nested doc, bare filenames). Mirrors the CLI resolver's philosophy:
  // extra lookups are tried only when unambiguous.
  const keyByPathLower = useMemo(() => {
    const map = new Map<string, string>();
    for (const doc of docs) {
      const lower = doc.path.toLowerCase();
      if (!map.has(lower)) map.set(lower, docKeyOf(doc));
    }
    return map;
  }, [docs]);

  const keysByBasename = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const doc of docs) {
      const base = (doc.path.split('/').pop() ?? '').toLowerCase();
      const list = map.get(base) ?? [];
      list.push(docKeyOf(doc));
      map.set(base, list);
    }
    return map;
  }, [docs]);

  /** Resolves an as-written relative/root-relative `.md` href to a doc route key, trying:
   * doc-dir-relative → repo-root-relative → case-insensitive both → unique basename. */
  function resolveDocKeyForHref(target: string): string | undefined {
    const hrefPath = cleanHrefPath(target);
    const candidates = hrefPath.startsWith('/')
      ? [resolveRelativeDocPath('', hrefPath)]
      : [resolveRelativeDocPath(docDir, hrefPath), resolveRelativeDocPath('', hrefPath)];
    for (const candidate of candidates) {
      const exact = keyByPath.get(candidate);
      if (exact) return exact;
      const relaxed = keyByPathLower.get(candidate.toLowerCase());
      if (relaxed) return relaxed;
    }
    const base = (hrefPath.split('/').pop() ?? '').toLowerCase();
    const byName = keysByBasename.get(base);
    if (byName && byName.length === 1) return byName[0];
    return undefined;
  }

  /** Real hash-route href for an in-app doc link — gives the browser something meaningful for
   * ctrl/middle-click ("open in new tab"), right-click copy, and hover status. */
  function appHrefFor(docKey: string): string {
    return `#/repo/${encodeURIComponent(repoId)}/doc/${encodeURIComponent(docKey)}`;
  }

  function handleAppLinkClick(event: ReactMouseEvent<HTMLAnchorElement>, docKey: string): void {
    if (!isPlainLeftClick(event)) return; // browser handles new-tab/new-window natively
    event.preventDefault();
    onSelectDoc(docKey);
  }

  const handleToggleCheckbox = async (ref: CheckboxRef, checked: boolean): Promise<void> => {
    await toggleCheckbox(repoId, docId, ref.scope, checked, ref.checked);
    onSaved();
  };

  const handleSubmitAskMe = async (question: AskMeQuestion, value: SharedAskMeAnswerValue): Promise<void> => {
    const author = resolveAuthorName();
    await submitAskMeAnswer(repoId, docId, question.directiveId, value, author);
    onSaved();
  };

  let checkboxCursor = 0;

  function scrollToAnchor(hash: string): void {
    const id = decodeURIComponent(hash.slice(1));
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderAnchor({ href, title, children, node: _node, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }): ReactElement {
    const target = typeof href === 'string' ? href : '';

    // 1. external / mailto -> new tab
    if (isUrlOrAbsolute(target)) {
      return (
        <a href={target} target="_blank" rel="noreferrer noopener" title={title} {...rest}>
          {children}
        </a>
      );
    }

    // 2. anchor-only -> smooth-scroll in page
    if (target.startsWith('#')) {
      return (
        <a
          href={target}
          className="doc-link doc-link--anchor"
          onClick={(event) => {
            event.preventDefault();
            scrollToAnchor(target);
          }}
        >
          {children}
        </a>
      );
    }

    // 3. id-link: authored with a `title="id:<targetId>"` attribute
    const idMatch = typeof title === 'string' ? /^id:(.+)$/.exec(title.trim()) : null;
    if (idMatch) {
      const targetId = idMatch[1].trim();
      const broken = brokenById.get(targetId);
      if (broken) {
        const tip =
          broken.matchType === 'tombstone'
            ? `unresolved — id:${targetId} · last seen ${broken.lastPath ?? '?'}${broken.deletedAt ? ` · deleted ${broken.deletedAt}` : ''}`
            : `unresolved — id:${targetId}`;
        return (
          <span className="link--broken" tabIndex={0} role="link" aria-disabled="true">
            <span className="link--broken__warn" aria-hidden="true">
              ⚠
            </span>
            {children}
            <span className="idlink__tip">{tip}</span>
          </span>
        );
      }
      return (
        <a className="idlink" href={appHrefFor(targetId)} onClick={(event) => handleAppLinkClick(event, targetId)}>
          {children}
          <span className="idlink__tip">id:{targetId}</span>
        </a>
      );
    }

    // 4. relative `.md` link -> resolve to a repo-relative path, navigate in-app by its key
    if (/\.md(?:[?#].*)?$/i.test(target)) {
      const key = resolveDocKeyForHref(target);
      if (key) {
        return (
          <a className="doc-link" href={appHrefFor(key)} title={title} onClick={(event) => handleAppLinkClick(event, key)}>
            {children}
          </a>
        );
      }
      // unresolved relative doc -> broken styling
      return (
        <span className="link--broken" tabIndex={0} role="link" aria-disabled="true">
          <span className="link--broken__warn" aria-hidden="true">
            ⚠
          </span>
          {children}
          <span className="idlink__tip">unresolved — {resolveRelativeDocPath(docDir, cleanHrefPath(target))}</span>
        </span>
      );
    }

    // fallback: any other relative href, rendered as a plain paper link
    return (
      <a href={target} title={title} {...rest}>
        {children}
      </a>
    );
  }

  const components: Components = {
    a: renderAnchor,
    img({ src, alt, node: _node, ...props }) {
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

  const id = detail.id ?? null;

  return (
    <article className="doc-view">
      <div className="doc-meta">
        {id ? <RefTag id={id} /> : <span className="ref-tag ref-tag--none">id: — none</span>}
        <span className="doc-meta__path">{detail.doc.path}</span>
        <span className="doc-meta__spacer" />
        {isEditing && (
          <button
            type="button"
            className="doc-meta__save"
            disabled={saving}
            onClick={() => void editorHandleRef.current?.save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
        <button
          type="button"
          className={isEditing ? 'doc-meta__edit doc-meta__edit--active' : 'doc-meta__edit'}
          aria-pressed={isEditing}
          onClick={() => setIsEditing((v) => !v)}
        >
          {isEditing ? 'view' : '✎ edit'}
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
          handleRef={editorHandleRef}
          onSavingChange={setSaving}
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
