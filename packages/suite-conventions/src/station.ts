import type { FastifyInstance } from 'fastify';
import type { HookEventEnvelope } from './events.js';

/**
 * Host-side context handed to every station (Ship_Spec §2 one-hull revision): the hull's port
 * (known only once `.listen()` succeeds -- `undefined` during route registration), a logger, and
 * the in-process contract lookup.
 *
 * In-process contract rule (documents the spec's "old HTTP contracts become in-process
 * interfaces"): a station may export its contract *type declarations* from a dedicated public
 * entry; consumers receive the runtime object only via `getContract` -- never by importing
 * another station's internals. Stations depend on `suite-conventions` (types) and never on each
 * other; the hull is the only package that imports stations.
 */
export interface HostContext {
  /** The hull's bound port. Defined in `start()`/`stop()`, undefined during `registerRoutes`. */
  port?: number;
  /** Named in-process contract lookup across stations; `undefined` when the station or contract
   * isn't mounted -- callers must treat that as "feature unavailable", never an error. */
  getContract<T>(station: string, name: string): T | undefined;
  /** Hull-prefixed line logger (console in production, capture arrays in tests). */
  log(line: string): void;
}

/**
 * The typed station-plugin contract (plan 03 §4.2). A station is one suite feature mounted into
 * the hull: it registers its Fastify routes at boot, optionally contributes a Deck tab, and gets
 * lifecycle calls for its watchers/discovery files.
 */
export interface StationDescriptor {
  /** Unique station name, e.g. 'chartroom'. Doubles as the `getContract` station key. */
  name: string;
  /** Deck tab registration ('docs' / 'Docs'). Omit for headless stations. Tab ids must be unique
   * across the hull -- duplicate ids are a boot error, not a last-one-wins. */
  tab?: { id: string; title: string };
  /** Register all of this station's routes on the shared Fastify app. Called before `.listen()`;
   * `ctx.port` is not yet known here. Route-namespace convention: existing chartroom routes keep
   * `/api/repos/...` (deep-link compatibility); new stations use `/api/<station>/*`; the hull owns
   * `/api/hull/*`, `/api/voyage*`, and `/api/chapel*`. */
  registerRoutes(app: FastifyInstance, ctx: HostContext): void | Promise<void>;
  /** Post-listen startup: watchers, discovery-file writes (`ctx.port` is defined). */
  start?(ctx: HostContext): void | Promise<void>;
  /** Shutdown: close watchers, delete discovery files. Must be best-effort safe. */
  stop?(): void | Promise<void>;
  /** Named in-process contracts this station offers to others via `HostContext.getContract`. */
  contracts?: Record<string, unknown>;
}

/**
 * Well-known contract name under which a station offers a {@link HookEventConsumer}
 * (plan 05 §2). ship-log's ingest endpoint owns the hook-event *transport* (one endpoint, one
 * spool -- Bridge phase 1's "packages add consumers, not new transport" design); any other
 * station that wants a class of hook events registers this contract and receives them in-process.
 */
export const HOOK_EVENT_CONSUMER_CONTRACT = 'hookEventConsumer';

/**
 * A station's declaration of interest in raw hook-event envelopes flowing through ship-log's
 * ingest path (HTTP route, spool drain, and standalone CLI alike). Consumed events are the
 * consumer's responsibility to persist; ship-log neither sidecars nor stores them further.
 * `consume` errors propagate to the ingest caller (HTTP sync path -> non-2xx -> the emitter
 * spools the event for the next drain -- a failing consumer delays delivery, never loses it).
 */
export interface HookEventConsumer {
  /** Raw hook event names this consumer wants, e.g. `['TaskCreated', 'TaskCompleted']`. */
  events: readonly string[];
  consume(envelope: HookEventEnvelope): void | Promise<void>;
}
