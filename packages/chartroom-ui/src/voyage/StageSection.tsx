import type { ReactElement, ReactNode } from 'react';

export interface StageSectionProps {
  title: string;
  /** item count shown next to the title. */
  count?: number;
  children?: ReactNode;
}

/** Titled stage grouping (In flight / Pending / Done / Parked tonight; Bridge ledger
 * stages later). Renders an explicit "none" note when empty so a bare heading never
 * reads as a loading failure. */
export function StageSection({ title, count, children }: StageSectionProps): ReactElement {
  const isEmpty = count === 0;
  return (
    <section className="stage-section" aria-label={title}>
      <div className="stage-section__head">
        <h2 className="stage-section__title">{title}</h2>
        {count !== undefined && <span className="stage-section__count">{count}</span>}
      </div>
      {isEmpty ? <p className="stage-section__empty">none</p> : children}
    </section>
  );
}
