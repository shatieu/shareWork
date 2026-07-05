import type { ReactElement } from 'react';

export interface ProgressBarProps {
  /** 0-100; values outside the range are clamped, never thrown on. */
  value: number;
  /** switches the fill to the "done" (olive) gradient. */
  done?: boolean;
  /** accessible name for the progressbar. */
  label?: string;
}

/** Brass progress bar -- reusable presentational piece (voyage items tonight, Bridge
 * ledger rows later). */
export function ProgressBar({ value, done, label }: ProgressBarProps): ReactElement {
  const clamped = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <div
      className={done ? 'progress progress--done' : 'progress'}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={label}
    >
      <div className="progress__fill" style={{ width: `${clamped}%` }} />
    </div>
  );
}
