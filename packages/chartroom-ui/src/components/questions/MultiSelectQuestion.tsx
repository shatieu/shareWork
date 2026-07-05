import { useState, type ReactElement } from 'react';
import type { AskMeQuestion } from 'chartroom/interactive-blocks';

export interface MultiSelectQuestionProps {
  question: AskMeQuestion;
  value: string[];
  onChange: (value: string[]) => void;
}

/** Checkbox group + optional write-in "Other" -- mirrors `page.html.tmpl::renderMultiSelect` (plan
 * §4.3). The "Other" write-in text is tracked locally and appended to/removed from the submitted
 * `value` array as its own extra string entry, matching SCHEMA.md's own documented shape. */
export function MultiSelectQuestion({ question, value, onChange }: MultiSelectQuestionProps): ReactElement {
  const choices = question.choices ?? [];
  const [otherActive, setOtherActive] = useState(false);
  const [otherText, setOtherText] = useState('');

  function toggleChoice(choiceValue: string, checked: boolean): void {
    onChange(checked ? [...value, choiceValue] : value.filter((v) => v !== choiceValue));
  }

  function toggleOther(checked: boolean): void {
    setOtherActive(checked);
    if (!checked && otherText) {
      onChange(value.filter((v) => v !== otherText));
    } else if (checked && otherText) {
      onChange([...value, otherText]);
    }
  }

  function changeOtherText(text: string): void {
    const withoutOld = value.filter((v) => v !== otherText);
    setOtherText(text);
    onChange(otherActive && text ? [...withoutOld, text] : withoutOld);
  }

  return (
    <div className="question-choices">
      {choices.map((choice) => (
        <label key={choice.value} className="question-choice-row">
          <input
            type="checkbox"
            checked={value.includes(choice.value)}
            onChange={(e) => toggleChoice(choice.value, e.target.checked)}
          />
          {choice.label}
        </label>
      ))}
      {question.allowOther && (
        <label className="question-choice-row">
          <input type="checkbox" checked={otherActive} onChange={(e) => toggleOther(e.target.checked)} />
          Other
        </label>
      )}
      {question.allowOther && otherActive && (
        <input
          type="text"
          className="question-other-text"
          value={otherText}
          onChange={(e) => changeOtherText(e.target.value)}
          placeholder="Write your own..."
        />
      )}
    </div>
  );
}
