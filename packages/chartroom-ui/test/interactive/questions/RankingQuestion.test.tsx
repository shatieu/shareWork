import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskMeQuestion } from 'chartroom/interactive-blocks';
import { RankingQuestion } from '../../../src/components/questions/RankingQuestion.js';

afterEach(() => {
  cleanup();
});

function question(): AskMeQuestion {
  return {
    directiveId: 'q',
    type: 'ranking',
    prompt: 'p',
    answered: false,
    blockRange: { start: 0, end: 0 },
    choices: [
      { value: 'perf', label: 'Performance' },
      { value: 'dx', label: 'Developer experience' },
      { value: 'cost', label: 'Cost' },
    ],
  };
}

describe('RankingQuestion (plan §8.3)', () => {
  it('renders items in the given value order', () => {
    render(<RankingQuestion question={question()} value={['perf', 'dx', 'cost']} onChange={vi.fn()} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Performance'),
      expect.stringContaining('Developer experience'),
      expect.stringContaining('Cost'),
    ]);
  });

  it('clicking "move down" on the first item swaps it with the second', () => {
    const onChange = vi.fn();
    render(<RankingQuestion question={question()} value={['perf', 'dx', 'cost']} onChange={onChange} />);
    const downButtons = screen.getAllByRole('button', { name: 'Move down' });
    fireEvent.click(downButtons[0]);
    expect(onChange).toHaveBeenCalledWith(['dx', 'perf', 'cost']);
  });

  it('clicking "move up" on the last item swaps it with the middle one', () => {
    const onChange = vi.fn();
    render(<RankingQuestion question={question()} value={['perf', 'dx', 'cost']} onChange={onChange} />);
    const upButtons = screen.getAllByRole('button', { name: 'Move up' });
    fireEvent.click(upButtons[2]);
    expect(onChange).toHaveBeenCalledWith(['perf', 'cost', 'dx']);
  });

  it('the first item\'s "move up" and the last item\'s "move down" buttons are disabled', () => {
    render(<RankingQuestion question={question()} value={['perf', 'dx', 'cost']} onChange={vi.fn()} />);
    const upButtons = screen.getAllByRole('button', { name: 'Move up' });
    const downButtons = screen.getAllByRole('button', { name: 'Move down' });
    expect(upButtons[0]).toBeDisabled();
    expect(downButtons[downButtons.length - 1]).toBeDisabled();
  });
});
