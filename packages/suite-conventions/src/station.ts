import type { FastifyInstance } from 'fastify';

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
   * `/api/hull/*` and `/api/voyage*`. */
  registerRoutes(app: FastifyInstance, ctx: HostContext): void | Promise<void>;
  /** Post-listen startup: watchers, discovery-file writes (`ctx.port` is defined). */
  start?(ctx: HostContext): void | Promise<void>;
  /** Shutdown: close watchers, delete discovery files. Must be best-effort safe. */
  stop?(): void | Promise<void>;
  /** Named in-process contracts this station offers to others via `HostContext.getContract`. */
  contracts?: Record<string, unknown>;
}
