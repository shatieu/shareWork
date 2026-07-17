import { spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
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

/** What one awaited `claude -p` chat spawn came back with. */
export interface ChatSpawnResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Seam for the chat route's `claude -p` invocation: tests inject a recorder/faker; production
 * uses {@link defaultChatSpawn} (real child process, cleaned env, timeout kill). */
export type ChatSpawn = (binary: string, args: string[], opts: { timeoutMs: number }) => Promise<ChatSpawnResult>;

export interface ChapelOptions {
  /** Home-directory override -- the Chapel state dir is `<homeDir>/.ship/chaplain`; tests never
   * touch the real home. */
  homeDir?: string;
  /** Working directory the Chaplain session terminal opens in (default `process.cwd()`). */
  repoRoot?: string;
  /** Chat spawn seam (tests only) -- production spawns the resolved `claude` binary. */
  chatSpawn?: ChatSpawn;
  /** Chat reply timeout override (default {@link CHAT_TIMEOUT_MS}). */
  chatTimeoutMs?: number;
}

export interface ChapelBackend {
  register(app: FastifyInstance, ctx: HostContext): void;
}

/** Dossier ids are `projects/<id>.md` basenames; a request `:id` outside this alphabet is a plain
 * 404 -- it can never become a path segment (traversal-proof; `_chapel` and friends still fit). */
const DOSSIER_ID = /^[A-Za-z0-9_-]+$/;

/** Archive stamps are ISO-derived filenames (`2026-07-16T17-48-43-472Z`, `-N` on collision):
 * digits, dashes, `T`, `Z` only. Anything else is a plain 404, never a path segment. */
const CONFESSION_STAMP = /^[0-9TZ-]+$/;

/** The fixed Chaplain session command (deck-chapel-tab plan). Server-side constant on purpose:
 * the POST body must never be able to influence what gets spawned. */
const CHAPLAIN_ARGV = ['claude', '--agent', 'ship-crew:chaplain'];

/** The agent every chat spawn runs as -- fixed server-side, like {@link CHAPLAIN_ARGV}. */
const CHAPLAIN_AGENT = 'ship-crew:chaplain';

/** A chat turn is a full headless chaplain run (reads brief + dossiers before answering). */
const CHAT_TIMEOUT_MS = 180_000;

/** Confession list excerpts -- enough to recognize the confession, never the whole text. */
const EXCERPT_LENGTH = 160;

/** One persisted chat-log line (`chat-log.jsonl`): who said what, when. */
export interface ChapelChatMessage {
  role: 'captain' | 'chaplain';
  text: string;
  at: string;
}

/**
 * Same PATH-walk as ship-voice's fleet.ts / ship-log's summarize.ts (kept duplicated on purpose:
 * the hull and stations never import each other's internals -- Ship_Spec §2 discipline rule):
 * Windows npm installs put a `claude.cmd` shim on PATH which Node refuses to spawn without
 * `shell: true`; the shim's real target is
 * `<dir>/node_modules/@anthropic-ai/claude-code/bin/claude.exe`.
 * `SHIP_CHAPEL_CLAUDE_PATH` is the documented override.
 */
export function resolveChapelClaudeBinary(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = env.SHIP_CHAPEL_CLAUDE_PATH;
  if (override) return override;
  if (platform !== 'win32') return 'claude';
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (!dir) continue;
    const exe = join(dir, 'claude.exe');
    if (existsSync(exe)) return exe;
    if (existsSync(join(dir, 'claude.cmd')) || existsSync(join(dir, 'claude'))) {
      const shimTarget = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
      if (existsSync(shimTarget)) return shimTarget;
    }
  }
  return 'claude';
}

let cachedBinary: string | undefined;
function chapelClaudeBinary(): string {
  cachedBinary ??= resolveChapelClaudeBinary();
  return cachedBinary;
}

/** Same env hygiene as chartroom's claude-session route (duplicated on purpose, see
 * {@link resolveChapelClaudeBinary}): a `claude` spawned from inside a Claude session must not
 * inherit the parent session's identity markers. */
function cleanClaudeEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv, INVOCATION_ID: '' };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_CODE_CHILD_SESSION;
  delete env.CLAUDE_CODE_BRIDGE_SESSION_ID;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.AI_AGENT;
  return env;
}

