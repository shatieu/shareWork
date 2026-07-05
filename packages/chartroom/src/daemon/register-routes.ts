import type { FastifyInstance } from 'fastify';
import type { RepoRuntime } from './server.js';
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

export interface ChartroomRouteOptions {
  /** Live-registration callback owned by the serve command / station lifecycle (v1.1). When
   * absent, `POST /api/repos/register` answers 501 -- tests and embedded servers opt in. */
  registrar?: RepoRegistrar;
}

/**
 * Registers ALL of Chart Room's `/api` routes on an existing Fastify app (plan 03 §4.4): the
 * dynamic per-repo raw-asset route plus every JSON API route -- everything `buildServer` provides
 * except the UI static mount and `.listen()`. This is the extraction seam that lets the Captain's
 * Deck hull mount Chart Room as its first station while standalone `chartroom serve` keeps
 * byte-identical behavior (both compose exactly this function).
 *
 * Route-namespace convention (suite-wide): Chart Room keeps its existing `/api/repos/...` and
 * `/api/inbox`/`/api/mcp` namespaces unchanged -- v1.1 deep links and `chartroom open` URLs work
 * under the hull with zero changes. Future stations get `/api/<station>/*`; the hull owns
 * `/api/hull/*` and `/api/voyage*`.
 */
export function registerChartroomRoutes(
  app: FastifyInstance,
  repos: RepoRuntime[],
  options: ChartroomRouteOptions = {},
): void {
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
}
