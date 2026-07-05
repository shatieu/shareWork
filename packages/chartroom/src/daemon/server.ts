import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { RepoState } from './repo-state.js';
import { registerChartroomRoutes } from './register-routes.js';
import type { RepoRegistrar } from './routes/repo-register.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `chartroom`'s own published `dist/public` -- where `scripts/copy-ui-dist.mjs` copies the built
 * `chartroom-ui` bundle to (plan §2/§4.1) so a bare `npm install chartroom` is self-contained. */
const DEFAULT_UI_DIST_DIR = join(HERE, '..', '..', 'dist', 'public');

/** One registered repo's identity plus a live accessor for its current in-memory state -- the
 * accessor indirection (rather than a plain `state` field) means chokidar-triggered rebuilds
 * (plan §4.2) can swap the snapshot without the server/routes holding a stale reference. */
export interface RepoRuntime {
  id: string;
  name: string;
  absPath: string;
  getState: () => RepoState;
  /** Swaps this repo's in-memory state (plan §5.3) -- used by the new doc-save route so a save's
   * own `rebuild()` is reflected immediately, synchronously with the save response, without
   * waiting for chokidar's own debounced rebuild (which still fires too, redundantly and
   * harmlessly, per plan §5.3's "do not suppress the watcher" decision). */
  setState: (state: RepoState) => void;
}

export interface BuildServerOptions {
  /** Overrides where the UI static bundle is served from -- tests point this at a temp/missing
   * directory rather than depending on `chartroom-ui` actually being built. */
  uiDistDir?: string;
  /** Live-registration callback owned by `commands/serve.ts` (v1.1, used by `chartroom open`
   * against an already-running daemon). When absent, `POST /api/repos/register` answers 501 --
   * tests and embedded servers opt in. */
  registrar?: RepoRegistrar;
}

/**
 * Fastify app factory (plan §4.1): registers the built UI static mount (prefix `/`) and every
 * Chart Room API route (extracted into `register-routes.ts::registerChartroomRoutes` by the
 * Captain's Deck refactor, plan 03 §4.4 -- this factory is now a thin composition of exactly
 * `Fastify()` + UI static + those routes, so standalone `chartroom serve` behavior is unchanged).
 * Returns the app *without* calling `.listen()` so both `commands/serve.ts` and tests can drive
 * it -- tests via `app.inject()`, never a real TCP socket. The `repos` array is shared and
 * MUTABLE by design (v1.1): the serve command's registrar pushes newly registered repos into it
 * live.
 */
export function buildServer(repos: RepoRuntime[], options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const uiDistDir = options.uiDistDir ?? DEFAULT_UI_DIST_DIR;

  if (existsSync(uiDistDir)) {
    void app.register(fastifyStatic, {
      root: uiDistDir,
      prefix: '/',
    });
  }

  registerChartroomRoutes(app, repos, { registrar: options.registrar });

  return app;
}
