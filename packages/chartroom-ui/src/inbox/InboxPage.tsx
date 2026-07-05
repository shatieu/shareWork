import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  isKnownType,
  validateAnswerValue,
  type AskMeAnswerValue,
  type AskMeQuestion,
} from 'chartroom/interactive-blocks';
import { extractInteractiveBlocks } from 'chartroom/interactive-blocks';
import {
  fetchDoc,
  fetchInbox,
  resolveAuthorName,
  submitAskMeAnswer,
  type DocDetail,
  type InboxItem,
} from '../api/client.js';
import { SingleSelectQuestion } from '../components/questions/SingleSelectQuestion.js';
import { MultiSelectQuestion } from '../components/questions/MultiSelectQuestion.js';
import { TextQuestion } from '../components/questions/TextQuestion.js';
import { YesNoQuestion } from '../components/questions/YesNoQuestion.js';
import { RatingQuestion } from '../components/questions/RatingQuestion.js';
import { RankingQuestion } from '../components/questions/RankingQuestion.js';
import { CompareQuestion } from '../components/questions/CompareQuestion.js';

export interface AskSelection {
  repoId: string;
  docKey: string;
  directiveId: string;
}

export interface InboxPageProps {
  /** Deep-links to `#/repo/<repoId>/doc/<docKey>` (reader). */
  onNavigate: (repoId: string, docKey: string) => void;
  /** Pre-select a specific question (from a "Answer →" deep-link). */
  initialSelection?: AskSelection;
}

function initialValueFor(question: AskMeQuestion): AskMeAnswerValue {
  switch (question.type) {
    case 'multi-select':
      return [];
    case 'ranking':
      return (question.choices ?? []).map((c) => c.value);
    case 'rating':
      return Math.round(((question.min ?? 1) + (question.max ?? 10)) / 2);
    case 'text':
      return question.suggestedText ?? '';
    default:
      return '';
  }
}

function keyOf(item: InboxItem): string {
  return `${item.repoId}::${item.docId}::${item.directiveId}`;
}

function typeLabel(item: InboxItem): string {
  if (item.kind === 'actions') return 'action';
  return item.type ?? 'ask-me';
}

/**
 * The Ask screen (design 2b): three columns — left question queue, center brass-framed paper
 * answer panel, right IN CONTEXT panel. Reuses the existing answer-submission plumbing
 * (`submitAskMeAnswer`) and the per-type question widgets, restyled for the paper.
 */
