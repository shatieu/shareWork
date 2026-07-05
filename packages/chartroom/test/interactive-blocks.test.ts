// Splice-fidelity + extraction-correctness suite (plan §8.1) -- the single most important test
// suite in this phase, mirroring `roundTrip.test.ts`'s own "assert everything outside the changed
// range is byte-identical via a line-level diff" discipline exactly.

import { describe, expect, it } from 'vitest';
import {
  applyAskMeAnswer,
  applyCheckboxToggle,
  extractInteractiveBlocks,
  formatAnswerLine,
  formatAnswerText,
  isKnownType,
  normalizeType,
  validateAnswerValue,
  type AskMeQuestion,
} from '../src/interactive-blocks.js';

/** Every *line* outside `[start, end)` (offsets into `before`) is byte-identical between `before`
 * and `after` -- the same "prefix/suffix byte-identical -> line-array-identical" proof
 * `roundTrip.test.ts` uses, generalized to an arbitrary single splice range. */
function assertOnlyRangeChanged(before: string, after: string, start: number, end: number): void {
  const prefix = before.slice(0, start);
  const suffix = before.slice(end);
  expect(after.startsWith(prefix)).toBe(true);
  expect(after.endsWith(suffix)).toBe(true);
  expect(prefix.split('\n')).toEqual(after.slice(0, prefix.length).split('\n'));
  expect(suffix.split('\n')).toEqual(after.slice(after.length - suffix.length).split('\n'));
}

describe('checkbox toggle -- byte-fidelity (plan §8.1)', () => {
  const doc = [
    '# Doc',
    '',
    'Some intro text.',
    '',
    '- [ ] bare one',
    '- [x] bare two',
    '',
    ':::actions{id="deploy-approval"}',
    '- [ ] Approve production deploy',
    ':::',
    '',
    'Trailing prose.',
    '',
  ].join('\n');

  it('toggling a bare checkbox changes exactly one character', () => {
    const { checkboxes } = extractInteractiveBlocks(doc);
    const bareOne = checkboxes.find((c) => c.scope.directiveId === null && c.scope.index === 0)!;
    expect(bareOne.checked).toBe(false);

    const result = applyCheckboxToggle(doc, { directiveId: null, index: 0 }, true)!;
    expect(result.before).toBe(false);
    expect(result.newText.length).toBe(doc.length); // exactly one char replaced, no length change
    assertOnlyRangeChanged(doc, result.newText, bareOne.bracketRange.start, bareOne.bracketRange.end);
    expect(result.newText.slice(bareOne.bracketRange.start, bareOne.bracketRange.end)).toBe('x');
  });

  it('toggling an already-checked bare checkbox off changes exactly one character', () => {
    const { checkboxes } = extractInteractiveBlocks(doc);
    const bareTwo = checkboxes.find((c) => c.scope.directiveId === null && c.scope.index === 1)!;
    expect(bareTwo.checked).toBe(true);

    const result = applyCheckboxToggle(doc, { directiveId: null, index: 1 }, false)!;
    expect(result.before).toBe(true);
    assertOnlyRangeChanged(doc, result.newText, bareTwo.bracketRange.start, bareTwo.bracketRange.end);
    expect(result.newText.slice(bareTwo.bracketRange.start, bareTwo.bracketRange.end)).toBe(' ');
  });

  it('toggling a checkbox inside an :::actions directive changes exactly one character, directive fence untouched', () => {
    const { checkboxes } = extractInteractiveBlocks(doc);
    const actionsCb = checkboxes.find((c) => c.scope.directiveId === 'deploy-approval')!;
    expect(actionsCb.scope.index).toBe(0);
    expect(actionsCb.checked).toBe(false);

    const result = applyCheckboxToggle(doc, { directiveId: 'deploy-approval', index: 0 }, true)!;
    assertOnlyRangeChanged(doc, result.newText, actionsCb.bracketRange.start, actionsCb.bracketRange.end);
    expect(result.newText).toContain(':::actions{id="deploy-approval"}');
    expect(result.newText).toContain('- [x] Approve production deploy');
  });

  it('toggling an out-of-range bare index returns undefined (no partial/corrupt write)', () => {
    expect(applyCheckboxToggle(doc, { directiveId: null, index: 99 }, true)).toBeUndefined();
  });

  it('toggling an unknown actions directiveId returns undefined', () => {
    expect(applyCheckboxToggle(doc, { directiveId: 'no-such-directive', index: 0 }, true)).toBeUndefined();
  });

  it('an ask-me single-select checklist is never extracted as toggleable checkboxes', () => {
    const withAskMe = [
      ':::ask-me{id="q-1" type="single-select"}',
      'Pick one',
      '',
      '- [ ] Option A',
      '- [ ] Option B',
      ':::',
      '',
    ].join('\n');
    const { checkboxes, askMe } = extractInteractiveBlocks(withAskMe);
    expect(checkboxes).toHaveLength(0);
    expect(askMe).toHaveLength(1);
    expect(askMe[0].choices).toEqual([
      { value: 'option-a', label: 'Option A' },
      { value: 'option-b', label: 'Option B' },
    ]);
  });
});

