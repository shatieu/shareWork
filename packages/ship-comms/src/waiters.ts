/**
 * In-process long-poll registry, keyed by to_session id -- the ship-inbox waiter pattern
 * (agent-comms plan Option A names it as the piece to reuse): a `GET /poll?waitMs=` with an
 * empty queue parks here; a send addressed to that session releases every parked waiter
 * immediately instead of making the poller spin. Purely in-memory -- a hull restart drops
 * parked polls and the poller simply re-polls (the messages themselves are durable in SQLite).
 */
export interface MessageWaiters {
  /** Resolves `true` as soon as `notify(session)` fires, `false` after `timeoutMs`. */
  wait(session: string, timeoutMs: number): Promise<boolean>;
  /** Releases every parked waiter for `session`. */
  notify(session: string): void;
  /** Parked-waiter count (health/introspection). */
  size(): number;
}

export function createMessageWaiters(): MessageWaiters {
  const waiters = new Map<string, Set<(notified: boolean) => void>>();

  return {
    wait(session: string, timeoutMs: number): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        let set = waiters.get(session);
        if (!set) {
          set = new Set();
          waiters.set(session, set);
        }
        const bucket = set;

        const settle = (notified: boolean): void => {
          clearTimeout(timer);
          bucket.delete(settle);
          if (bucket.size === 0) waiters.delete(session);
          resolve(notified);
        };
        const timer = setTimeout(() => settle(false), timeoutMs);
        bucket.add(settle);
      });
    },

    notify(session: string): void {
      const set = waiters.get(session);
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
