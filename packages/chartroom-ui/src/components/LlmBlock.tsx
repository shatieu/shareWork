import type { ReactElement, ReactNode } from 'react';

export interface LlmBlockProps {
  tldr?: string;
  children?: ReactNode;
}

/**
 * `:::llm` directive renderer (plan §6.5): the directive's `tldr` attribute is rendered
 * prominently and always visible; `children` (the block's full body) is wrapped in a native
 * `<details>` (same collapsing mechanism as rehype-sectionize, reused not reimplemented) so it's
 * collapsed by default behind a "show full context" toggle.
 */
export function LlmBlock({ tldr, children }: LlmBlockProps): ReactElement {
  return (
    <div className="llm-block">
      {tldr && <p className="llm-block__tldr">{tldr}</p>}
      <details className="llm-block__body">
        <summary>Show full context</summary>
        {children}
      </details>
    </div>
  );
}
