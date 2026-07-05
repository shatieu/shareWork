import type { ReactElement } from 'react';
import type { VoyageDifficulty } from '../api/client.js';

export interface DifficultyBadgeProps {
  /** null = not yet sized -- rendered as `[?]`. */
  difficulty: VoyageDifficulty | null;
}

/** `[S]` / `[M]` / `[L]` / `[XL]` sizing chip; `[?]` for unsized items. Reusable
 * presentational piece (voyage tonight, Bridge ledger later). */
export function DifficultyBadge({ difficulty }: DifficultyBadgeProps): ReactElement {
  const modifier = difficulty === null ? 'unknown' : difficulty.toLowerCase();
  return (
    <span
      className={`difficulty-badge difficulty-badge--${modifier}`}
      title={difficulty === null ? 'difficulty not yet estimated' : `difficulty ${difficulty}`}
    >
      [{difficulty ?? '?'}]
    </span>
  );
}
