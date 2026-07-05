import type { ReactElement, ReactNode } from 'react';

export interface DirectiveFallbackProps {
  children?: ReactNode;
}

/**
 * Inert passthrough renderer for any directive name that isn't `:::llm`/`:::human` (e.g.
 * `:::ask-me`, `:::actions`, or anything else a future phase introduces) -- degrades gracefully to
 * visible, unstyled content, with zero write-back/interactive behavior (plan §0/§6.5). Never
 * crashes on an unrecognized directive name.
 */
export function DirectiveFallback({ children }: DirectiveFallbackProps): ReactElement {
  return <div className="directive-fallback">{children}</div>;
}
