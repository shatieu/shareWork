import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { DECK_CLIENT_HEADER, type HostContext } from 'suite-conventions';

/** Structural mirror of the chartroom station's `spawnTerminal` contract request (the runtime
 * object arrives via `HostContext.getContract` -- stations/hull never import each other's
 * internals, so the type is declared structurally here). */
export interface SpawnTerminalRequest {
  argv: string[];
  cwd: string;
  title?: string;
}
export type SpawnTerminalContract = (request: SpawnTerminalRequest) => void;

export interface ChapelOptions {
  /** Home-directory override -- the Chapel state dir is `<homeDir>/.ship/chaplain`; tests never
   * touch the real home. */
  homeDir?: string;
  /** Working directory the Chaplain session terminal opens in (default `process.cwd()`). */
  repoRoot?: string;
}

export interface ChapelBackend {
  register(app: FastifyInstance, ctx: HostContext): void;
}

/** Dossier ids are `projects/<id>.md` basenames; a request `:id` outside this alphabet is a plain
 * 404 -- it can never become a path segment (traversal-proof; `_chapel` and friends still fit). */
const DOSSIER_ID = /^[A-Za-z0-9_-]+$/;

/** The fixed Chaplain session command (deck-chapel-tab plan). Server-side constant on purpose:
 * the POST body must never be able to influence what gets spawned. */
const CHAPLAIN_ARGV = ['claude', '--agent', 'ship-crew:chaplain'];

/**
 * The hull's Chapel data source (deck-chapel-tab plan): the Chaplain's state home
 * `~/.ship/chaplain/` served read-only (brief + dossiers), plus a write path for confessions
 * (`inbox/`) and a session opener via the chartroom station's `spawnTerminal` contract.
 *
 * Unlike Voyage, the routes are ALWAYS registered -- confessions must work before the first
 * chaplain session ever runs; a missing brief is `200 { brief: null }`, never a 404. Every route
 * requires the `x-ship-deck` header (403 without): same CSRF posture as the claude-session and
 * setup-wizard routes -- a cross-origin page cannot attach a custom header without a CORS
 * preflight, and the hull enables no CORS.
 */
export function createChapelBackend(options: ChapelOptions = {}): ChapelBackend {
  const chapelDir = join(options.homeDir ?? homedir(), '.ship', 'chaplain');
  const projectsDir = join(chapelDir, 'projects');
  const inboxDir = join(chapelDir, 'inbox');
  const repoRoot = options.repoRoot ?? process.cwd();

  return {
    register(app: FastifyInstance, ctx: HostContext): void {
      // Encapsulated scope so the Deck-header guard provably covers every chapel route -- adding
      // a route here can never forget the 403.
      void app.register(async (chapel) => {
        chapel.addHook('onRequest', async (request, reply) => {
          if (request.headers[DECK_CLIENT_HEADER] === undefined) {
            return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
          }
        });

        chapel.get('/api/chapel/brief', async () => {
          const briefPath = join(chapelDir, 'BRIEF.md');
          try {
            const brief = readFileSync(briefPath, 'utf8');
            return { brief, updatedAt: statSync(briefPath).mtime.toISOString() };
          } catch {
            // Missing (or transiently unreadable) brief is a normal pre-first-session state.
            return { brief: null, updatedAt: null };
          }
        });

        chapel.get('/api/chapel/projects', async () => {
          let files: string[];
          try {
            files = readdirSync(projectsDir);
          } catch {
            files = [];
          }
          const projects: { id: string; updatedAt: string }[] = [];
          for (const file of files.filter((f) => f.endsWith('.md')).sort()) {
            try {
              projects.push({
                id: file.slice(0, -'.md'.length),
                updatedAt: statSync(join(projectsDir, file)).mtime.toISOString(),
              });
            } catch {
              // Vanished between readdir and stat -- as good as never listed.
            }
          }
          return { projects };
        });

        chapel.get('/api/chapel/projects/:id', async (request, reply) => {
          const { id } = request.params as { id: string };
          if (!DOSSIER_ID.test(id)) {
            return reply.code(404).send({ error: `unknown project '${id}'` });
          }
          const dossierPath = join(projectsDir, `${id}.md`);
          try {
            const content = readFileSync(dossierPath, 'utf8');
            return { id, content, updatedAt: statSync(dossierPath).mtime.toISOString() };
          } catch {
            return reply.code(404).send({ error: `unknown project '${id}'` });
          }
        });

        chapel.post('/api/chapel/confess', async (request, reply) => {
          const body = (request.body ?? {}) as { text?: unknown; project?: unknown };
          const text = typeof body.text === 'string' ? body.text : '';
          if (text.trim() === '') {
            return reply.code(400).send({ error: 'confession text must not be empty' });
          }

          // The project id only ever appears INSIDE the file body, sanitized to [a-z0-9-]; the
          // filename is derived from the timestamp alone -- a hostile `project` can never become
          // a path (deck-chapel-tab plan, inspector risk r1).
          let header = '';
          if (typeof body.project === 'string') {
            const project = body.project.toLowerCase().replace(/[^a-z0-9-]/g, '');
            if (project !== '') header = `project: ${project}\n\n`;
          }

          mkdirSync(inboxDir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          let target = join(inboxDir, `${stamp}.md`);
          for (let n = 1; existsSync(target); n += 1) {
            target = join(inboxDir, `${stamp}-${n}.md`);
          }
          // Atomic tmp+rename (same discipline as services.json); the tmp lives in the PARENT
          // dir so the chaplain's "read every inbox/ file" bootstrap never sees a half-written one.
          const tmp = join(chapelDir, `.confess-${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
          writeFileSync(tmp, header + text, 'utf8');
          renameSync(tmp, target);
          return reply.code(201).send({ ok: true });
        });

        chapel.post('/api/chapel/session', async (request, reply) => {
          const spawnTerminal = ctx.getContract<SpawnTerminalContract>('chartroom', 'spawnTerminal');
          if (!spawnTerminal) {
            return reply
              .code(501)
              .send({ error: 'chaplain session unavailable: the chartroom station (terminal spawning) is not mounted' });
          }
          try {
            spawnTerminal({ argv: [...CHAPLAIN_ARGV], cwd: repoRoot, title: 'Chaplain' });
          } catch (err) {
            return reply.code(500).send({ error: `could not open a terminal: ${(err as Error).message}` });
          }
          return { ok: true };
        });
      });
    },
  };
}
