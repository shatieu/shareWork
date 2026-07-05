import type { InputHTMLAttributes, ReactElement } from 'react';
import type { CheckboxRef } from 'chartroom/interactive-blocks';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'checked'> {
  /** The `CheckboxRef` this rendered checkbox corresponds to -- assigned by `DocView`'s own
   * render-order counter, matched 1:1 against `extractInteractiveBlocks`'s own `checkboxes` array
   * (plan §4.3: "both driven by the same imported function, no drift risk"). `undefined` on a
   * render/extraction mismatch -- degrades to an inert, disabled checkbox rather than risk sending
   * a wrong address to the server. */
  checkboxData?: CheckboxRef;
  onCheckToggle?: (ref: CheckboxRef, checked: boolean) => void | Promise<void>;
  /** react-markdown injects the underlying hast `node` as a prop on every custom component
   * override -- accepted here only so it can be destructured out before spreading the rest onto a
   * real DOM `<input>` (an unrecognized `node` attribute would otherwise trigger a React warning). */
  node?: unknown;
}

/**
 * Shared clickable-checkbox override (plan §4.3), wired into `DocView`'s `components` map for the
 * standard `input[type=checkbox]` GFM task-list rendering (react-markdown's own default output is
 * an inert, disabled checkbox). Handles both a bare checklist item and an `:::actions` item's own
 * checkbox identically -- the `CheckboxRef`'s own `scope` already carries which one it is.
 */
export function Checkbox({ checkboxData, onCheckToggle, disabled: _disabled, node: _node, ...rest }: CheckboxProps): ReactElement {
  if (!checkboxData) {
    return <input type="checkbox" disabled {...rest} />;
  }
  // `disabled` is deliberately never forwarded from the caller here: `mdast-util-to-hast`'s own
  // `listItem` handler hard-codes `disabled: true` in the hProperties of every GFM task-list
  // checkbox (a fixed, upstream behavior of a library already bundled by `react-markdown`, not
  // something this repo can change) -- react-markdown then spreads that straight through as a
  // `disabled` prop on every checkbox `input` it renders, `DocView`'s own `input(props)` handler
  // included. A real, resolved `checkboxData` here always means this checkbox genuinely is meant
  // to be interactive (a bare checklist item or an `:::actions` item, plan §4.3) -- the only inert
  // case is `!checkboxData` above, which stays hard-disabled. So the checkbox is unconditionally
  // enabled whenever `checkboxData` resolves, regardless of whatever `disabled` value upstream
  // parsing attached.
  return (
    <input
      type="checkbox"
      checked={checkboxData.checked}
      disabled={false}
      onChange={(event) => {
        void onCheckToggle?.(checkboxData, event.target.checked);
      }}
      {...rest}
    />
  );
}
