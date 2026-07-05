import { useEffect, useState, type ReactElement } from 'react';
import { fetchVoyage, type VoyageItem, type VoyageResponse } from '../api/client.js';
import { ProgressBar } from './ProgressBar.js';
import { DifficultyBadge } from './DifficultyBadge.js';
import { StageSection } from './StageSection.js';

export type VoyageSection = 'inflight' | 'pending' | 'done' | 'parked';

/** Deterministic status → section mapping (contract with real progress.json statuses like
 * "PASS+merged", "implementing", "pending"): Done = merged/done, or fully-progressed PASS;
 * Parked / Pending match their literal statuses; everything else is In flight. */
export function sectionOf(item: Pick<VoyageItem, 'status' | 'stage_progress'>): VoyageSection {
  const status = item.status;
  if (/merged|^done$/i.test(status) || (item.stage_progress === 100 && /pass/i.test(status))) {
    return 'done';
  }
  if (/^parked/i.test(status)) return 'parked';
  if (/^pending$/i.test(status)) return 'pending';
  return 'inflight';
}

/** Difficulty weights for the overall mission bar: S=1 M=2 L=3 XL=5; unsized counts as M.
 * Deliberately duplicated in the UI -- the daemon package owns the canonical formula. */
const DIFFICULTY_WEIGHTS: Record<string, number> = { S: 1, M: 2, L: 3, XL: 5 };
const DEFAULT_WEIGHT = DIFFICULTY_WEIGHTS.M;

/** Difficulty-weighted mean of stage_progress across all items, rounded to whole percent. */
export function missionProgress(items: ReadonlyArray<Pick<VoyageItem, 'difficulty' | 'stage_progress'>>): number {
  let weightSum = 0;
  let progressSum = 0;
  for (const item of items) {
    const weight = (item.difficulty && DIFFICULTY_WEIGHTS[item.difficulty]) || DEFAULT_WEIGHT;
    const progress = Number.isFinite(item.stage_progress) ? Math.min(100, Math.max(0, item.stage_progress)) : 0;
    weightSum += weight;
    progressSum += weight * progress;
  }
  if (weightSum === 0) return 0;
  return Math.round(progressSum / weightSum);
}

const POLL_INTERVAL_MS = 5_000;

function formatTimestamp(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function VoyageItemRow({ item, done }: { item: VoyageItem; done: boolean }): ReactElement {
  const updated = formatTimestamp(item.updated_at);
  return (
    <article className="voyage-item">
      <div className="voyage-item__row">
        <DifficultyBadge difficulty={item.difficulty} />
        <span className="voyage-item__title">{item.title}</span>
        <span className="voyage-item__status">{item.status}</span>
        {item.remaining_guess_h !== null && (
          <span className="voyage-item__remaining">~{item.remaining_guess_h}h left</span>
        )}
      </div>
      <ProgressBar value={item.stage_progress} done={done} label={`${item.title} progress`} />
      {(item.note || updated) && (
        <div className="voyage-item__meta">
          {item.note && <span className="voyage-item__note">{item.note}</span>}
          {updated && <span className="voyage-item__updated">{updated}</span>}
        </div>
      )}
    </article>
  );
}

const SECTIONS: Array<{ key: VoyageSection; title: string }> = [
  { key: 'inflight', title: 'In flight' },
  { key: 'pending', title: 'Pending' },
  { key: 'done', title: 'Done' },
  { key: 'parked', title: 'Parked' },
];

/**
 * Voyage tab: the live mission-progress ledger. Fetches `/api/voyage` once, then live-updates
 * over SSE (`/api/voyage/events`) when the runtime has `EventSource`; environments without it
 * (jsdom, ancient webviews) and SSE failures fall back to a 5 s poll of the GET endpoint.
 */
export function VoyagePage(): ReactElement {
  const [data, setData] = useState<VoyageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let source: EventSource | null = null;

    const apply = (next: VoyageResponse): void => {
      if (cancelled) return;
      setData(next);
      setError(null);
    };
    const refresh = (): void => {
      fetchVoyage()
        .then(apply)
        .catch((err: unknown) => {
          if (!cancelled) setError(String(err));
        });
    };
    const startPolling = (): void => {
      if (pollTimer === null) pollTimer = setInterval(refresh, POLL_INTERVAL_MS);
    };

    refresh();
    if (typeof EventSource === 'undefined') {
      // Feature-detect: no SSE in this runtime -- poll only.
      startPolling();
    } else {
      source = new EventSource('/api/voyage/events');
      source.addEventListener('voyage', (event) => {
        try {
          apply(JSON.parse((event as MessageEvent<string>).data) as VoyageResponse);
        } catch {
          /* a malformed frame never kills the view; the next frame or poll recovers */
        }
      });
      // EventSource retries on its own; the poll fallback just guarantees liveness meanwhile.
      source.onerror = startPolling;
    }

    return () => {
      cancelled = true;
      if (pollTimer !== null) clearInterval(pollTimer);
      source?.close();
    };
  }, []);

  if (data === null) {
    return error !== null ? (
      <div className="voyage">
        <p className="voyage__error" role="alert">
          Voyage data unavailable: {error}
        </p>
      </div>
    ) : (
      <div className="voyage">
        <p className="voyage__loading">Loading voyage…</p>
      </div>
    );
  }

  const grouped: Record<VoyageSection, VoyageItem[]> = { inflight: [], pending: [], done: [], parked: [] };
  for (const item of data.packages) grouped[sectionOf(item)].push(item);
  const overall = missionProgress(data.packages);
  const updated = formatTimestamp(data.updatedAt);

  return (
    <div className="voyage">
      <div className="voyage__head">
        <h1 className="voyage__title">Voyage</h1>
        <span className="voyage__file">{data.file}</span>
        {updated && <span className="voyage__updated">updated {updated}</span>}
        {data.stale && (
          <span className="voyage__stale" title="the progress file currently fails to parse; showing the last good snapshot">
            stale
          </span>
        )}
      </div>
      <div className="voyage-overall">
        <div className="voyage-overall__row">
          <span className="voyage-overall__label">Mission progress (difficulty-weighted)</span>
          <span className="voyage-overall__value">{overall}%</span>
        </div>
        <ProgressBar value={overall} label="Overall mission progress" />
      </div>
      {SECTIONS.map(({ key, title }) => (
        <StageSection key={key} title={title} count={grouped[key].length}>
          {grouped[key].map((item) => (
            <VoyageItemRow key={item.id} item={item} done={key === 'done'} />
          ))}
        </StageSection>
      ))}
    </div>
  );
}
