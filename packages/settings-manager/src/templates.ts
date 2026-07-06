import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Template packs (Trio_Specs §B): curated permission groups applied with-diff to any writable
 * scope. v1 ships them as versioned data files in this package's `templates/` directory; the
 * spec's marketplace-repo home is parked in DECISIONS-NEEDED -- the apply pipeline is
 * source-agnostic, so relocating packs later is a file move.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
/** Works from both `src/` (vitest) and `dist/` (built): templates/ sits at the package root. */
const DEFAULT_TEMPLATES_DIR = join(HERE, '..', 'templates');

const templatePackSchema = z.object({
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

export function loadTemplatePacks(templatesDir: string = DEFAULT_TEMPLATES_DIR): TemplatePack[] {
  if (!existsSync(templatesDir)) return [];
  const packs: TemplatePack[] = [];
  for (const name of readdirSync(templatesDir).sort()) {
    if (!name.endsWith('.json')) continue;
    const raw = readFileSync(join(templatesDir, name), 'utf8');
    // A malformed pack is a packaging bug -- fail loudly rather than serving a partial catalog.
    packs.push(templatePackSchema.parse(JSON.parse(raw)));
  }
  return packs;
}

export function getTemplatePack(id: string, templatesDir?: string): TemplatePack | undefined {
  return loadTemplatePacks(templatesDir).find((pack) => pack.id === id);
}
