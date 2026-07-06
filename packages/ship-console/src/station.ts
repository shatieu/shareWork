import type { FastifyInstance } from 'fastify';
import type { HostContext, StationDescriptor } from 'suite-conventions';

/**
 * The Bridge console station (Ship_Spec §6, package 9 -- DELIBERATELY THIN).
 *
 * One read-only overview endpoint feeding the Deck's Console tab: the fleet from
 * `claude agents --json`, a state rollup, the inbox pending badge, and today's changelog digest.
 * No storage, no daemon, no dispatch box (spec §6's dispatch box / ledger sidebar / mission
 * live-view are later phases; this package is the "most sherlockable module" and stays minimal).
 *
 * Cross-station discipline (suite-conventions station.ts): everything arrives via in-process
 * contracts, all optional -- a missing sibling degrades the overview, never breaks it:
 *  - `ship-voice.fleetSource`  -- the fleet reader ship-voice already runs (verified live parser
 *    of `claude agents --json`; reused, not duplicated). Absent or failing -> `available: false`.
 *  - `ship-inbox.pendingCounts` -- badge counts. Absent -> `pending: null`.
 *  - `ship-log.getRollup`      -- today's Haiku digest. Absent or no rollup yet -> `rollup: null`.
 */

/** Structural mirror of ship-voice's FleetSession (`claude agents --json` shape, observed
 * 2026-07-06). Duplicated locally per repo convention (chartroom-ui's client.ts, ship-voice's
 * PendingPermission): consumers type the *contract shape*, never import sibling packages. */
export interface ConsoleFleetSession {
  sessionId: string;
  name?: string;
  cwd?: string;
  /** 'background' | 'interactive' */
  kind?: string;
  startedAt?: number;
  /** 'blocked' | 'done' (absent while simply running) */
  state?: string;
  /** 'busy' | 'idle' */
  status?: string;
}

/** The `getContract('ship-voice', 'fleetSource')` shape. `null` = "couldn't see the fleet". */
export interface ConsoleFleetSource {
  list(): Promise<ConsoleFleetSession[] | null>;
}

/** One row of the Console tab's fleet table -- normalized server-side so the UI stays dumb. */
export interface ConsoleSessionView {
  sessionId: string;
  /** Session name, else the cwd's folder name, else a sessionId stub -- never empty. */
  name: string;
  /** cwd's folder name (the repo, in practice). */
  repo: string | null;
  cwd: string | null;
  kind: string | null;
  /** Effective state: `state` ('blocked'/'done') wins over `status` ('busy'/'idle');
   * neither present = 'running'. */
  state: string;
  startedAt: number | null;
}

export interface ConsoleOverview {
  /** false = the fleet could not be read (no ship-voice station, or `claude agents` failed);
   * pending/rollup are still served -- the tab degrades, never blanks. */
  available: boolean;
  sessions: ConsoleSessionView[];
  counts: { total: number; busy: number; idle: number; blocked: number; done: number };
  pending: { permissionsPending: number; questionsOpen: number } | null;
  rollup: { date: string; digest_md: string } | null;
  generatedAt: string;
}

export interface ShipConsoleStationOptions {
  /** Test seam: overrides the ship-voice fleetSource contract lookup. */
  fleetSource?: ConsoleFleetSource;
  now?: () => Date;
}

function folderOf(cwd: string | undefined): string | null {
  if (!cwd) return null;
  const folder = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return folder && folder.length > 0 ? folder : null;
}

export function effectiveStateOf(session: Pick<ConsoleFleetSession, 'state' | 'status'>): string {
  return session.state ?? session.status ?? 'running';
}

export function toSessionView(session: ConsoleFleetSession): ConsoleSessionView {
  const repo = folderOf(session.cwd);
  return {
    sessionId: session.sessionId,
    name: session.name ?? repo ?? `session ${session.sessionId.slice(0, 8)}`,
    repo,
    cwd: session.cwd ?? null,
    kind: session.kind ?? null,
    state: effectiveStateOf(session),
    startedAt: session.startedAt ?? null,
  };
}

export function rollupCounts(sessions: readonly ConsoleSessionView[]): ConsoleOverview['counts'] {
  const counts = { total: sessions.length, busy: 0, idle: 0, blocked: 0, done: 0 };
  for (const session of sessions) {
    if (session.state === 'busy') counts.busy += 1;
    else if (session.state === 'idle') counts.idle += 1;
    else if (session.state === 'blocked') counts.blocked += 1;
    else if (session.state === 'done') counts.done += 1;
  }
  return counts;
}

export function createShipConsoleStation(options: ShipConsoleStationOptions = {}): StationDescriptor {
  const now = options.now ?? (() => new Date());

  return {
    name: 'ship-console',
    tab: { id: 'console', title: 'Console' },

    registerRoutes(app: FastifyInstance, ctx: HostContext) {
      app.get('/api/ship-console/overview', async (): Promise<ConsoleOverview> => {
        const fleetSource =
          options.fleetSource ?? ctx.getContract<ConsoleFleetSource>('ship-voice', 'fleetSource');

        // A throwing fleet read is treated exactly like a null one: the contract promises
        // null-not-throw, but the console must stay up even against a misbehaving sibling.
        let fleet: ConsoleFleetSession[] | null = null;
        if (fleetSource) {
          try {
            fleet = await fleetSource.list();
          } catch {
            fleet = null;
          }
        }
        const sessions = (fleet ?? []).map(toSessionView);

        const pendingCounts = ctx.getContract<() => { permissionsPending: number; questionsOpen: number }>(
          'ship-inbox',
          'pendingCounts',
        );
        const getRollup = ctx.getContract<(date: string) => { digest_md: string } | undefined>(
          'ship-log',
          'getRollup',
        );
        const today = now().toISOString().slice(0, 10);
        const rollup = getRollup ? getRollup(today) : undefined;

        return {
          available: fleet !== null,
          sessions,
          counts: rollupCounts(sessions),
          pending: pendingCounts ? pendingCounts() : null,
          rollup: rollup ? { date: today, digest_md: rollup.digest_md } : null,
          generatedAt: now().toISOString(),
        };
      });

      app.get('/api/ship-console/health', async () => ({ ok: true, station: 'ship-console' }));
    },
  };
}
