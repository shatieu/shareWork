import { useState, type ReactElement, type ReactNode } from 'react';
import { isKnownType, validateAnswerValue, type AskMeAnswerValue, type AskMeQuestion } from 'chartroom/interactive-blocks';
import { SingleSelectQuestion } from './questions/SingleSelectQuestion.js';
import { MultiSelectQuestion } from './questions/MultiSelectQuestion.js';
import { TextQuestion } from './questions/TextQuestion.js';
import { YesNoQuestion } from './questions/YesNoQuestion.js';
import { RatingQuestion } from './questions/RatingQuestion.js';
import { RankingQuestion } from './questions/RankingQuestion.js';
import { CompareQuestion } from './questions/CompareQuestion.js';

export interface AskMeBlockProps {
  /** The pre-parsed `AskMeQuestion` this directive instance corresponds to (looked up by `DocView`
   * from `extractInteractiveBlocks`'s own result, matched by the directive's own `id` attribute) --
   * `undefined` if no match was found (e.g. a directive missing its own `id`), in which case this
   * falls back to an inert passthrough of `children`, same posture as `DirectiveFallback`. */
  question?: AskMeQuestion;
  children?: ReactNode;
  onSubmit: (question: AskMeQuestion, value: AskMeAnswerValue) => Promise<void>;
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

/**
 * `:::ask-me` directive renderer (plan §4.3) -- receives the pre-parsed `AskMeQuestion` object
 * (from `extractInteractiveBlocks`, run once per doc render in `DocView`), not react-markdown's own
 * `children`/attribute props, since the structured `choices`/`min`/`max` shape needed for correct
 * widget selection isn't recoverable from react-markdown's default nested-element rendering of the
 * directive body. If already answered, renders the stored answer read-only (no widget). Dispatches
 * to one of seven per-type widgets, or a graceful "unknown question type" fallback for anything
 * `TYPE_ALIASES`/`KNOWN_TYPES` doesn't recognize (plan §1.1 item 4) -- never throws.
 */
export function AskMeBlock({ question, children, onSubmit }: AskMeBlockProps): ReactElement {
  const [value, setValue] = useState<AskMeAnswerValue>(() => (question ? initialValueFor(question) : ''));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!question) {
    return <div className="directive-fallback">{children}</div>;
  }

  const kicker = (state: string): ReactElement => (
    <div className="ask-me-block__kicker">
      <span className="ask-me-block__glyph" aria-hidden="true">
        ✦
      </span>
      <span className="ask-me-block__kind">
        ASK-ME · {state}
        {question.directiveId ? ` · ${question.directiveId}` : ''}
      </span>
    </div>
  );

  if (question.answered) {
    return (
      <section className="ask-me-block ask-me-block--answered">
        {kicker('ANSWERED')}
        <h3 className="ask-me-block__prompt">{question.prompt}</h3>
        <p className="ask-me-block__answer">{question.answerText}</p>
      </section>
    );
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(question as AskMeQuestion, value);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
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

  return (
    <section className="ask-me-block">
      {kicker('OPEN')}
      <h3 className="ask-me-block__prompt">{question.prompt}</h3>
      {widget}
      <div className="ask-me-block__actions">
        <button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit}>
          {submitting ? 'Submitting…' : 'Submit answer'}
        </button>
        {error && <p className="ask-me-block__error">{error}</p>}
      </div>
    </section>
  );
}
