import { useRef, type ReactElement } from 'react';
import type { AskMeQuestion } from 'chartroom/interactive-blocks';

export interface RankingQuestionProps {
  question: AskMeQuestion;
  value: string[];
  onChange: (value: string[]) => void;
}

/** Drag-reorder list + up/down buttons -- mirrors `page.html.tmpl::renderRanking`'s exact
 * interaction model (plan §4.3). `value` is the current ordered array of choice `value`s; the
 * source choice list itself is never rewritten, only the final order recorded in the answer. */
export function RankingQuestion({ question, value, onChange }: RankingQuestionProps): ReactElement {
  const labelByValue = new Map((question.choices ?? []).map((c) => [c.value, c.label]));
  const dragIndex = useRef<number | null>(null);

  function move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function handleDrop(overIndex: number): void {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === overIndex) return;
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(overIndex, 0, moved);
    onChange(next);
  }

  return (
    <ul className="question-ranking">
      {value.map((v, index) => (
        <li
          key={v}
          draggable
          onDragStart={() => {
            dragIndex.current = index;
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleDrop(index)}
        >
          <span className="question-ranking__handle" aria-hidden="true">
            ⣿
          </span>
          <span className="question-ranking__label">{labelByValue.get(v) ?? v}</span>
          <span className="question-ranking__buttons">
            <button type="button" onClick={() => move(index, -1)} aria-label="Move up" disabled={index === 0}>
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(index, 1)}
              aria-label="Move down"
              disabled={index === value.length - 1}
            >
              ↓
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