describe('ask-me answer -- byte-fidelity (plan §8.1)', () => {
  function buildDoc(): string {
    return [
      '# Doc',
      '',
      'Intro before.',
      '',
      ':::ask-me{id="q-03" type="choice"}',
      'How should we authenticate?',
      '',
      '- [ ] PAT tokens',
      '- [ ] OAuth 2.1',
      '- [ ] Both',
      ':::',
      '',
      'Trailing prose after.',
      '',
    ].join('\n');
  }

  it('produces answered="true" + an appended answer line, byte-identical outside the block', () => {
    const doc = buildDoc();
    const { askMe } = extractInteractiveBlocks(doc);
    const question = askMe[0];
    expect(question.type).toBe('single-select'); // proves the choice -> single-select alias (§1.1)
    expect(question.answered).toBe(false);

    const line = formatAnswerLine(question, 'both', '2026-07-04', 'Ondřej');
    expect(line).toBe('> **Answer** (2026-07-04, Ondřej): Both');

    const result = applyAskMeAnswer(doc, 'q-03', line)!;
    assertOnlyRangeChanged(doc, result.newText, question.blockRange.start, question.blockRange.end);
    expect(result.newText).toContain(':::ask-me{id="q-03" type="choice" answered="true"}');
    expect(result.newText).toContain('> **Answer** (2026-07-04, Ondřej): Both');
    expect(result.newText).toContain('Intro before.');
    expect(result.newText).toContain('Trailing prose after.');

    // Re-extracting the result confirms the block is now correctly marked answered with the
    // matching answer text -- the pure function's own span-location still works on an
    // already-answered block (used by the route to detect the 409 conflict in the first place).
    const { askMe: after } = extractInteractiveBlocks(result.newText);
    expect(after[0].answered).toBe(true);
    expect(after[0].answerText).toBe('Answer (2026-07-04, Ondřej): Both');
  });

  it('unknown directiveId returns undefined', () => {
    const doc = buildDoc();
    expect(applyAskMeAnswer(doc, 'no-such-id', '> **Answer** (x, y): z')).toBeUndefined();
  });

  it('inserts a blank line before the answer only when the preceding line is not already blank', () => {
    const tight = [':::ask-me{id="q-tight" type="text"}', 'Question with no blank line before fence', ':::', ''].join('\n');
    const { askMe } = extractInteractiveBlocks(tight);
    const result = applyAskMeAnswer(tight, 'q-tight', '> **Answer** (2026-07-04, X): hi')!;
    assertOnlyRangeChanged(tight, result.newText, askMe[0].blockRange.start, askMe[0].blockRange.end);
    expect(result.newText).toContain('Question with no blank line before fence\n\n> **Answer**');
  });
});

