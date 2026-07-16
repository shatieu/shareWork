import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { DECK_CLIENT_HEADER } from 'suite-conventions';
import type { RepoRuntime } from '../server.js';
import { cleanClaudeEnv, windowsTerminalAvailable, type SpawnLike } from './claude-session.js';
import {
  applyRepoSetup,
  auditRepoSetup,
  humanItemCommand,
  type SetupApplyResult,
  type SetupAuditItem,
  type SetupOptions,
} from '../../setup/repo-setup.js';

/**
 * The Deck onboarding wizard's three station routes (plan `deck-onboarding-wizard.md` §API 2-4),
 * all CSRF-guarded via the suite's custom header, all thin over `setup/repo-setup.ts`:
 *
 * - `GET  /api/repos/:repoId/setup`      -- audit, pure read, no mutation ever.
 * - `POST /api/repos/:repoId/setup`      -- `{ apply: [itemIds] }`, AUTO items only, idempotent.
 * - `POST /api/repos/:repoId/setup/run`  -- `{ itemId }`, spawns a detached terminal running that
 *   HUMAN item's SERVER-GENERATED command (clone of claude-session.ts's per-OS spawn shape + env
 *   hygiene + SpawnLike seam). Client-supplied command strings are never executed; unknown or
 *   auto ids answer 400.
 */
export interface RepoSetupRouteOptions {
  /** test seams: replace the real audit/apply with fakes. */
  audit?: typeof auditRepoSetup;
  apply?: typeof applyRepoSetup;
  /** forwarded to setup/repo-setup.ts (where the crew marketplace / MCP dists live). */
  suiteRoot?: string;
  /** test seam: replaces `child_process.spawn`. */
  spawner?: SpawnLike;
  /** test seam: pretend to be another OS. */
  platform?: NodeJS.Platform;
  /** test seam / cache: whether Windows Terminal (`wt`) is available. */
  hasWindowsTerminal?: () => boolean;
  /** test seam: the environment to clean and hand to the child (default `process.env`). */
  baseEnv?: NodeJS.ProcessEnv;
}

/**
 * Per-OS detached terminal running a server-generated argv with cwd = the repo root (the plugin /
 * `claude mcp add` commands are scope-sensitive: they MUST run inside the target repo). Same
 * researcher-verified spawn shapes as claude-session.ts's `launchTerminal`, generalized from the
 * fixed `claude` token to an argv: on win32 the tokens are passed as separate args after `cmd /k`
 * (node's own win32 quoting then handles paths with spaces per token -- never a hand-assembled
 * command line); on darwin/linux the DISPLAY string (already shell-quoted by `formatCommand`) is
 * embedded exactly like claude-session.ts embeds `claude`.
 */
function launchCommandTerminal(
  spawner: SpawnLike,
  platform: NodeJS.Platform,
  hasWt: () => boolean,
  env: NodeJS.ProcessEnv,
  title: string,
  repoAbsPath: string,
  argv: string[],
  display: string,
): void {
  let child: ReturnType<SpawnLike>;

  if (platform === 'win32') {
    // wt treats `;` as a command delimiter (claude-session.ts researcher R1 caveat) -- route any
    // `;`-carrying path or token to the verbatim-safe cmd fallback.
    const wtSafe = !repoAbsPath.includes(';') && argv.every((token) => !token.includes(';'));
    if (hasWt() && wtSafe) {
      child = spawner('wt.exe', ['-w', 'new', '-d', repoAbsPath, 'cmd', '/k', ...argv], {
        detached: true,
        stdio: 'ignore',
        env,
      });
    } else {
      child = spawner('cmd', ['/c', 'start', title, 'cmd', '/k', ...argv], {
        detached: true,
        stdio: 'ignore',
        env,
        cwd: repoAbsPath,
      });
    }
  } else if (platform === 'darwin') {
    // Per-request unique launcher file (same TOCTOU reasoning as claude-session.ts).
    const dir = join(homedir(), '.chartroom', 'setup-launchers');
    mkdirSync(dir, { recursive: true });
    const launcher = join(dir, `setup-run-${Date.now()}-${randomBytes(4).toString('hex')}.command`);
    writeFileSync(launcher, `#!/bin/sh\ncd "${repoAbsPath.replace(/"/g, '\\"')}" && ${display}\n`, 'utf8');
    chmodSync(launcher, 0o755);
    child = spawner('open', ['-a', 'Terminal', launcher], { detached: true, stdio: 'ignore', env });
  } else {
    child = spawner(
      'x-terminal-emulator',
      ['-e', `sh -c 'cd "${repoAbsPath.replace(/"/g, '\\"')}" && ${display}'`],
      { detached: true, stdio: 'ignore', env, cwd: repoAbsPath },
    );
  }

  // Async spawn errors after the response is sent must not crash the daemon.
  child.on?.('error', () => {});
  child.unref();
}

