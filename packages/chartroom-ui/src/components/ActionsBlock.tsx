import type { ReactElement, ReactNode } from 'react';

export interface ActionsBlockProps {
  children?: ReactNode;
}

/**
 * `:::actions` directive renderer (plan §5.2) -- a thin wrapper: a small "Action" badge plus the
 * directive's own body rendered through the ordinary react-markdown pipeline. No structured
 * pre-pass is needed here (unlike `AskMeBlock`) since an actions item's body genuinely is just a
 * checklist -- the shared `Checkbox` override bare checklists use is already wired into `DocView`'s
 * `components` map, so `children` renders interactively with zero extra plumbing in this component.
 */
export function ActionsBlock({ children }: ActionsBlockProps): ReactElement {
  return (
    <div className="actions-block">
      <span className="actions-block__badge">Action</span>
      <div className="actions-block__body">{children}</div>
    </div>
  );
}
