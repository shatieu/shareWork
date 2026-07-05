import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskMeQuestion } from 'chartroom/interactive-blocks';
import { SingleSelectQuestion } from '../../../src/components/questions/SingleSelectQuestion.js';

afterEach(() => {
  cleanup();
});

function question(overrides: Partial<AskMeQuestion> = {}): AskMeQuestion {
  return {
    directiveId: 'q',
    type: 'single-select',
    prompt: 'p',
    answered: false,
    blockRange: { start: 0, end: 0 },
    choices: [
      { value: 'pat', label: 'PAT tokens' },
      { value: 'oauth', label: 'OAuth 2.1' },
    ],
    ...overrides,
  };
}

describe('SingleSelectQuestion (plan §8.3)', () => {
  it('clicking a radio calls onChange with that choice value', () => {
    const onChange = vi.fn();
    render(<SingleSelectQuestion question={question()} value="" onChange={onChange} />);
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[1]); // "OAuth 2.1"
    expect(onChange).toHaveBeenCalledWith('oauth');
  });

  it('an allowOther question exposes a write-in text field once "Other" is selected', () => {
    const onChange = vi.fn();
    render(<SingleSelectQuestion question={question({ allowOther: true })} value="" onChange={onChange} />);
    expect(screen.queryByPlaceholderText('Write your own...')).not.toBeInTheDocument();

    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[radios.length - 1]); // the "Other" radio, always last
    expect(onChange).toHaveBeenCalledWith('');

    const textField = screen.getByPlaceholderText('Write your own...');
    fireEvent.change(textField, { target: { value: 'Custom answer' } });
    expect(onChange).toHaveBeenCalledWith('Custom answer');
  });
});
