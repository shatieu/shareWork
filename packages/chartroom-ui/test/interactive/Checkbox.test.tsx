import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheckboxRef } from 'chartroom/interactive-blocks';
import { Checkbox } from '../../src/components/Checkbox.js';

afterEach(() => {
  cleanup();
});

function ref(overrides: Partial<CheckboxRef>): CheckboxRef {
  return {
    scope: { directiveId: null, index: 0 },
    checked: false,
    bracketRange: { start: 0, end: 1 },
    ...overrides,
  };
}

describe('Checkbox (plan §8.3)', () => {
  it('reflects checkboxData.checked and calls onCheckToggle with the correct scope on click', () => {
    const onCheckToggle = vi.fn();
    const checkboxData = ref({ scope: { directiveId: 'deploy', index: 2 }, checked: false });
    render(<Checkbox checkboxData={checkboxData} onCheckToggle={onCheckToggle} />);

    const input = screen.getByRole('checkbox') as HTMLInputElement;
    expect(input.checked).toBe(false);

    fireEvent.click(input);
    expect(onCheckToggle).toHaveBeenCalledWith(checkboxData, true);
  });

  it('an already-checked ref renders checked, unchecking calls onCheckToggle(ref, false)', () => {
    const onCheckToggle = vi.fn();
    const checkboxData = ref({ checked: true });
    render(<Checkbox checkboxData={checkboxData} onCheckToggle={onCheckToggle} />);

    const input = screen.getByRole('checkbox') as HTMLInputElement;
    expect(input.checked).toBe(true);

    fireEvent.click(input);
    expect(onCheckToggle).toHaveBeenCalledWith(checkboxData, false);
  });

  it('falls back to an inert, disabled checkbox when no checkboxData is supplied', () => {
    render(<Checkbox />);
    const input = screen.getByRole('checkbox') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('regression: stays enabled and clickable even when a real GFM-parsed disabled={true} prop is supplied', () => {
    // Mirrors real usage exactly: `mdast-util-to-hast`'s own `listItem` handler hard-codes
    // `disabled: true` in the hProperties of every GFM task-list checkbox, which react-markdown
    // spreads straight through as a literal `disabled` prop -- `DocView`'s `input(props)` handler
    // then spreads that same `props` (disabled included) onto `<Checkbox {...props} .../>`. Every
    // other test above constructs `<Checkbox>` directly without ever passing `disabled`, so none of
    // them reproduce the real bug this guards against: a permanently unclickable checkbox.
    const onCheckToggle = vi.fn();
    const checkboxData = ref({ scope: { directiveId: null, index: 0 }, checked: false });
    render(<Checkbox disabled checkboxData={checkboxData} onCheckToggle={onCheckToggle} />);

    const input = screen.getByRole('checkbox') as HTMLInputElement;
    expect(input.disabled).toBe(false);

    fireEvent.click(input);
    expect(onCheckToggle).toHaveBeenCalledWith(checkboxData, true);
  });
});