/** Production chat spawn: awaited (unlike ship-voice's fire-and-forget), captured stdout/stderr,
 * hard timeout kill. Rejects on spawn error or timeout; a non-zero exit is the CALLER's business
 * (it has the stderr to build a readable 500 from). */
function defaultChatSpawn(binary: string, args: string[], opts: { timeoutMs: number }): Promise<ChatSpawnResult> {
  return new Promise<ChatSpawnResult>((resolve, reject) => {
    const child = spawn(binary, args, {
      env: cleanClaudeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`the chaplain did not answer within ${Math.round(opts.timeoutMs / 1000)}s`));
    }, opts.timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

/** Split a stored confession body into its sanitized `project:` header (if any) and the text. */
function parseConfession(raw: string): { project: string | null; text: string } {
  const match = /^project: ([a-z0-9-]+)\n\n/.exec(raw);
  if (match) return { project: match[1], text: raw.slice(match[0].length) };
  return { project: null, text: raw };
}

/**
 * The hull's Chapel data source (deck-chapel-tab plan): the Chaplain's state home
 * `~/.ship/chaplain/` served read-only (brief + dossiers), plus a write path for confessions
 * (`inbox/` for the chaplain's rite, a durable copy in `archive/` for the Captain's history),
 * a headless chat channel (`claude -p --agent ship-crew:chaplain` on a dedicated persisted
 * session id), and a session opener via the chartroom station's `spawnTerminal` contract.
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
  const archiveDir = join(chapelDir, 'archive');
  const chatSessionFile = join(chapelDir, 'chat-session.json');
  const chatLogFile = join(chapelDir, 'chat-log.jsonl');
  const repoRoot = options.repoRoot ?? process.cwd();
  const chatSpawn = options.chatSpawn ?? defaultChatSpawn;
  const chatTimeoutMs = options.chatTimeoutMs ?? CHAT_TIMEOUT_MS;

  /** Serializer for chat sends: two concurrent `-p --resume` runs against the same session id is
   * fork-vs-contention territory (wave2-c findings §2 caveat) -- the second send simply waits. */
  let chatChain: Promise<unknown> = Promise.resolve();

  function readChatSessionId(): string | null {
    try {
      const parsed = JSON.parse(readFileSync(chatSessionFile, 'utf8')) as { sessionId?: unknown };
      return typeof parsed.sessionId === 'string' && parsed.sessionId !== '' ? parsed.sessionId : null;
    } catch {
      return null;
    }
  }

  function writeChatSessionId(sessionId: string): void {
    mkdirSync(chapelDir, { recursive: true });
    const tmp = join(chapelDir, `.chat-session-${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
    writeFileSync(tmp, `${JSON.stringify({ sessionId })}\n`, 'utf8');
    renameSync(tmp, chatSessionFile);
  }

  function appendChatLog(entries: ChapelChatMessage[]): void {
    mkdirSync(chapelDir, { recursive: true });
    appendFileSync(chatLogFile, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(''), 'utf8');
  }

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
          let name = `${stamp}.md`;
          for (let n = 1; existsSync(join(inboxDir, name)); n += 1) {
            name = `${stamp}-${n}.md`;
          }
          // Atomic tmp+rename (same discipline as services.json); the tmp lives in the PARENT
          // dir so the chaplain's "read every inbox/ file" bootstrap never sees a half-written one.
          const tmp = join(chapelDir, `.confess-${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
          writeFileSync(tmp, header + text, 'utf8');
          renameSync(tmp, join(inboxDir, name));
          // Durable copy for the Captain's history: inbox/ is the chaplain's consumable queue
          // (the rite DELETES each file once folded into a dossier), archive/ is what the
          // confessions endpoints serve (wave2-c findings §4, option a).
          mkdirSync(archiveDir, { recursive: true });
          writeFileSync(join(archiveDir, name), header + text, 'utf8');
          return reply.code(201).send({ ok: true });
        });

        chapel.get('/api/chapel/confessions', async () => {
          let files: string[];
          try {
            files = readdirSync(archiveDir);
          } catch {
            files = [];
          }
          const confessions: { stamp: string; project: string | null; excerpt: string; updatedAt: string }[] = [];
          // Stamp-derived names sort lexicographically = chronologically; newest first for the UI.
          for (const file of files.filter((f) => f.endsWith('.md')).sort().reverse()) {
            try {
              const { project, text } = parseConfession(readFileSync(join(archiveDir, file), 'utf8'));
              confessions.push({
                stamp: file.slice(0, -'.md'.length),
                project,
                excerpt: text.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_LENGTH),
                updatedAt: statSync(join(archiveDir, file)).mtime.toISOString(),
              });
            } catch {
              // Vanished between readdir and read -- as good as never listed.
            }
          }
          return { confessions };
        });

        chapel.get('/api/chapel/confessions/:stamp', async (request, reply) => {
          const { stamp } = request.params as { stamp: string };
          if (!CONFESSION_STAMP.test(stamp)) {
            return reply.code(404).send({ error: `unknown confession '${stamp}'` });
          }
          const path = join(archiveDir, `${stamp}.md`);
          try {
            const { project, text } = parseConfession(readFileSync(path, 'utf8'));
            return { stamp, project, text, updatedAt: statSync(path).mtime.toISOString() };
          } catch {
            return reply.code(404).send({ error: `unknown confession '${stamp}'` });
          }
        });

        chapel.post('/api/chapel/chat', async (request, reply) => {
          const body = (request.body ?? {}) as { text?: unknown };
          const text = typeof body.text === 'string' ? body.text : '';
          if (text.trim() === '') {
            return reply.code(400).send({ error: 'chat text must not be empty' });
          }

          const run = chatChain.then(async () => {
            const stored = readChatSessionId();
            const sessionId = stored ?? randomUUID();
            // FIXED argv shape, server-side constants throughout; `text` is the ONLY
            // body-derived value and it travels as a single argv element handed straight to
            // spawn (never through a shell string) -- the body cannot steer the command.
            const args = [
              '-p',
              text,
              '--agent',
              CHAPLAIN_AGENT,
              ...(stored === null ? ['--session-id', sessionId] : ['--resume', stored]),
              '--output-format',
              'json',
            ];
            const result = await chatSpawn(chapelClaudeBinary(), args, { timeoutMs: chatTimeoutMs });
            if (result.code !== 0) {
              const detail = result.stderr.trim().slice(0, 400);
              throw new Error(`claude exited with code ${String(result.code)}${detail ? `: ${detail}` : ''}`);
            }
            let replyText = result.stdout.trim();
            let replySession = sessionId;
            try {
              const parsed = JSON.parse(result.stdout) as { result?: unknown; session_id?: unknown };
              if (typeof parsed.result === 'string') replyText = parsed.result;
              if (typeof parsed.session_id === 'string' && parsed.session_id !== '') replySession = parsed.session_id;
            } catch {
              // Non-JSON stdout (older CLI, plain text): serve it verbatim rather than dropping it.
            }
            writeChatSessionId(replySession);
            const at = new Date().toISOString();
            appendChatLog([
              { role: 'captain', text, at },
              { role: 'chaplain', text: replyText, at },
            ]);
            return { reply: replyText, sessionId: replySession };
          });
          // The chain must survive a failed send (next send starts fresh, not rejected).
          chatChain = run.catch(() => undefined);
          try {
            return await run;
          } catch (err) {
            return reply.code(500).send({ error: `chaplain chat failed: ${(err as Error).message}` });
          }
        });

        chapel.get('/api/chapel/chat/log', async () => {
          let raw: string;
          try {
            raw = readFileSync(chatLogFile, 'utf8');
          } catch {
            // No conversation yet -- a normal state, like the missing brief.
            return { messages: [] };
          }
          const messages: ChapelChatMessage[] = [];
          for (const line of raw.split('\n')) {
            if (line.trim() === '') continue;
            try {
              const parsed = JSON.parse(line) as Partial<ChapelChatMessage>;
              if (
                (parsed.role === 'captain' || parsed.role === 'chaplain') &&
                typeof parsed.text === 'string' &&
                typeof parsed.at === 'string'
              ) {
                messages.push({ role: parsed.role, text: parsed.text, at: parsed.at });
              }
            } catch {
              // A torn/corrupt line loses that line, never the whole history.
            }
          }
          return { messages };
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
