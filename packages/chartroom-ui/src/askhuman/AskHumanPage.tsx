import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { isKnownType, validateAnswerValue, type AskMeQuestion } from 'chartroom/interactive-blocks';
import {
  fetchAskHumanSpec,
  submitAskHumanAnswers,
  type AskHumanAnswerValue,
  type AskHumanSpecQuestion,
} from '../api/inboxClient.js';
import { SingleSelectQuestion } from '../components/questions/SingleSelectQuestion.js';
import { MultiSelectQuestion } from '../components/questions/MultiSelectQuestion.js';
import { TextQuestion } from '../components/questions/TextQuestion.js';
import { YesNoQuestion } from '../components/questions/YesNoQuestion.js';
import { RatingQuestion } from '../components/questions/RatingQuestion.js';
import { RankingQuestion } from '../components/questions/RankingQuestion.js';
import { CompareQuestion } from '../components/questions/CompareQuestion.js';

export interface AskHumanPageProps {
  /** The asking repo (the inbox question's cwd) -- specs live under
   * `<cwd>/.claude/ask-human/sessions/<sessionId>/`. */
  cwd: string;
  sessionId: string;
}

/** Spec question -> the AskMeQuestion shape the existing ship-styled widgets take (they mirror
 * the ask-human page renderers 1:1, so the vocabulary matches; `blockRange` is a doc-splice
 * concern that doesn't exist here). */
function toAskMeQuestion(spec: AskHumanSpecQuestion): AskMeQuestion {
  return {
    directiveId: spec.id,
    type: spec.type,
    prompt: spec.prompt,
    choices: spec.choices,
    min: spec.min,
    max: spec.max,
    minLabel: spec.minLabel,
    maxLabel: spec.maxLabel,
    placeholder: spec.placeholder,
    allowOther: spec.allowOther,
    suggestedText: spec.type === 'text' && typeof spec.suggested === 'string' ? spec.suggested : undefined,
    answered: false,
    blockRange: { start: 0, end: 0 },
  };
}

/** Initial value per type, honoring the spec's `suggested` pre-fill where its shape fits. */
function initialValueFor(spec: AskHumanSpecQuestion): AskHumanAnswerValue {
  const suggested = spec.suggested;
  switch (spec.type) {
    case 'multi-select':
      return Array.isArray(suggested) && suggested.every((v) => typeof v === 'string') ? suggested : [];
    case 'ranking': {
      const order = (spec.choices ?? []).map((c) => c.value);
      if (Array.isArray(suggested) && suggested.length === order.length && suggested.every((v) => order.includes(String(v)))) {
        return suggested as string[];
      }
      return order;
    }
    case 'rating': {
      if (typeof suggested === 'number') return suggested;
      return Math.round(((spec.min ?? 1) + (spec.max ?? 10)) / 2);
    }
    case 'text':
      return typeof suggested === 'string' ? suggested : '';
    default:
      // single-select / compare / yesno: a string value (or empty until picked).
      return typeof suggested === 'string' ? suggested : '';
  }
}

interface WidgetProps {
  question: AskMeQuestion;
  value: AskHumanAnswerValue;
  onChange: (value: AskHumanAnswerValue) => void;
}

function Widget({ question, value, onChange }: WidgetProps): ReactElement {
  switch (question.type) {
    case 'single-select':
      return <SingleSelectQuestion question={question} value={value as string} onChange={onChange} />;
    case 'multi-select':
      return <MultiSelectQuestion question={question} value={value as string[]} onChange={onChange} />;
    case 'text':
      return <TextQuestion question={question} value={value as string} onChange={onChange} />;
    case 'yesno':
      return <YesNoQuestion question={question} value={value as string} onChange={onChange} />;
    case 'rating':
      return <RatingQuestion question={question} value={value as number} onChange={onChange} />;
    case 'ranking':
      return <RankingQuestion question={question} value={value as string[]} onChange={onChange} />;
    case 'compare':
      return <CompareQuestion question={question} value={value as string} onChange={onChange} />;
    default:
      return <p className="ask-me-block__unknown-type">Unknown question type: &quot;{question.type}&quot;</p>;
  }
}

/**
 * The Deck's ask-questions page (wave2-E item 4): renders a session's pending ask-human
 * `spec.json` with the EXISTING ship-styled question widgets (the same seven types the skill's
 * standalone page offers) and submits answers through the hull, which writes `answers.json`
 * byte-compatible with the skill's own server -- the asking session's readback is unchanged.
 * Attachment paste is deliberately not offered here (the skill's standalone page remains the
 * way to attach files); everything else is 1:1.
 */
export function AskHumanPage({ cwd, sessionId }: AskHumanPageProps): ReactElement {
  const [questions, setQuestions] = useState<AskHumanSpecQuestion[] | null>(null);
  const [values, setValues] = useState<Record<string, AskHumanAnswerValue>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAskHumanSpec(cwd, sessionId)
      .then((spec) => {
        if (cancelled) return;
        setQuestions(spec.questions);
        const initial: Record<string, AskHumanAnswerValue> = {};
        for (const question of spec.questions) initial[question.id] = initialValueFor(question);
        setValues(initial);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, sessionId]);

  const askMeQuestions = useMemo(() => (questions ?? []).map(toAskMeQuestion), [questions]);

  const allValid = useMemo(
    () =>
      askMeQuestions.length > 0 &&
      askMeQuestions.every((q) => isKnownType(q.type) && validateAnswerValue(q, values[q.directiveId])),
    [askMeQuestions, values],
  );

  const handleSubmit = useCallback(async () => {
    if (!questions) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitAskHumanAnswers(
        cwd,
        sessionId,
        // Spec order, exactly one answer per question -- mirrors the skill page's submit.
        questions.map((q) => ({ id: q.id, type: q.type, value: values[q.id] })),
      );
      setSavedPath(result.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [questions, cwd, sessionId, values]);

  if (error && questions === null) {
    return <p className="app-shell__error">{error}</p>;
  }
  if (questions === null) {
    return <p className="inbox-page__loading">Loading questions…</p>;
  }

  if (savedPath !== null) {
    return (
      <div className="inbox-page ship-askhuman">
        <h1>Questions from {sessionId}</h1>
        <p role="status">
          Answers saved to <code>{savedPath}</code>. Tell the session you&#8217;re done — it reads the
          answers back itself.
        </p>
        <a className="ship-inbox__btn" href="#/inbox">
          back to inbox
        </a>
      </div>
    );
  }

  return (
    <div className="inbox-page ship-askhuman">
      <h1>Questions from {sessionId}</h1>
      <p className="inbox-page__doc-path">{cwd}</p>
      {askMeQuestions.map((question, index) => {
        const spec = questions[index];
        return (
          <section key={question.directiveId} className="ask-me-block">
            {typeof spec.context === 'string' && spec.context.length > 0 && (
              <pre className="ship-inbox__preview ship-askhuman__context">
                <code>{spec.context}</code>
              </pre>
            )}
            <h3 className="ask-me-block__prompt">{question.prompt}</h3>
            <Widget
              question={question}
              value={values[question.directiveId]}
              onChange={(value) => setValues((prev) => ({ ...prev, [question.directiveId]: value }))}
            />
          </section>
        );
      })}
      <div className="ask-me-block__actions">
        <button type="button" onClick={() => void handleSubmit()} disabled={!allValid || submitting}>
          {submitting ? 'Submitting…' : 'Submit all answers'}
        </button>
        {error && (
          <p className="ask-me-block__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