describe('extraction correctness -- all seven real types + legacy aliases + unknown type (plan §8.1)', () => {
  function q(raw: string): AskMeQuestion {
    return extractInteractiveBlocks(raw).askMe[0];
  }

  it('single-select', () => {
    const question = q([':::ask-me{id="a" type="single-select"}', 'Pick one', '', '- [ ] Red', '- [ ] Blue', ':::', ''].join('\n'));
    expect(question.type).toBe('single-select');
    expect(question.prompt).toBe('Pick one');
    expect(question.choices).toEqual([
      { value: 'red', label: 'Red' },
      { value: 'blue', label: 'Blue' },
    ]);
  });

  it('multi-select with allowOther', () => {
    const question = q(
      [':::ask-me{id="a" type="multi-select" allowOther="true"}', 'Pick some', '', '- [ ] Red', '- [ ] Blue', ':::', ''].join('\n'),
    );
    expect(question.type).toBe('multi-select');
    expect(question.allowOther).toBe(true);
    expect(question.choices).toHaveLength(2);
  });

  it('text with placeholder and a suggested-prefill second paragraph', () => {
    const question = q(
      [':::ask-me{id="a" type="text" placeholder="type here"}', 'What do you think?', '', 'A draft answer.', ':::', ''].join('\n'),
    );
    expect(question.type).toBe('text');
    expect(question.placeholder).toBe('type here');
    expect(question.prompt).toBe('What do you think?');
    expect(question.suggestedText).toBe('A draft answer.');
  });

  it('yesno', () => {
    const question = q([':::ask-me{id="a" type="yesno"}', 'Ready to ship?', ':::', ''].join('\n'));
    expect(question.type).toBe('yesno');
    expect(question.prompt).toBe('Ready to ship?');
  });

  it('rating with explicit bounds and labels', () => {
    const question = q(
      [':::ask-me{id="a" type="rating" min="1" max="5" minLabel="bad" maxLabel="great"}', 'How confident?', ':::', ''].join('\n'),
    );
    expect(question.type).toBe('rating');
    expect(question.min).toBe(1);
    expect(question.max).toBe(5);
    expect(question.minLabel).toBe('bad');
    expect(question.maxLabel).toBe('great');
  });

  it('rating defaults to 1..10 when bounds are omitted', () => {
    const question = q([':::ask-me{id="a" type="rating"}', 'How confident?', ':::', ''].join('\n'));
    expect(question.min).toBe(1);
    expect(question.max).toBe(10);
  });

  it('ranking', () => {
    const question = q(
      [':::ask-me{id="a" type="ranking"}', 'Order these', '', '1. Performance', '2. DX', '3. Cost', ':::', ''].join('\n'),
    );
    expect(question.type).toBe('ranking');
    expect(question.choices).toEqual([
      { value: 'performance', label: 'Performance' },
      { value: 'dx', label: 'DX' },
      { value: 'cost', label: 'Cost' },
    ]);
  });

  it('compare, with nested context kept as real markdown source (not regex-mangled)', () => {
    const question = q(
      [
        ':::ask-me{id="a" type="compare"}',
        'Which approach?',
        '',
        '- Approach One',
        '',
        '  Some `code` and **bold** context.',
        '- Approach Two',
        '',
        '  Different context.',
        ':::',
        '',
      ].join('\n'),
    );
    expect(question.type).toBe('compare');
    expect(question.choices).toHaveLength(2);
    expect(question.choices![0].label).toBe('Approach One');
    expect(question.choices![0].context).toContain('`code`');
    expect(question.choices![0].context).toContain('**bold**');
    expect(question.choices![1].label).toBe('Approach Two');
  });

  it('legacy alias "choice" -> single-select', () => {
    expect(normalizeType('choice')).toBe('single-select');
    const question = q([':::ask-me{id="a" type="choice"}', 'Pick one', '', '- [ ] X', ':::', ''].join('\n'));
    expect(question.type).toBe('single-select');
  });

  it('legacy alias "free-text" -> text', () => {
    expect(normalizeType('free-text')).toBe('text');
    const question = q([':::ask-me{id="a" type="free-text"}', 'Say something', ':::', ''].join('\n'));
    expect(question.type).toBe('text');
  });

  it('legacy alias "comparison" -> compare', () => {
    expect(normalizeType('comparison')).toBe('compare');
    const question = q([':::ask-me{id="a" type="comparison"}', 'Which?', '', '- One', '- Two', ':::', ''].join('\n'));
    expect(question.type).toBe('compare');
  });

  it('an unknown type="bogus" degrades gracefully -- never throws, no choices/bounds set', () => {
    expect(() => {
      const question = q([':::ask-me{id="a" type="bogus"}', 'What now?', ':::', ''].join('\n'));
      expect(question.type).toBe('bogus');
      expect(isKnownType(question.type)).toBe(false);
      expect(question.prompt).toBe('What now?');
      expect(question.choices).toBeUndefined();
      expect(question.min).toBeUndefined();
    }).not.toThrow();
  });

  it('a directive with no non-list content falls back to the defensive placeholder prompt', () => {
    const question = q([':::ask-me{id="a" type="single-select"}', '- [ ] Only', ':::', ''].join('\n'));
    expect(question.prompt).toBe('(untitled question)');
  });
});

