import type { ReactElement } from 'react';
import type { AskMeQuestion } from 'chartroom/interactive-blocks';

export interface YesNoQuestionProps {
  question: AskMeQuestion;
  value: string;
  onChange: (value: string) => void;
}

const OPTIONS: Array<{ value: 'yes' | 'no' | 'unsure'; label: string }> = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unsure', label: 'Unsure' },
];

/** Three toggle buttons -- mirrors `page.html.tmpl::renderYesNo` (plan §4.3). */
export function YesNoQuestion({ value, onChange }: YesNoQuestionProps): ReactElement {
  return (
    <div className="question-yesno">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`question-yesno__btn${value === opt.value ? ' question-yesno__btn--active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
