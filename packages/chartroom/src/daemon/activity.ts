import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const ACTIVITY_DIR_NAME = '.chartroom';
const ACTIVITY_FILE_NAME = 'activity.json';

/** How many events the in-memory ring buffer (and therefore the persisted file) keeps. */
const RING_CAP = 200;

/** Debounce window for persisting to disk -- a repair burst (one event per fixed link) should
 * produce one write, not one write per event. */
const PERSIST_DEBOUNCE_MS = 1000;

/**
 * One entry in the daemon's cross-repo activity feed (wave-2 contract): what the daemon did on the
 * user's behalf ('repair'), what it noticed ('rebuild', 'check'), and what the user did through it
 * ('save', 'session'). `summary` is the one-line human-readable headline; `detail` the optional
 * second line.
 */
export interface ActivityEvent {
  /** ISO timestamp. */
  ts: string;
  repoId: string;
  repoName: string;
  kind: 'repair' | 'rebuild' | 'check' | 'save' | 'session';
  summary: string;
  detail?: string;
  /** doc key (`id ?? path`, doc-lookup.ts convention) of the doc this event is about, if any. */
  docKey?: string;
  /** repo-relative path of the file this event touched, if any. */
  path?: string;
}

interface ActivityFile {
  events: ActivityEvent[];
}

/** Same `homeDir` override pattern as registry.ts -- tests point this at a disposable temp
 * directory, never the real `~/.chartroom/activity.json`. */
export function activityPath(homeDir: string = homedir()): string {
  return join(homeDir, ACTIVITY_DIR_NAME, ACTIVITY_FILE_NAME);
}

/**
 * The daemon's activity log: an in-memory ring buffer (cap 200) persisted, debounced (~1s), to
 * `~/.chartroom/activity.json` and reloaded on boot, so the feed survives daemon restarts. A
 * missing/corrupt file is never fatal -- it just means "no history yet" (same posture as
 * registry.ts). The debounce timer is `unref()`d so a pending persist never holds the process
 * open; callers that need a guaranteed write (shutdown, tests) use `flush()`.
 */
export class ActivityLog {
  private readonly homeDir: string;
  private events: ActivityEvent[] = [];
  private persistTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(homeDir: string = homedir()) {
    this.homeDir = homeDir;
    this.events = loadEvents(homeDir);
  }

  /** Append an event (timestamped by the caller), trim to the ring cap, schedule a persist. */
  log(event: ActivityEvent): void {
    this.events.push(event);
    if (this.events.length > RING_CAP) {
      this.events = this.events.slice(this.events.length - RING_CAP);
    }
    this.schedulePersist();
  }

  /** Newest-first slice for `GET /api/activity`. */
  list(limit: number = RING_CAP): ActivityEvent[] {
    const capped = Math.max(0, Math.min(limit, this.events.length));
    return this.events.slice(this.events.length - capped).reverse();
  }

  /** Persist immediately, cancelling any pending debounced write. */
  flush(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    this.persist();
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.persist();
    }, PERSIST_DEBOUNCE_MS);
    // Never keep the process alive just to flush an activity feed -- worst case we lose the last
    // second of history, which flush()-on-shutdown covers anyway.
    this.persistTimer.unref?.();
  }

  private persist(): void {
    try {
      const path = activityPath(this.homeDir);
      const dir = dirname(path);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const payload: ActivityFile = { events: this.events };
      writeFileSync(path, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    } catch {
      // Best-effort persistence: a read-only home dir must never crash the daemon's request path.
    }
  }
}

function loadEvents(homeDir: string): ActivityEvent[] {
  const path = activityPath(homeDir);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ActivityFile>;
    if (!Array.isArray(parsed.events)) return [];
    return parsed.events.slice(-RING_CAP);
  } catch {
    return [];
  }
}