export function registerRepoSetupRoutes(
  app: FastifyInstance,
  repos: RepoRuntime[],
  options: RepoSetupRouteOptions = {},
): void {
  const audit = options.audit ?? auditRepoSetup;
  const apply = options.apply ?? applyRepoSetup;
  const setupOptions: SetupOptions = { suiteRoot: options.suiteRoot };
  const spawner = options.spawner ?? (spawn as unknown as SpawnLike);
  const platform = options.platform ?? process.platform;
  const hasWt = options.hasWindowsTerminal ?? windowsTerminalAvailable;

  /** Shared guard: CSRF header first (nothing leaks to headerless callers), then repo lookup. */
  function guard(
    request: { headers: Record<string, unknown>; params: unknown },
    reply: { code: (n: number) => { send: (body: unknown) => unknown } },
  ): RepoRuntime | undefined {
    if ((request.headers as Record<string, unknown>)[DECK_CLIENT_HEADER] === undefined) {
      reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
      return undefined;
    }
    const { repoId } = request.params as { repoId: string };
    const repo = repos.find((r) => r.id === repoId);
    if (!repo) {
      reply.code(404).send({ error: `unknown repo '${repoId}'` });
      return undefined;
    }
    return repo;
  }

  app.get('/api/repos/:repoId/setup', async (request, reply) => {
    const repo = guard(request, reply);
    if (!repo) return reply;
    try {
      const items: SetupAuditItem[] = audit(repo.absPath, setupOptions);
      return { repoId: repo.id, items };
    } catch (err) {
      return reply.code(500).send({ error: `setup audit failed: ${(err as Error).message}` });
    }
  });

  app.post('/api/repos/:repoId/setup', async (request, reply) => {
    const repo = guard(request, reply);
    if (!repo) return reply;

    const body = request.body as { apply?: unknown } | null;
    const ids = body?.apply;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      return reply.code(400).send({ error: 'body must be { "apply": ["<itemId>", ...] }' });
    }

    let results: SetupApplyResult[];
    try {
      // applyRepoSetup throws BEFORE applying anything on unknown/human ids -- a bad request
      // never half-runs. Per-item failures come back as { ok: false } results instead.
      results = apply(repo.absPath, ids as string[], setupOptions);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    return { results };
  });

  app.post('/api/repos/:repoId/setup/run', async (request, reply) => {
    const repo = guard(request, reply);
    if (!repo) return reply;

    const body = request.body as { itemId?: unknown } | null;
    const itemId = body && typeof body.itemId === 'string' ? body.itemId : '';
    if (!itemId) {
      return reply.code(400).send({ error: 'body must be { "itemId": "<human item id>" }' });
    }

    // Commands come from the server-side item table ONLY -- an unknown or auto id has no command.
    const command = humanItemCommand(repo.absPath, itemId, setupOptions);
    if (!command) {
      return reply.code(400).send({ error: `'${itemId}' is not a runnable human setup item` });
    }

    try {
      const env = cleanClaudeEnv(options.baseEnv);
      launchCommandTerminal(
        spawner,
        platform,
        hasWt,
        env,
        `Setup — ${repo.name}`,
        repo.absPath,
        command.argv,
        command.display,
      );
    } catch (err) {
      return reply.code(500).send({ error: `could not open a terminal: ${(err as Error).message}` });
    }

    // FE contract: bare `{ ok: true }` -- the command text the wizard shows comes from the
    // audit's own `command` field, not from this response.
    return { ok: true };
  });
}