describe(':::actions extraction (plan §5)', () => {
  it('one directive = one action item, label/checked read from its own single checkbox', () => {
    const doc = [':::actions{id="deploy-approval"}', '- [ ] Approve production deploy of v2.3', ':::', ''].join('\n');
    const { actions, checkboxes } = extractInteractiveBlocks(doc);
    expect(actions).toEqual([
      {
        directiveId: 'deploy-approval',
        label: 'Approve production deploy of v2.3',
        checked: false,
        blockRange: actions[0].blockRange,
      },
    ]);
    expect(checkboxes).toHaveLength(1);
    expect(checkboxes[0].scope).toEqual({ directiveId: 'deploy-approval', index: 0 });
  });

  it('an already-checked actions item reports checked: true', () => {
    const doc = [':::actions{id="a"}', '- [x] Already done', ':::', ''].join('\n');
    const { actions } = extractInteractiveBlocks(doc);
    expect(actions[0].checked).toBe(true);
  });

  it('an :::actions item with two checkboxes reports checked: false unless ALL are checked (regression: only checkboxes[0] was previously consulted)', () => {
    const partiallyChecked = [
      ':::actions{id="rollout"}',
      '- [x] Deploy to staging',
      '- [ ] Deploy to production',
      ':::',
      '',
    ].join('\n');
    const { actions: partial, checkboxes: partialCheckboxes } = extractInteractiveBlocks(partiallyChecked);
    expect(partialCheckboxes).toHaveLength(2);
    expect(partialCheckboxes.map((c) => c.checked)).toEqual([true, false]);
    // checkboxes[0] alone is checked, but the item as a whole must still be pending.
    expect(partial[0].checked).toBe(false);

    const fullyChecked = [
      ':::actions{id="rollout"}',
      '- [x] Deploy to staging',
      '- [x] Deploy to production',
      ':::',
      '',
    ].join('\n');
    const { actions: full } = extractInteractiveBlocks(fullyChecked);
    expect(full[0].checked).toBe(true);
  });

  it('multiple actions directives each get their own within-directive checkbox index 0', () => {
    const doc = [
      ':::actions{id="first"}',
      '- [ ] First action',
      ':::',
      '',
      ':::actions{id="second"}',
      '- [ ] Second action',
      ':::',
      '',
    ].join('\n');
    const { checkboxes } = extractInteractiveBlocks(doc);
    expect(checkboxes).toEqual([
      { scope: { directiveId: 'first', index: 0 }, checked: false, bracketRange: checkboxes[0].bracketRange },
      { scope: { directiveId: 'second', index: 0 }, checked: false, bracketRange: checkboxes[1].bracketRange },
    ]);
  });
});

describe('bare checkbox whole-document ordinal (plan §3.3)', () => {
  it('bare checkboxes are numbered in whole-document order, skipping ones inside directives', () => {
    const doc = [
      '- [ ] bare zero',
      '',
      ':::actions{id="a"}',
      '- [ ] action item (own counter, not bare)',
      ':::',
      '',
      '- [x] bare one',
      '',
      ':::ask-me{id="q" type="single-select"}',
      'Pick',
      '',
      '- [ ] not a real checkbox (ask-me choice list)',
      ':::',
      '',
      '- [ ] bare two',
      '',
    ].join('\n');
    const { checkboxes } = extractInteractiveBlocks(doc);
    const bare = checkboxes.filter((c) => c.scope.directiveId === null);
    expect(bare.map((c) => c.scope.index)).toEqual([0, 1, 2]);
    expect(bare.map((c) => c.checked)).toEqual([false, true, false]);
  });
});

