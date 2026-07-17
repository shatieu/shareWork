import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import {
  addVoyageItem,
  fetchVoyage,
  fetchVoyageProject,
  fetchVoyageProjects,
  voyageEventsUrl,
  type VoyageDifficulty,
  type VoyageItem,
  type VoyageProject,
  type VoyageResponse,
} from '../api/client.js';
import { ProgressBar } from './ProgressBar.js';
import { DifficultyBadge } from './DifficultyBadge.js';
import { StageSection } from './StageSection.js';
import './voyage.css';

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

const ADD_DIFFICULTIES: VoyageDifficulty[] = ['S', 'M', 'L', 'XL'];

/** "Add item" affordance: collapsed to one button; expands to a single-row form posting to
 * `POST /api/voyage/:project/items`. A 409 (progress.json hand edit mid-flight) surfaces the
 * server's readable error inline. */
function VoyageAddForm({ project, onAdded }: { project: string; onAdded: () => void }): ReactElement {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const close = (): void => {
    setOpen(false);
    setAddError(null);
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === '' || saving) return;
    setSaving(true);
    setAddError(null);
    addVoyageItem(project, {
      title: trimmed,
      difficulty: difficulty === '' ? undefined : (difficulty as VoyageDifficulty),
      note: note.trim() === '' ? undefined : note.trim(),
    })
      .then(() => {
        setTitle('');
        setDifficulty('');
        setNote('');
        setOpen(false);
        // The SSE broadcast delivers the append anyway; this refetch is the poll-path fast lane.
        onAdded();
      })
      .catch((err: unknown) => {
        setAddError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  if (!open) {
    return (
      <div className="voyage-add">
        <button type="button" className="voyage-add__toggle" onClick={() => setOpen(true)}>
          + Add item
        </button>
      </div>
    );
  }

  return (
    <div className="voyage-add">
      <form className="voyage-add__form" onSubmit={submit}>
        <input
          className="voyage-add__title"
          aria-label="Item title"
          placeholder="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <select
          className="voyage-add__difficulty"
          aria-label="Difficulty"
          value={difficulty}
          onChange={(event) => setDifficulty(event.target.value)}
        >
          <option value="">difficulty?</option>
          {ADD_DIFFICULTIES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <input
          className="voyage-add__note"
          aria-label="Note"
          placeholder="Note (optional)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <button type="submit" className="voyage-add__submit" disabled={saving || title.trim() === ''}>
          {saving ? 'Adding…' : 'Add'}
        </button>
        <button type="button" className="voyage-add__cancel" onClick={close}>
          Cancel
        </button>
      </form>
      {addError !== null && (
        <p className="voyage-add__error" role="alert">
          {addError}
        </p>
      )}
    </div>
  );
}

/**
 * Voyage tab: the live mission-progress ledger. Fetches the selected project's snapshot once,
 * then live-updates over SSE when the runtime has `EventSource`; environments without it (jsdom,
 * ancient webviews) and SSE failures fall back to a 5 s poll of the GET endpoint. Multi-project
 * (wave2-D): `/api/voyage/projects` feeds a chip switcher (hidden when only the default project
 * exists or the hull predates the route); items can be appended via the add form.
 */
export function VoyagePage(): ReactElement {
  const [data, setData] = useState<VoyageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<VoyageProject[]>([]);
  const [project, setProject] = useState('default');
  /** Latest refresh fn from the data effect -- lets the add-item flow trigger an immediate
   * refetch (poll-fallback runtimes would otherwise wait up to 5 s; SSE runtimes get the
   * broadcast anyway, so this is just a fast path). */
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    fetchVoyageProjects()
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch(() => {
        /* older hull without /projects -- default-only, switcher stays hidden */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let source: EventSource | null = null;

    setData(null);
    setError(null);

    const apply = (next: VoyageResponse): void => {
      if (cancelled) return;
      setData(next);
      setError(null);
    };
    const refresh = (): void => {
      // The default project keeps the bare endpoint so the page works against older hulls too.
      (project === 'default' ? fetchVoyage() : fetchVoyageProject(project))
        .then(apply)
        .catch((err: unknown) => {
          if (!cancelled) setError(String(err));
        });
    };
    refreshRef.current = refresh;
    const startPolling = (): void => {
      if (pollTimer === null) pollTimer = setInterval(refresh, POLL_INTERVAL_MS);
    };

    refresh();
    if (typeof EventSource === 'undefined') {
      // Feature-detect: no SSE in this runtime -- poll only.
      startPolling();
    } else {
      source = new EventSource(voyageEventsUrl(project));
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
  }, [project]);

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
      {projects.length > 1 && (
        <div className="voyage__projects" role="group" aria-label="Voyage projects">
          {projects.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={`filter-chip${candidate.id === project ? ' filter-chip--on' : ''}`}
              aria-pressed={candidate.id === project}
              title={candidate.file}
              onClick={() => setProject(candidate.id)}
            >
              {candidate.name}
            </button>
          ))}
        </div>
      )}
      <VoyageAddForm project={project} onAdded={() => refreshRef.current()} />
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
