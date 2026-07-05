import type { ReactElement, KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import type { AskMeQuestion } from 'chartroom/interactive-blocks';

export interface CompareQuestionProps {
  question: AskMeQuestion;
  value: string;
  onChange: (value: string) => void;
}

/** Card grid, click-to-select -- mirrors `page.html.tmpl::renderCompare` (plan §4.3). Unlike
 * `page.html.tmpl` (which re-parses each card's `context` through a hand-rolled mini-markdown
 * regex), each card's `context` is rendered through `chartroom-ui`'s own already-bundled
 * `react-markdown` pipeline, since `extractInteractiveBlocks` kept it as real markdown source
 * rather than pre-rendering it server-side (plan §4.1's `compare` row). */
export function CompareQuestion({ question, value, onChange }: CompareQuestionProps): ReactElement {
  const choices = question.choices ?? [];

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>, choiceValue: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onChange(choiceValue);
    }
  }

  return (
    <div className="question-compare">
      {choices.map((choice) => (
        <div
          key={choice.value}
          className={`question-compare__card${value === choice.value ? ' question-compare__card--selected' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => onChange(choice.value)}
          onKeyDown={(e) => handleKeyDown(e, choice.value)}
        >
          <div className="question-compare__label">{choice.label}</div>
          {choice.context && (
            <div className="question-compare__context">
              <ReactMarkdown>{choice.context}</ReactMarkdown>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
