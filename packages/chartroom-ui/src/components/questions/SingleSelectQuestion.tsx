import { useState, type ReactElement } from 'react';
import type { AskMeQuestion } from 'chartroom/interactive-blocks';

export interface SingleSelectQuestionProps {
  question: AskMeQuestion;
  value: string;
  onChange: (value: string) => void;
}

/** Radio group + optional write-in "Other" text field -- mirrors `page.html.tmpl::renderSingleSelect`
 * (plan §4.3). `otherActive` is local, purely-presentational UI state (which radio is currently
 * selected); the actual submitted `value` is always either a known choice's own `value` or the
 * freeform "Other" text, never a sentinel. */
export function SingleSelectQuestion({ question, value, onChange }: SingleSelectQuestionProps): ReactElement {
  const choices = question.choices ?? [];
  const [otherActive, setOtherActive] = useState(false);
  const name = `ask-me-${question.directiveId}`;

  return (
    <div className="question-choices">
      {choices.map((choice) => (
        <label key={choice.value} className="question-choice-row">
          <input
            type="radio"
            name={name}
            checked={!otherActive && value === choice.value}
            onChange={() => {
              setOtherActive(false);
              onChange(choice.value);
            }}
          />
          {choice.label}
        </label>
      ))}
      {question.allowOther && (
        <label className="question-choice-row">
          <input
            type="radio"
            name={name}
            checked={otherActive}
            onChange={() => {
              setOtherActive(true);
              onChange('');
            }}
          />
          Other
        </label>
      )}
      {question.allowOther && otherActive && (
        <input
          type="text"
          className="question-other-text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Write your own..."
        />
      )}
    </div>
  );
}
