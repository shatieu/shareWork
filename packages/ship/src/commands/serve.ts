import { existsSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import type { Command } from 'commander';
import type { FastifyInstance } from 'fastify';
import { createChartroomStation } from 'chartroom/station';
import { createSettingsManagerStation } from 'settings-manager/station';
import { createShipConsoleStation } from 'ship-console/station';
import { createShipInboxStation } from 'ship-inbox/station';
import { createShipLedgerStation } from 'ship-ledger/station';
import { createShipLogStation } from 'ship-log/station';
import { createShipVoiceStation } from 'ship-voice/station';
import { createSkillAnalyticsStation } from 'skill-analytics/station';
import { createHull } from '../hull.js';

/** Same first-try port and walk as `chartroom serve` (plan §4.3) -- the Deck takes over Chart
 * Room's spot, so bookmarks/deep-links keep hitting the same likely port. */
const DEFAULT_PORT = 4317;
const MAX_PORT_ATTEMPTS = 20;

/** Where `--voyage` defaults to when the flag is omitted: the mission progress file, if this
 * working directory has one (plan 03 §4.3). No file -> Voyage disabled, Deck hides the tab. */
const DEFAULT_VOYAGE_RELPATH = join('suite-design', 'overnight', 'progress.json');

async function listenOnFreePort(app: FastifyInstance, startPort: number): Promise<number> {
  let port = startPort;
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt += 1) {
    try {
      // 127.0.0.1 only -- non-negotiable (kickoff; FO-approved posture). The hull must never be
      // reachable from the LAN: it can spawn terminals.
      await app.listen({ port, host: '127.0.0.1' });
      return port;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        port += 1;
        continue;
      }
      throw err;
    }
  }
  throw new Error(`ship: could not find a free port starting at ${startPort}`);
}

/**
 * `ship serve [--port <n>] [--voyage <path>]` (plan 03 §4.3): boots the Captain's Deck -- ONE
 * port serving the Deck UI, every mounted station's API (Chart Room first), and the Voyage feed.
 * The chartroom station's `start()` writes `~/.chartroom/daemon.json` with the HULL's port, so
 * `chartroom open`/`associate` (v1.1) discover the Deck automatically; the hull itself registers
 * in `~/.suite/services.json`.
 */
export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description("Start the Captain's Deck: one local port hosting every suite station.")
    .option('--port <n>', 'port to bind (default: first free port starting at 4317)')
    .option('--voyage <path>', 'progress.json to serve on the Voyage tab (default: ./suite-design/overnight/progress.json when present)')
    .action(async (opts: { port?: string; voyage?: string }) => {
      let voyageFile: string | undefined;
      if (opts.voyage) {
        voyageFile = resolvePath(opts.voyage);
        if (!existsSync(voyageFile)) {
          console.error(`ship: fatal error: voyage file not found: ${voyageFile}`);
          process.exitCode = 2;
          return;
        }
      } else {
        const candidate = resolvePath(DEFAULT_VOYAGE_RELPATH);
        voyageFile = existsSync(candidate) ? candidate : undefined;
      }

      try {
        const chartroom = createChartroomStation();
        if (chartroom.runtimes.length === 0) {
          console.log('ship: no repos registered yet -- run `chartroom register <path>` first.');
        }

        const shipLog = createShipLogStation();
        // Mount order is irrelevant to the fan-out: ship-log resolves the ledger's/inbox's
        // hookEventConsumer contracts lazily per event, and getContract searches the full array.
        const shipLedger = createShipLedgerStation();
        const shipInbox = createShipInboxStation();
        // The Comm's laptop half (VoiceBridge_Spec §9.1): headless, text-mode voice toolset.
        const shipVoice = createShipVoiceStation();
        const settingsManager = createSettingsManagerStation();
        // The Bridge console (Ship_Spec §6): thin Console tab over ship-voice's fleetSource
        // contract + inbox badge + ship-log rollup. Mounted after its contract providers, though
        // order is irrelevant (contracts resolve lazily per request).
        const shipConsole = createShipConsoleStation();
        // Skill analytics (Trio_Specs §A): headless station, no tab -- serves the JSON the
        // console renders and runs its incremental transcript collect off the boot path.
        const skillAnalytics = createSkillAnalyticsStation();
        const hull = await createHull(
          [chartroom, shipLog, shipLedger, shipInbox, shipVoice, settingsManager, shipConsole, skillAnalytics],
          { voyageFile },
        );

        const requestedPort = opts.port ? Number(opts.port) : DEFAULT_PORT;
        const port = await listenOnFreePort(hull.app, requestedPort);
        await hull.start(port);

        const shutdown = () => {
          void hull.stop().finally(() => process.exit(0));
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        const stationNames = hull.stations.map((s) => s.name).join(', ');
        console.log(`ship: Captain's Deck at http://127.0.0.1:${port} (stations: ${stationNames})`);
        console.log(`ship: chartroom serving ${chartroom.runtimes.length} repo(s)`);
        if (voyageFile) {
          console.log(`ship: voyage feed from ${voyageFile}`);
        }
      } catch (err) {
        console.error(`ship: fatal error: ${(err as Error).message}`);
        process.exitCode = 2;
      }
    });
}
