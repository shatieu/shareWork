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
});