export function InboxPage({ onNavigate, initialSelection }: InboxPageProps): ReactElement {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(
    initialSelection ? `${initialSelection.repoId}::${initialSelection.docKey}::${initialSelection.directiveId}` : null,
  );
  /** Per-repo queue filter (user feedback) -- null = all repos. */
  const [repoFilter, setRepoFilter] = useState<string | null>(initialSelection?.repoId ?? null);

  const refresh = (): void => {
    fetchInbox()
      .then(setItems)
      .catch((err: unknown) => setError(String(err)));
  };

  useEffect(() => {
    refresh();
  }, []);

  // Repos present in the queue, for the filter chips (stable order by name).
  const queueRepos = useMemo(() => {
    if (!items) return [];
    const byId = new Map<string, string>();
    for (const item of items) byId.set(item.repoId, item.repoName);
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const visibleItems = useMemo(() => {
    if (!items) return null;
    return repoFilter ? items.filter((item) => item.repoId === repoFilter) : items;
  }, [items, repoFilter]);

  // Default selection: the incoming deep-link, else the first (visible) ask-me item.
  const selected = useMemo(() => {
    if (!visibleItems) return null;
    const byKey = visibleItems.find((it) => keyOf(it) === selectedKey);
    if (byKey) return byKey;
    return visibleItems.find((it) => it.kind === 'ask-me') ?? visibleItems[0] ?? null;
  }, [visibleItems, selectedKey]);

  if (error) {
    return <p className="app-shell__error">{error}</p>;
  }
  if (!items || !visibleItems) {
    return <p className="inbox-page__loading">Loading The Ask…</p>;
  }

  const openCount = visibleItems.length;

  return (
    <>
      <nav className="panel ask-queue" aria-label="Question queue">
        <div className="ask-queue__head">
          <span className="ask-queue__glyph" aria-hidden="true">
            ✦
          </span>
          <h2 className="panel__label">From Claude · needs you</h2>
          <span className="chrome__spacer" />
          {openCount > 0 && <span className="badge-count">{openCount}</span>}
        </div>
        {queueRepos.length > 1 && (
          <div className="ask-queue__filters" role="group" aria-label="Filter by repo">
            <button
              type="button"
              className={repoFilter === null ? 'filter-chip filter-chip--on' : 'filter-chip'}
              aria-pressed={repoFilter === null}
              onClick={() => setRepoFilter(null)}
            >
              all
            </button>
            {queueRepos.map((repo) => (
              <button
                key={repo.id}
                type="button"
                className={repoFilter === repo.id ? 'filter-chip filter-chip--on' : 'filter-chip'}
                aria-pressed={repoFilter === repo.id}
                onClick={() => setRepoFilter((prev) => (prev === repo.id ? null : repo.id))}
              >
                {repo.name}
              </button>
            ))}
          </div>
        )}
        <div className="ask-queue__scroll">
          {visibleItems.length === 0 ? (
            <p className="inbox-page__empty">
              {repoFilter ? 'Nothing needs you in this repo.' : 'Nothing needs your attention right now.'}
            </p>
          ) : (
            visibleItems.map((item) => {
              const isSel = selected ? keyOf(item) === keyOf(selected) : false;
              return (
                <button
                  key={keyOf(item)}
                  type="button"
                  className={isSel ? 'ask-card ask-card--selected' : 'ask-card'}
                  aria-current={isSel ? 'true' : undefined}
                  onClick={() => setSelectedKey(keyOf(item))}
                >
                  <div className="ask-card__meta">
                    <span className="ask-card__repo">{item.repoName}</span>
                    <span className="ask-card__dot">·</span>
                    <span className="ask-card__doc">{item.docPath}</span>
                    <span className="ask-card__spacer" />
                    <span className="ask-card__type">{typeLabel(item)}</span>
                  </div>
                  <div className="ask-card__text">{item.label}</div>
                  <div className="ask-card__state ask-card__state--open">● awaiting you</div>
                </button>
              );
            })
          )}
        </div>
        <div className="ask-queue__footer">
          {repoFilter
            ? `unanswered ask-me + actions in ${queueRepos.find((r) => r.id === repoFilter)?.name ?? repoFilter}`
            : 'unanswered ask-me + actions across all repos'}
        </div>
      </nav>

      <main className="paper-frame">
        <div className="paper">
          {selected ? (
            <AnswerPanel key={keyOf(selected)} item={selected} onAnswered={refresh} onOpenReader={onNavigate} />
          ) : (
            <div className="paper-empty">
              <h1>The Ask</h1>
              <p>No open questions. When Claude needs a decision, it shows up here.</p>
            </div>
          )}
        </div>
      </main>

      {selected && (
        <aside className="panel ask-context" aria-label="In context">
          <div>
            <h2 className="panel__label">In context</h2>
            <p className="ask-context__doc" style={{ marginTop: 12 }}>
              {selected.docPath}
            </p>
            <p className="ask-context__repo">{selected.repoName}</p>
            <p className="ask-context__excerpt">{selected.label}</p>
            <button
              type="button"
              className="ask-context__open"
              onClick={() => onNavigate(selected.repoId, selected.docId)}
            >
              open in reader →
            </button>
          </div>
          <div className="ask-context__divider" />
          <div>
            <h2 className="panel__label">Schema</h2>
            <div className="frontmatter__rows" style={{ marginTop: 12 }}>
              <div>
                <span className="frontmatter__key">id</span>
                {selected.directiveId}
              </div>
              <div>
                <span className="frontmatter__key">type</span>
                {typeLabel(selected)}
              </div>
              <div>
                <span className="frontmatter__key">src</span>
                ask-human schema
              </div>
            </div>
          </div>
          <div className="ask-context__divider" />
          <p className="ask-context__note">
            Same inbox the fleet approval queue plugs into — answers write back into the doc itself.
          </p>
        </aside>
      )}
    </>
  );
}

/** Loads the selected item's doc detail, extracts its `AskMeQuestion`, and renders the answer
 * widget on the paper. Actions items simply link to the reader (checked off in context). */
function AnswerPanel({
  item,
  onAnswered,
  onOpenReader,
}: {
  item: InboxItem;
  onAnswered: () => void;
  onOpenReader: (repoId: string, docKey: string) => void;
}): ReactElement {
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setLoadError(null);
    fetchDoc(item.repoId, item.docId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [item.repoId, item.docId]);

  const question = useMemo(() => {
    if (!detail || item.kind !== 'ask-me') return null;
    const blocks = extractInteractiveBlocks(detail.raw);
    return blocks.askMe.find((q) => q.directiveId === item.directiveId) ?? null;
  }, [detail, item]);

  const metaRow = (
    <div className="ask-paper__meta">
      <span className="ref-tag">
        {item.repoName} · {item.docPath}
      </span>
      <span className="ask-paper__type">{typeLabel(item)}</span>
      <span className="ask-paper__sub">{item.directiveId} · asked by claude</span>
    </div>
  );

  if (loadError) {
    return (
      <div className="ask-paper">
        {metaRow}
        <p className="ask-paper__error">{loadError}</p>
      </div>
    );
  }

  if (item.kind === 'actions') {
    return (
      <div className="ask-paper">
        {metaRow}
        <div className="ask-paper__kicker">✦ Action</div>
        <h1 className="ask-paper__question">{item.label}</h1>
        <p className="ask-paper__sub">This is a checklist action — check it off in the reader, where it lives in context.</p>
        <div className="ask-paper__grow" />
        <div className="ask-paper__submit">
          <button type="button" className="btn-rust" onClick={() => onOpenReader(item.repoId, item.docId)}>
            Open in reader →
          </button>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="ask-paper">
        {metaRow}
        <p className="ask-paper__loading">Loading question…</p>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="ask-paper">
        {metaRow}
        <p className="ask-paper__none">This question is no longer open — it may already be answered.</p>
        <div className="ask-paper__grow" />
        <div className="ask-paper__submit">
          <button type="button" className="btn-rust" onClick={() => onOpenReader(item.repoId, item.docId)}>
            Open in reader →
          </button>
        </div>
      </div>
    );
  }

  return (
    <QuestionForm
      question={question}
      metaRow={metaRow}
      docPath={item.docPath}
      onSubmit={async (value) => {
        const author = resolveAuthorName();
        await submitAskMeAnswer(item.repoId, item.docId, question.directiveId, value, author);
        onAnswered();
      }}
    />
  );
}

function QuestionForm({
  question,
  metaRow,
  docPath,
  onSubmit,
}: {
  question: AskMeQuestion;
  metaRow: ReactElement;
  docPath: string;
  onSubmit: (value: AskMeAnswerValue) => Promise<void>;
}): ReactElement {
  const [value, setValue] = useState<AskMeAnswerValue>(() => initialValueFor(question));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (question.answered || done) {
    return (
      <div className="ask-paper">
        {metaRow}
        <div className="ask-paper__kicker">✦ Question</div>
        <h1 className="ask-paper__question">{question.prompt}</h1>
        <div className="ask-paper__grow" />
        <div className="ask-paper__answered">
          <strong>✓ Answer recorded</strong>
          {question.answerText ? ` — ${question.answerText}.` : '.'}{' '}
          <span className="ask-paper__answered-note">
            written into {docPath} as an in-doc block · answered="true" · Claude reads it on next Read.
          </span>
        </div>
      </div>
    );
  }

  let widget: ReactElement;
  switch (question.type) {
    case 'single-select':
      widget = <SingleSelectQuestion question={question} value={value as string} onChange={setValue} />;
      break;
    case 'multi-select':
      widget = <MultiSelectQuestion question={question} value={value as string[]} onChange={setValue} />;
      break;
    case 'text':
      widget = <TextQuestion question={question} value={value as string} onChange={setValue} />;
      break;
    case 'yesno':
      widget = <YesNoQuestion question={question} value={value as string} onChange={setValue} />;
      break;
    case 'rating':
      widget = <RatingQuestion question={question} value={value as number} onChange={setValue} />;
      break;
    case 'ranking':
      widget = <RankingQuestion question={question} value={value as string[]} onChange={setValue} />;
      break;
    case 'compare':
      widget = <CompareQuestion question={question} value={value as string} onChange={setValue} />;
      break;
    default:
      widget = <p className="ask-me-block__unknown-type">Unknown question type: &quot;{question.type}&quot;</p>;
      break;
  }

  const canSubmit = isKnownType(question.type) && validateAnswerValue(question, value) && !submitting;

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(value);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ask-paper">
      {metaRow}
      <div className="ask-paper__kicker">✦ Question</div>
      <h1 className="ask-paper__question">{question.prompt}</h1>
      <div className="ask-paper__kicker">Your answer</div>
      {widget}
      {error && <p className="ask-paper__error">{error}</p>}
      <div className="ask-paper__submit">
        <button type="button" className="question-submit" onClick={() => void handleSubmit()} disabled={!canSubmit}>
          {submitting ? 'Submitting…' : `Submit & write to ${docPath} →`}
        </button>
      </div>
      <div className="ask-paper__grow" />
      <div className="ask-paper__footer">
        <span>Answer writes back into the doc — self-documenting, no external store.</span>
      </div>
    </div>
  );
}
