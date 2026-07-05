import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

export interface FsDirEntry {
  name: string;
  path: string;
  /** true when this directory has a `.git` child, i.e. it can be registered as-is. */
  isGitRepo: boolean;
}

export interface FsListResponse {
  /** the directory listed, or null for the filesystem roots view. */
  path: string | null;
  /** one level up, or null when already at a root (or in the roots view). */
  parent: string | null;
  /** convenience starting point for the picker UI. */
  home: string;
  dirs: FsDirEntry[];
}

/** Directory names not worth showing in a folder picker — pure noise for "pick a repo to
 * register". The user can still reach anything by typing a path into the CLI. */
const SKIP_NAMES = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information']);

function listDrivesWin32(): FsDirEntry[] {
  const drives: FsDirEntry[] = [];
  for (let code = 65; code <= 90; code += 1) {
    const root = `${String.fromCharCode(code)}:${sep}`;
    if (existsSync(root)) {
      drives.push({ name: root, path: root, isGitRepo: false });
    }
  }
  return drives;
}

function listSubdirs(abs: string): FsDirEntry[] {
  const out: FsDirEntry[] = [];
  const entries = readdirSync(abs, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || SKIP_NAMES.has(entry.name)) continue;
    const path = join(abs, entry.name);
    let isGitRepo = false;
    try {
      isGitRepo = existsSync(join(path, '.git'));
    } catch {
      /* unreadable → treat as plain dir */
    }
    out.push({ name: entry.name, path, isGitRepo });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return out;
}

/**
 * `GET /api/fs/list?path=<abs>` — server-side folder browser for the UI's "register repo" picker
 * (the browser sandbox can't hand us a real absolute path from a native dialog, but this daemon
 * is a local tool serving 127.0.0.1, so it can walk its own filesystem). No `path` → the roots
 * view (drive letters on win32, `/` elsewhere). Unreadable directories return 403 with a message
 * rather than a crash.
 */
export function registerFsRoutes(app: FastifyInstance): void {
  app.get('/api/fs/list', async (request, reply) => {
    const { path } = request.query as { path?: string };
    const home = homedir();

    if (!path || path.trim() === '') {
      const dirs = process.platform === 'win32' ? listDrivesWin32() : listSubdirs('/');
      const response: FsListResponse = { path: null, parent: null, home, dirs };
      return response;
    }

    const abs = resolve(path);
    let stats;
    try {
      stats = statSync(abs);
    } catch {
      return reply.code(404).send({ error: `no such directory: ${abs}` });
    }
    if (!stats.isDirectory()) {
      return reply.code(400).send({ error: `not a directory: ${abs}` });
    }

    let dirs: FsDirEntry[];
    try {
      dirs = listSubdirs(abs);
    } catch (err) {
      return reply.code(403).send({ error: `cannot read ${abs}: ${(err as Error).message}` });
    }

    const parentPath = dirname(abs);
    const response: FsListResponse = {
      path: abs,
      parent: parentPath === abs ? null : parentPath,
      home,
      dirs,
    };
    return response;
  });
}
