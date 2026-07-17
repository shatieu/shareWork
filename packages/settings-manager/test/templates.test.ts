import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadTemplateCatalog, saveUserTemplatePack, userTemplatesDir } from '../src/templates.js';

/** User-defined template packs: built-in + user merge, built-in-wins collision policy, and the
 * atomic schema-validated save path. */

let dir: string;
let builtinDir: string;
let userDir: string;

function writePack(target: string, pack: Record<string, unknown>): void {
  writeFileSync(join(target, `${String(pack.id)}.json`), `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
}

const BUILTIN = {
  id: 'crew-defaults',
  name: 'Crew defaults',
  version: '1.0.0',
  description: 'built-in',
  permissions: { allow: ['Bash(git status)'], deny: [], ask: [] },
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'settings-templates-'));
  builtinDir = join(dir, 'builtin');
  userDir = join(dir, 'user');
  mkdirSync(builtinDir, { recursive: true });
  mkdirSync(userDir, { recursive: true });
  writePack(builtinDir, BUILTIN);
});

describe('loadTemplateCatalog', () => {
  it('merges built-in and user packs with source attribution', () => {
    writePack(userDir, { ...BUILTIN, id: 'my-pack', name: 'Mine', description: 'user' });
    const catalog = loadTemplateCatalog({ templatesDir: builtinDir, userTemplatesDir: userDir });
    expect(catalog.packs.map((pack) => [pack.id, pack.source])).toEqual([
      ['crew-defaults', 'builtin'],
      ['my-pack', 'user'],
    ]);
    expect(catalog.warnings).toEqual([]);
  });

  it('id collision: built-in wins, user pack is served under a suffixed id with a warning', () => {
    writePack(userDir, { ...BUILTIN, name: 'Impostor', description: 'user shadow attempt' });
    const catalog = loadTemplateCatalog({ templatesDir: builtinDir, userTemplatesDir: userDir });
    const builtin = catalog.packs.find((pack) => pack.id === 'crew-defaults');
    expect(builtin?.source).toBe('builtin');
    expect(builtin?.name).toBe('Crew defaults');
    const shadowed = catalog.packs.find((pack) => pack.id === 'crew-defaults-user');
    expect(shadowed?.source).toBe('user');
    expect(shadowed?.name).toBe('Impostor');
    expect(catalog.warnings.some((warning) => warning.includes("served as 'crew-defaults-user'"))).toBe(true);
  });

  it('a malformed user pack degrades to a warning, never takes the catalog down', () => {
    writeFileSync(join(userDir, 'broken.json'), '{not json', 'utf8');
    writePack(userDir, { ...BUILTIN, id: 'good-pack' });
    const catalog = loadTemplateCatalog({ templatesDir: builtinDir, userTemplatesDir: userDir });
    expect(catalog.packs.map((pack) => pack.id)).toEqual(['crew-defaults', 'good-pack']);
    expect(catalog.warnings.some((warning) => warning.includes("'broken.json' is invalid"))).toBe(true);
  });

  it('a missing user dir is simply empty', () => {
    const catalog = loadTemplateCatalog({ templatesDir: builtinDir, userTemplatesDir: join(dir, 'nope') });
    expect(catalog.packs).toHaveLength(1);
    expect(catalog.warnings).toEqual([]);
  });
});

describe('saveUserTemplatePack', () => {
  const CANDIDATE = {
    id: 'team-web',
    name: 'Team web',
    version: '1.0.0',
    description: 'from effective',
    permissions: { allow: ['Bash(pnpm *)'], deny: ['Read(./.env)'], ask: [] },
  };

  it('writes the pack atomically and it loads back as a user pack', () => {
    const saved = saveUserTemplatePack(CANDIDATE, { templatesDir: builtinDir, userTemplatesDir: userDir });
    expect(saved.source).toBe('user');
    const onDisk = JSON.parse(readFileSync(join(userDir, 'team-web.json'), 'utf8'));
    expect(onDisk).toEqual(CANDIDATE);
    expect(existsSync(join(userDir, 'team-web.json.tmp-' + String(process.pid)))).toBe(false);
    const catalog = loadTemplateCatalog({ templatesDir: builtinDir, userTemplatesDir: userDir });
    expect(catalog.packs.find((pack) => pack.id === 'team-web')?.source).toBe('user');
  });

  it('schema violations are typed and nothing is written', () => {
    expect(() =>
      saveUserTemplatePack({ ...CANDIDATE, id: 'Bad Id!' }, { templatesDir: builtinDir, userTemplatesDir: userDir }),
    ).toThrowError(expect.objectContaining({ code: 'schema-violation' }));
    expect(existsSync(join(userDir, 'Bad Id!.json'))).toBe(false);
  });

  it('refuses built-in id collisions and overwrites of an existing user pack', () => {
    expect(() =>
      saveUserTemplatePack({ ...CANDIDATE, id: 'crew-defaults' }, { templatesDir: builtinDir, userTemplatesDir: userDir }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-content' }));

    saveUserTemplatePack(CANDIDATE, { templatesDir: builtinDir, userTemplatesDir: userDir });
    expect(() =>
      saveUserTemplatePack(CANDIDATE, { templatesDir: builtinDir, userTemplatesDir: userDir }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-content' }));
  });
});

describe('userTemplatesDir', () => {
  it('mirrors the backups-root layout under ~/.suite', () => {
    expect(userTemplatesDir('/home/o')).toBe(join('/home/o', '.suite', 'settings-templates'));
  });
});
