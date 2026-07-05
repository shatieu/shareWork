import type { ReactElement } from 'react';
import type { AskMeQuestion } from 'chartroom/interactive-blocks';

export interface TextQuestionProps {
  question: AskMeQuestion;
  value: string;
  onChange: (value: string) => void;
}

/** Plain textarea -- mirrors `page.html.tmpl::renderText` (plan §4.3). */
export function TextQuestion({ question, value, onChange }: TextQuestionProps): ReactElement {
  return (
    <textarea
      className="question-textarea"
      placeholder={question.placeholder ?? ''}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
