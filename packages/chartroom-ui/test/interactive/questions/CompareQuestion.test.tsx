import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskMeQuestion } from 'chartroom/interactive-blocks';
import { CompareQuestion } from '../../../src/components/questions/CompareQuestion.js';

afterEach(() => {
  cleanup();
});

function question(): AskMeQuestion {
  return {
    directiveId: 'q',
    type: 'compare',
    prompt: 'p',
    answered: false,
    blockRange: { start: 0, end: 0 },
    choices: [
      { value: 'a', label: 'Approach A', context: 'Some **bold** context.' },
      { value: 'b', label: 'Approach B' },
    ],
  };
}

describe('CompareQuestion (plan §8.3)', () => {
  it('renders one card per choice, with markdown context rendered (not raw)', () => {
    render(<CompareQuestion question={question()} value="" onChange={vi.fn()} />);
    expect(screen.getByText('Approach A')).toBeInTheDocument();
    expect(screen.getByText('Approach B')).toBeInTheDocument();
    expect(screen.getByText('bold')).toBeInTheDocument(); // rendered as a real <strong>, not "**bold**"
  });

  it('clicking a card calls onChange with that choice\'s value', () => {
    const onChange = vi.fn();
    render(<CompareQuestion question={question()} value="" onChange={onChange} />);
    fireEvent.click(screen.getByText('Approach B'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('the currently-selected card carries the selected class', () => {
    render(<CompareQuestion question={question()} value="a" onChange={vi.fn()} />);
    expect(screen.getByText('Approach A').closest('.question-compare__card')).toHaveClass('question-compare__card--selected');
    expect(screen.getByText('Approach B').closest('.question-compare__card')).not.toHaveClass(
      'question-compare__card--selected',
    );
  });

  it('pressing Enter on a focused card selects it (keyboard accessibility)', () => {
    const onChange = vi.fn();
    render(<CompareQuestion question={question()} value="" onChange={onChange} />);
    const card = screen.getByText('Approach A').closest('.question-compare__card') as HTMLElement;
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('a');
  });
});
