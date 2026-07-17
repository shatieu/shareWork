import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { SettingsEditError } from './editor.js';

/**
 * Template packs (Trio_Specs §B): curated permission groups applied with-diff to any writable
 * scope. Built-in packs ship as versioned data files in this package's `templates/` directory;
 * user-defined packs live in `~/.suite/settings-templates/` (mirroring the backups root) and are
 * merged into the same catalog. The apply pipeline is source-agnostic.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
/** Works from both `src/` (vitest) and `dist/` (built): templates/ sits at the package root. */
const DEFAULT_TEMPLATES_DIR = join(HERE, '..', 'templates');

export const templatePackSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string(),
  permissions: z.object({
    allow: z.array(z.string()).default([]),
    deny: z.array(z.string()).default([]),
    ask: z.array(z.string()).default([]),
  }),
});

export type TemplatePack = z.infer<typeof templatePackSchema>;

export interface LoadedTemplatePack extends TemplatePack {
  source: 'builtin' | 'user';
}

export interface TemplateCatalog {
  packs: LoadedTemplatePack[];
  /** Human-readable degradations: skipped malformed user packs, suffixed id collisions. */
  warnings: string[];
}

export interface TemplateDirOptions {
  /** Built-in packs directory override (tests). */
  templatesDir?: string;
  /** User packs directory override (tests) -- default `~/.suite/settings-templates`. */
  userTemplatesDir?: string;
}

export function userTemplatesDir(homeDir?: string): string {
  return join(homeDir ?? homedir(), '.suite', 'settings-templates');
}

/** Built-in packs only. A malformed built-in pack is a packaging bug -- fail loudly rather than
 * serving a partial catalog. */
export function loadTemplatePacks(templatesDir: string = DEFAULT_TEMPLATES_DIR): TemplatePack[] {
  if (!existsSync(templatesDir)) return [];
  const packs: TemplatePack[] = [];
  for (const name of readdirSync(templatesDir).sort()) {
    if (!name.endsWith('.json')) continue;
    const raw = readFileSync(join(templatesDir, name), 'utf8');
    packs.push(templatePackSchema.parse(JSON.parse(raw)));
  }
  return packs;
}

/**
 * The merged catalog: built-in packs first, then user packs from `~/.suite/settings-templates/`.
 * Id collision policy: BUILT-IN WINS -- the user pack is served under a `-user`-suffixed id with
 * a warning, never dropped and never shadowing the curated pack. A malformed user pack degrades
 * to a warning (a user's stray file must not take the whole catalog down).
 */
export function loadTemplateCatalog(options: TemplateDirOptions = {}): TemplateCatalog {
  const builtins: LoadedTemplatePack[] = loadTemplatePacks(options.templatesDir).map((pack) => ({
    ...pack,
    source: 'builtin' as const,
  }));
  const packs: LoadedTemplatePack[] = [...builtins];
  const warnings: string[] = [];
  const taken = new Set(packs.map((pack) => pack.id));

  const userDir = options.userTemplatesDir ?? userTemplatesDir();
  if (existsSync(userDir)) {
    for (const name of readdirSync(userDir).sort()) {
      if (!name.endsWith('.json')) continue;
      let pack: TemplatePack;
      try {
        pack = templatePackSchema.parse(JSON.parse(readFileSync(join(userDir, name), 'utf8')));
      } catch (err) {
        warnings.push(`user template pack '${name}' is invalid and was skipped: ${(err as Error).message.split('\n')[0]}`);
        continue;
      }
      let id = pack.id;
      if (taken.has(id)) {
        id = `${pack.id}-user`;
        for (let n = 2; taken.has(id); n += 1) id = `${pack.id}-user-${n}`;
        warnings.push(`user pack id '${pack.id}' collides with an existing pack -- served as '${id}' (built-in wins)`);
      }
      taken.add(id);
      packs.push({ ...pack, id, source: 'user' });
    }
  }
  return { packs, warnings };
}

export function getTemplatePack(id: string, options: TemplateDirOptions = {}): LoadedTemplatePack | undefined {
  return loadTemplateCatalog(options).packs.find((pack) => pack.id === id);
}

/**
 * Persists a user-defined pack to the user templates dir: schema-validated, refused on id
 * collision (built-in ids are reserved; an existing user pack is never silently replaced), and
 * written atomically (same-dir tmp + rename -- the editor's rail-5 pattern).
 */
export function saveUserTemplatePack(candidate: unknown, options: TemplateDirOptions = {}): LoadedTemplatePack {
  const parsed = templatePackSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new SettingsEditError(
      'schema-violation',
      'template pack fails schema validation',
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  const pack = parsed.data;
  if (loadTemplatePacks(options.templatesDir).some((builtin) => builtin.id === pack.id)) {
    throw new SettingsEditError('invalid-content', `pack id '${pack.id}' is reserved by a built-in pack -- pick another id`);
  }
  const dir = options.userTemplatesDir ?? userTemplatesDir();
  const targetPath = join(dir, `${pack.id}.json`);
  if (existsSync(targetPath)) {
    throw new SettingsEditError('invalid-content', `a user pack with id '${pack.id}' already exists`);
  }
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${targetPath}.tmp-${process.pid}`;
  writeFileSync(tmpPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
  renameSync(tmpPath, targetPath);
  return { ...pack, source: 'user' };
}
