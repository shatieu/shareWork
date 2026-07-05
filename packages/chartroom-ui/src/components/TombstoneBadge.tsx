import type { ReactElement } from 'react';
import type { BrokenLinkIssue } from '../api/client.js';

export interface TombstoneBadgeProps {
  issue: BrokenLinkIssue;
}

/**
 * Renders "missing (was `<lastPath>`, gone since `<deletedAt>`)" for a tombstoned outbound link,
 * or "missing (id `<targetId>` not found)" for a never-existed target (plan §6.6) -- direct
 * pass-through of phase-1's check.ts::runCheck().brokenLinks data (enriched server-side with
 * `deletedAt` from the same repo's index.deleted map -- see packages/chartroom's docs.ts route --
 * since check.ts's own BrokenLinkIssue shape doesn't carry deletedAt), zero new tombstone
 * detection logic on the client. Matches the spec's "never a silent 404" framing in the UI.
 */
export function TombstoneBadge({ issue }: TombstoneBadgeProps): ReactElement {
  const text =
    issue.matchType === 'tombstone'
      ? `missing (was \`${issue.lastPath}\`${issue.deletedAt ? `, gone since ${issue.deletedAt}` : ''})`
      : `missing (id \`${issue.targetId}\` not found)`;

  return (
    <div className="tombstone-badge" role="note">
      <span className="tombstone-badge__href">{issue.hrefAsWritten}</span>
      <span className="tombstone-badge__status">{text}</span>
    </div>
  );
}
