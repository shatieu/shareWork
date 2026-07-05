import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskMeQuestion } from 'chartroom/interactive-blocks';
import { RatingQuestion } from '../../../src/components/questions/RatingQuestion.js';

afterEach(() => {
  cleanup();
});

function question(overrides: Partial<AskMeQuestion> = {}): AskMeQuestion {
  return {
    directiveId: 'q',
    type: 'rating',
    prompt: 'p',
    answered: false,
    blockRange: { start: 0, end: 0 },
    ...overrides,
  };
}

describe('RatingQuestion (plan §8.3)', () => {
  it('the slider is bounded by the question\'s own min/max', () => {
    render(<RatingQuestion question={question({ min: 2, max: 8 })} value={5} onChange={vi.fn()} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.min).toBe('2');
    expect(slider.max).toBe('8');
  });

  it('defaults to 1..10 bounds when min/max are absent', () => {
    render(<RatingQuestion question={question()} value={5} onChange={vi.fn()} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.min).toBe('1');
    expect(slider.max).toBe('10');
  });

  it('moving the slider calls onChange with the numeric value', () => {
    const onChange = vi.fn();
    render(<RatingQuestion question={question({ min: 1, max: 10 })} value={5} onChange={onChange} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '8' } });
    expect(onChange).toHaveBeenCalledWith(8);
  });

  it('renders minLabel/maxLabel when provided', () => {
    render(<RatingQuestion question={question({ min: 1, max: 10, minLabel: 'bad', maxLabel: 'great' })} value={5} onChange={vi.fn()} />);
    expect(screen.getByText('bad')).toBeInTheDocument();
    expect(screen.getByText('great')).toBeInTheDocument();
  });
});
