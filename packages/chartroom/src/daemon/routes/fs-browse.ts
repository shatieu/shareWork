import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { DECK_CLIENT_HEADER } from 'suite-conventions';

/**
 * `GET /api/fs/list` -- the Deck folder picker's server-side directory browser (plan
 * `deck-onboarding-wizard.md` §API 1). A browser page cannot hand the daemon a real absolute path
 * from a native dialog, so the LOCALHOST daemon walks its own filesystem instead. This route
 * intentionally browses the whole FS -- Captain-approved revival of the quarantined
 * `routes/fs.js` (plan's decision note); the posture is unchanged (127.0.0.1 bind + host
 * allowlist) and the hardening kept: DIRECTORIES ONLY, dot-entries and node_modules skipped,
 * roots view, and the suite's CSRF header on every request.
 */

export interface FsBrowseEntry {
  name: string;
  path: string;
  /** true when this directory has a `.git` child, i.e. it is registrable as-is. */
  isGitRepo: boolean;
}

export interface FsBrowseResponse {
  /** the directory listed, or null for the filesystem-roots view. */
  path: string | null;
  /** one level up, or null at a root (and in the roots view). */
  parent: string | null;
  entries: FsBrowseEntry[];
}

export interface FsBrowseRouteOptions {
  /** test seam: pretend to be another OS (drives-vs-`/` roots branch). */
  platform?: NodeJS.Platform;
  /** test seam: the home directory offered in the roots view. */
  homeDir?: string;
}

/** Windows junk that is pure noise in a "pick a repo" folder browser. Dot-entries and
 * node_modules are skipped by the startsWith('.') check / this set below. */
const SKIP_NAMES = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information']);

function hasGitDir(path: string): boolean {
  try {
    return existsSync(join(path, '.git'));
  } catch {
    return false;
  }
}

function listDrivesWin32(): FsBrowseEntry[] {
  const drives: FsBrowseEntry[] = [];
  for (let code = 65; code <= 90; code += 1) {
    const root = `${String.fromCharCode(code)}:${sep}`;
    if (existsSync(root)) {
      drives.push({ name: root, path: root, isGitRepo: false });
    }
  }
  return drives;
}

function listSubdirs(abs: string): FsBrowseEntry[] {
  const out: FsBrowseEntry[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || SKIP_NAMES.has(entry.name)) continue;
    const path = join(abs, entry.name);
    out.push({ name: entry.name, path, isGitRepo: hasGitDir(path) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return out;
}

export function registerFsBrowseRoute(app: FastifyInstance, options: FsBrowseRouteOptions = {}): void {
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? homedir();

  app.get('/api/fs/list', async (request, reply) => {
    if (request.headers[DECK_CLIENT_HEADER] === undefined) {
      return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
    }

    const { path } = request.query as { path?: string };

    if (!path || path.trim() === '') {
      // Roots view: drive letters on win32; home + `/` elsewhere (plan §API 1).
      const entries =
        platform === 'win32'
          ? listDrivesWin32()
          : [
              { name: home, path: home, isGitRepo: hasGitDir(home) },
              { name: '/', path: '/', isGitRepo: false },
            ];
      const response: FsBrowseResponse = { path: null, parent: null, entries };
      return response;
    }

    const abs = resolve(path.trim());
    let stats;
    try {
      stats = statSync(abs);
    } catch {
      return reply.code(404).send({ error: `no such directory: ${abs}` });
    }
    if (!stats.isDirectory()) {
      return reply.code(404).send({ error: `not a directory: ${abs}` });
    }

    let entries: FsBrowseEntry[];
    try {
      entries = listSubdirs(abs);
    } catch (err) {
      // Unreadable (EPERM system dirs and the like): a readable miss, not a crash. 404 keeps 403
      // unambiguous as "missing CSRF header" on this daemon.
      return reply.code(404).send({ error: `cannot read ${abs}: ${(err as Error).message}` });
    }

    const parent = dirname(abs);
    const response: FsBrowseResponse = {
      path: abs,
      parent: parent === abs ? null : parent,
      entries,
    };
    return response;
  });
}
