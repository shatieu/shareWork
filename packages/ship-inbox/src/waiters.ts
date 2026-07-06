/**
 * In-process long-poll registry (plan 06 §1.1): the resolver hook's
 * `GET /permissions/:id/decision?waitMs=` parks here; the browser's decision POST (and the
 * expire POST) release every waiter for that id immediately instead of making the hook spin.
 * Purely in-memory -- a hull restart drops parked polls, and the resolver's loop simply
 * re-polls (the decision itself is durable in SQLite).
 */
export interface DecisionWaiters {
  /** Resolves `true` as soon as `notify(id)` fires, `false` after `timeoutMs`. */
  wait(id: string, timeoutMs: number): Promise<boolean>;
  /** Releases every parked waiter for `id`. */
  notify(id: string): void;
  /** Parked-waiter count (health/introspection). */
  size(): number;
}

export function createDecisionWaiters(): DecisionWaiters {
  const waiters = new Map<string, Set<(notified: boolean) => void>>();

  return {
    wait(id: string, timeoutMs: number): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        let set = waiters.get(id);
        if (!set) {
          set = new Set();
          waiters.set(id, set);
        }
        const bucket = set;

        const settle = (notified: boolean): void => {
          clearTimeout(timer);
          bucket.delete(settle);
          if (bucket.size === 0) waiters.delete(id);
          resolve(notified);
        };
        const timer = setTimeout(() => settle(false), timeoutMs);
        bucket.add(settle);
      });
    },

    notify(id: string): void {
      const set = waiters.get(id);
      if (!set) return;
      for (const settle of [...set]) settle(true);
    },

    size(): number {
      let n = 0;
      for (const set of waiters.values()) n += set.size;
      return n;
    },
  };
}
