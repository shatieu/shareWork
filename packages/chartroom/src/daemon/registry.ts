import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';

const REGISTRY_DIR_NAME = '.chartroom';
const REGISTRY_FILE_NAME = 'repos.json';

export interface RegisteredRepo {
  id: string;
  absPath: string;
  addedAt: string;
}

interface RegistryFile {
  repos: RegisteredRepo[];
}

/**
 * Path to the flat repo registry file (plan §5). Accepts an optional `homeDir` override so tests
 * can point at a disposable temp directory instead of the real user home directory -- never
 * writes to the real `~/.chartroom/repos.json` from a test.
 */
export function registryPath(homeDir: string = homedir()): string {
  return join(homeDir, REGISTRY_DIR_NAME, REGISTRY_FILE_NAME);
}

/**
 * Read the registry from disk. Returns an empty list if the file (or its parent directory)
 * doesn't exist yet, or if it exists but is unparsable/wrong-shape -- a missing/corrupt registry
 * is never a fatal error, just "no repos registered yet".
 */
export function listRepos(homeDir: string = homedir()): RegisteredRepo[] {
  const path = registryPath(homeDir);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<RegistryFile>;
    if (!Array.isArray(parsed.repos)) return [];
    return parsed.repos;
  } catch {
    return [];
  }
}

function writeRepos(homeDir: string, repos: RegisteredRepo[]): void {
  const path = registryPath(homeDir);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const payload: RegistryFile = { repos };
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

/**
 * Slugify a repo directory's basename into a filesystem/URL-safe repo id. Deliberately a small,
 * standalone implementation rather than importing phase-1's `id.ts::slugify` -- repo-ids and
 * doc-ids are different namespaces kept conceptually separate (plan §5), not literally the same
 * function reused across concerns.
 */
const DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g');

function slugifyRepoName(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(DIACRITICS_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'repo';
}

function generateRepoId(base: string, existingIds: ReadonlySet<string>): string {
  const slug = slugifyRepoName(base);
  if (!existingIds.has(slug)) return slug;
  let n = 2;
  while (existingIds.has(`${slug}-${n}`)) {
    n += 1;
  }
  return `${slug}-${n}`;
}

/**
 * Register a repo (idempotent, deduped by resolved absolute path -- not by id). Returns the
 * existing entry unchanged if this path is already registered, otherwise appends a new entry with
 * a collision-suffixed id and persists the registry.
 */
export function registerRepo(absPath: string, homeDir: string = homedir()): RegisteredRepo {
  const resolved = resolvePath(absPath);
  const repos = listRepos(homeDir);

  const existing = repos.find((r) => resolvePath(r.absPath) === resolved);
  if (existing) return existing;

  const existingIds = new Set(repos.map((r) => r.id));
  const id = generateRepoId(basename(resolved), existingIds);
  const entry: RegisteredRepo = { id, absPath: resolved, addedAt: new Date().toISOString() };

  writeRepos(homeDir, [...repos, entry]);
  return entry;
}
