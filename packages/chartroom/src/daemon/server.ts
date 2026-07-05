import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { RepoState } from './repo-state.js';
import { registerReposRoute } from './routes/repos.js';
import { registerDocsRoutes } from './routes/docs.js';
import { registerDocSaveRoute } from './routes/doc-save.js';
import { registerDocAssetsRoute } from './routes/doc-assets.js';
import { registerDocCheckboxRoute } from './routes/doc-checkbox.js';
import { registerDocAskMeRoute } from './routes/doc-ask-me.js';
import { registerInboxRoute } from './routes/inbox.js';
import { registerMcpRoute } from './routes/mcp.js';
import { registerRawRoute } from './routes/raw.js';
import { registerRepoRegisterRoute, type RepoRegistrar } from './routes/repo-register.js';

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
 * Fastify app factory (plan §4.1): registers the built UI static mount (prefix `/`), the dynamic
 * per-repo raw-asset route (`/api/repos/:repoId/raw/*`, see routes/raw.ts), and the JSON API
 * routes. Returns the app *without* calling `.listen()` so both `commands/serve.ts` and tests can
 * drive it -- tests via `app.inject()`, never a real TCP socket. The `repos` array is shared and
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

  // Raw repo assets are served by a dynamic route over the (mutable) runtimes array rather than
  // one boot-fixed `@fastify/static` mount per repo -- the one structural change that makes live
  // registration (`POST /api/repos/register`, used by `chartroom open`) possible at all, since
  // fastify cannot add routes/mounts after `.listen()`.
  registerRawRoute(app, repos);

  registerReposRoute(app, repos);
  registerDocsRoutes(app, repos);
  registerDocSaveRoute(app, repos);
  registerDocAssetsRoute(app, repos);
  registerDocCheckboxRoute(app, repos);
  registerDocAskMeRoute(app, repos);
  registerInboxRoute(app, repos);
  registerMcpRoute(app, repos);
  registerRepoRegisterRoute(app, options.registrar);

  return app;
}
