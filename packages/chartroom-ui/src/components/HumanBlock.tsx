import type { ReactElement, ReactNode } from 'react';

export interface HumanBlockProps {
  children?: ReactNode;
}

/**
 * `:::human` directive renderer (plan §6.5): renders `children` plainly, no collapsing, no special
 * chrome -- the "agents should skip this" instruction is a phase-5 agent-skill concern, not a
 * viewer-rendering concern; the viewer shows it like normal content.
 */
export function HumanBlock({ children }: HumanBlockProps): ReactElement {
  return <div className="human-block">{children}</div>;
}
