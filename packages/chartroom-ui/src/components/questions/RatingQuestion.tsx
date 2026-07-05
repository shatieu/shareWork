import type { ReactElement } from 'react';
import type { AskMeQuestion } from 'chartroom/interactive-blocks';

export interface RatingQuestionProps {
  question: AskMeQuestion;
  value: number;
  onChange: (value: number) => void;
}

/** `<input type="range">` + live value display -- mirrors `page.html.tmpl::renderRating` (plan
 * §4.3). Bounds default to 1..10 (already applied by `extractInteractiveBlocks` itself, so this
 * widget only needs to fall back defensively if `min`/`max` are somehow still absent). */
export function RatingQuestion({ question, value, onChange }: RatingQuestionProps): ReactElement {
  const min = question.min ?? 1;
  const max = question.max ?? 10;

  return (
    <div className="question-rating">
      <div className="question-rating__value">{value}</div>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <div className="question-rating__labels">
        <span>{question.minLabel ?? min}</span>
        <span>{question.maxLabel ?? max}</span>
      </div>
    </div>
  );
}
