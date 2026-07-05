import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskMeQuestion } from 'chartroom/interactive-blocks';
import { AskMeBlock } from '../../src/components/AskMeBlock.js';

afterEach(() => {
  cleanup();
});

function baseQuestion(overrides: Partial<AskMeQuestion>): AskMeQuestion {
  return {
    directiveId: 'q-1',
    type: 'text',
    prompt: 'A question',
    answered: false,
    blockRange: { start: 0, end: 0 },
    ...overrides,
  };
}

describe('AskMeBlock -- dispatch by type (plan §8.3)', () => {
  it('single-select renders a radio group matching the extracted choices', () => {
    const question = baseQuestion({
      type: 'single-select',
      choices: [
        { value: 'red', label: 'Red' },
        { value: 'blue', label: 'Blue' },
      ],
    });
    render(<AskMeBlock question={question} onSubmit={vi.fn()} />);
    expect(screen.getByText('Red')).toBeInTheDocument();
    expect(screen.getByText('Blue')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('multi-select renders a checkbox group', () => {
    const question = baseQuestion({
      type: 'multi-select',
      choices: [
        { value: 'red', label: 'Red' },
        { value: 'blue', label: 'Blue' },
      ],
    });
    render(<AskMeBlock question={question} onSubmit={vi.fn()} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('text renders a textarea pre-filled with suggestedText', () => {
    const question = baseQuestion({ type: 'text', suggestedText: 'draft answer' });
    render(<AskMeBlock question={question} onSubmit={vi.fn()} />);
    expect(screen.getByRole('textbox')).toHaveValue('draft answer');
  });

  it('yesno renders three toggle buttons', () => {
    const question = baseQuestion({ type: 'yesno' });
    render(<AskMeBlock question={question} onSubmit={vi.fn()} />);
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByText('Unsure')).toBeInTheDocument();
  });

  it('rating renders a range slider bounded by min/max', () => {
    const question = baseQuestion({ type: 'rating', min: 1, max: 5 });
    render(<AskMeBlock question={question} onSubmit={vi.fn()} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.min).toBe('1');
    expect(slider.max).toBe('5');
  });

  it('ranking renders the choices as an ordered list', () => {
    const question = baseQuestion({
      type: 'ranking',
      choices: [
        { value: 'perf', label: 'Performance' },
        { value: 'dx', label: 'Developer experience' },
      ],
    });
    render(<AskMeBlock question={question} onSubmit={vi.fn()} />);
    expect(screen.getByText('Performance')).toBeInTheDocument();
    expect(screen.getByText('Developer experience')).toBeInTheDocument();
  });

  it('compare renders a card per choice', () => {
    const question = baseQuestion({
      type: 'compare',
      choices: [
        { value: 'a', label: 'Option A', context: 'context a' },
        { value: 'b', label: 'Option B' },
      ],
    });
    render(<AskMeBlock question={question} onSubmit={vi.fn()} />);
    expect(screen.getByText('Option A')).toBeInTheDocument();
    expect(screen.getByText('Option B')).toBeInTheDocument();
    expect(screen.getAllByRole('button').filter((el) => el.className.includes('question-compare__card'))).toHaveLength(2);
  });

  it('an unknown type degrades to a graceful message, submit stays disabled', () => {
    const question = baseQuestion({ type: 'bogus' });
    render(<AskMeBlock question={question} onSubmit={vi.fn()} />);
    expect(screen.getByText(/Unknown question type/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit answer/i })).toBeDisabled();
  });

  it('answered blocks render read-only: prompt + stored answer, no widget, no submit button', () => {
    const question = baseQuestion({ type: 'text', answered: true, answerText: 'Answer (2026-01-01, X): done' });
    render(<AskMeBlock question={question} onSubmit={vi.fn()} />);
    expect(screen.getByText('A question')).toBeInTheDocument();
    expect(screen.getByText('Answer (2026-01-01, X): done')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit answer/i })).not.toBeInTheDocument();
  });

  it('no matching question (undefined) falls back to an inert passthrough of children', () => {
    render(<AskMeBlock onSubmit={vi.fn()}>Fallback content</AskMeBlock>);
    expect(screen.getByText('Fallback content')).toBeInTheDocument();
  });

  it('submit button is disabled until a valid value is chosen, then calls onSubmit with the composed value', async () => {
    const question = baseQuestion({
      type: 'single-select',
      choices: [{ value: 'both', label: 'Both' }],
    });
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<AskMeBlock question={question} onSubmit={onSubmit} />);

    const submitButton = screen.getByRole('button', { name: /submit answer/i });
    expect(submitButton).toBeDisabled();

    fireEvent.click(screen.getByRole('radio'));
    expect(submitButton).toBeEnabled();

    fireEvent.click(submitButton);
    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledWith(question, 'both');
  });

  it('a rejected submit surfaces the error message and re-enables the button', async () => {
    const question = baseQuestion({ type: 'text', suggestedText: 'hi' });
    const onSubmit = vi.fn().mockRejectedValue(new Error('already answered'));
    render(<AskMeBlock question={question} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }));
    await Promise.resolve();
    await Promise.resolve();

    expect(await screen.findByText('already answered')).toBeInTheDocument();
  });
});