describe('formatAnswerText (plan §3.6)', () => {
  const base = { directiveId: 'q', answered: false, blockRange: { start: 0, end: 0 } };

  it('single-select / compare -> chosen label', () => {
    const question: AskMeQuestion = {
      ...base,
      type: 'single-select',
      prompt: 'p',
      choices: [
        { value: 'pat', label: 'PAT tokens' },
        { value: 'both', label: 'Both' },
      ],
    };
    expect(formatAnswerText(question, 'both')).toBe('Both');
  });

  it('multi-select -> comma-joined labels', () => {
    const question: AskMeQuestion = {
      ...base,
      type: 'multi-select',
      prompt: 'p',
      choices: [
        { value: 'pat', label: 'PAT tokens' },
        { value: 'oauth', label: 'OAuth 2.1' },
      ],
    };
    expect(formatAnswerText(question, ['pat', 'oauth'])).toBe('PAT tokens, OAuth 2.1');
  });

  it('rating -> "n/max"', () => {
    const question: AskMeQuestion = { ...base, type: 'rating', prompt: 'p', max: 10 };
    expect(formatAnswerText(question, 8)).toBe('8/10');
  });

  it('ranking -> numbered labels', () => {
    const question: AskMeQuestion = {
      ...base,
      type: 'ranking',
      prompt: 'p',
      choices: [
        { value: 'perf', label: 'Performance' },
        { value: 'dx', label: 'Developer experience' },
        { value: 'cost', label: 'Cost' },
      ],
    };
    expect(formatAnswerText(question, ['perf', 'dx', 'cost'])).toBe('1. Performance 2. Developer experience 3. Cost');
  });

  it('text -> verbatim', () => {
    const question: AskMeQuestion = { ...base, type: 'text', prompt: 'p' };
    expect(formatAnswerText(question, 'Ship it Friday.')).toBe('Ship it Friday.');
  });

  it('yesno -> capitalized label', () => {
    const question: AskMeQuestion = { ...base, type: 'yesno', prompt: 'p' };
    expect(formatAnswerText(question, 'yes')).toBe('Yes');
    expect(formatAnswerText(question, 'unsure')).toBe('Unsure');
  });
});

describe('validateAnswerValue (plan §8.2 shape validation)', () => {
  const choices = [{ value: 'a', label: 'A' }];

  it('accepts correctly-shaped values per type, rejects mismatched shapes', () => {
    const single: AskMeQuestion = { directiveId: 'q', answered: false, blockRange: { start: 0, end: 0 }, type: 'single-select', prompt: 'p', choices };
    expect(validateAnswerValue(single, 'a')).toBe(true);
    expect(validateAnswerValue(single, ['a'])).toBe(false);

    const multi: AskMeQuestion = { ...single, type: 'multi-select' };
    expect(validateAnswerValue(multi, ['a'])).toBe(true);
    expect(validateAnswerValue(multi, 'a')).toBe(false);
    expect(validateAnswerValue(multi, [])).toBe(false);

    const rating: AskMeQuestion = { ...single, type: 'rating', min: 1, max: 10 };
    expect(validateAnswerValue(rating, 5)).toBe(true);
    expect(validateAnswerValue(rating, 11)).toBe(false);
    expect(validateAnswerValue(rating, 'x')).toBe(false);

    const yesno: AskMeQuestion = { ...single, type: 'yesno' };
    expect(validateAnswerValue(yesno, 'yes')).toBe(true);
    expect(validateAnswerValue(yesno, 'maybe')).toBe(false);

    const unknown: AskMeQuestion = { ...single, type: 'bogus' };
    expect(validateAnswerValue(unknown, 'anything')).toBe(false);
  });
});
