import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  isPluginable,
  itemPackument,
  itemSemver,
  itemToNpmTarball,
  itemToPluginBundle,
} from '../src/bundle.js';
import { readTar } from '../src/tar.js';
import type { LockerItem } from '../src/types.js';

function item(partial: Partial<LockerItem> & Pick<LockerItem, 'kind' | 'name'>): LockerItem {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    userId: '11111111-1111-1111-1111-111111111111',
    teamId: null,
    description: 'a test item',
    content: { files: { 'SKILL.md': '# hi' } },
    version: 3,
    published: false,
    createdAt: '2026-07-06T10:00:00.000Z',
    updatedAt: '2026-07-06T11:00:00.000Z',
    ...partial,
  };
}

describe('plugin bundle projection (docs-verified layout, researcher R3)', () => {
  it('nests a single-file skill as skills/<name>/SKILL.md + generates .claude-plugin/plugin.json', () => {
    const bundle = itemToPluginBundle(item({ kind: 'skill', name: 'my-skill' }));
    expect(Object.keys(bundle.files).sort()).toEqual([
      '.claude-plugin/plugin.json',
      'skills/my-skill/SKILL.md',
    ]);
    expect(bundle.pluginJson).toMatchObject({ name: 'my-skill', version: '3.0.0' });
  });

  it('passes through an already plugin-shaped skill', () => {
    const bundle = itemToPluginBundle(
      item({
        kind: 'skill',
        name: 'shaped',
        content: {
          files: { 'skills/shaped/SKILL.md': '# s', 'skills/shaped/extra.md': 'x' },
        },
      }),
    );
    expect(Object.keys(bundle.files).sort()).toEqual([
      '.claude-plugin/plugin.json',
      'skills/shaped/SKILL.md',
      'skills/shaped/extra.md',
    ].sort());
    expect(bundle.warnings).toEqual([]);
  });

  it('projects agents to agents/<name>.md and hooks to hooks/hooks.json', () => {
    const agent = itemToPluginBundle(
      item({ kind: 'agent', name: 'reviewer', content: { files: { 'reviewer.md': 'r' } } }),
    );
    expect(agent.files['agents/reviewer.md']).toBe('r');

    const hook = itemToPluginBundle(
      item({
        kind: 'hook',
        name: 'guard',
        content: { files: { 'hooks.json': '{}', 'scripts/guard.mjs': '//' } },
      }),
    );
    expect(hook.files['hooks/hooks.json']).toBe('{}');
    expect(hook.files['scripts/guard.mjs']).toBe('//');
  });

  it('projects a single-json mcp_config to .mcp.json', () => {
    const bundle = itemToPluginBundle(
      item({ kind: 'mcp_config', name: 'my-mcp', content: { files: { 'server.json': '{}' } } }),
    );
    expect(bundle.files['.mcp.json']).toBe('{}');
  });

  it('preserves a bundle-provided plugin.json (plugin_bundle kind)', () => {
    const provided = JSON.stringify({ name: 'custom', version: '9.9.9' });
    const bundle = itemToPluginBundle(
      item({
        kind: 'plugin_bundle',
        name: 'full',
        content: { files: { '.claude-plugin/plugin.json': provided, 'skills/a/SKILL.md': 'a' } },
      }),
    );
    expect(bundle.pluginJson).toEqual({ name: 'custom', version: '9.9.9' });
  });

  it('refuses non-pluginable kinds (settings_template/claude_md travel via setup manifests)', () => {
    expect(isPluginable(item({ kind: 'settings_template', name: 't' }))).toBe(false);
    expect(() =>
      itemToPluginBundle(item({ kind: 'settings_template', name: 't' })),
    ).toThrow(/does not project/);
  });
});

describe('npm projection (researcher R4: plugin files transfer via npm/git only)', () => {
  it('builds a tarball with package/package.json + the plugin bundle under package/', () => {
    const projection = itemToNpmTarball(item({ kind: 'skill', name: 'My-Skill' }));
    expect(projection.packageName).toBe('my-skill');
    expect(projection.version).toBe('3.0.0');
    const entries = readTar(gunzipSync(projection.tgz));
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual([
      'package/.claude-plugin/plugin.json',
      'package/package.json',
      'package/skills/My-Skill/SKILL.md',
    ]);
    const pkg = JSON.parse(entries.find((e) => e.name === 'package/package.json')!.content as string);
    expect(pkg).toMatchObject({ name: 'my-skill', version: '3.0.0' });
  });

  it('emits matching shasum (sha1) and integrity (sha512) for the exact tarball bytes', () => {
    const projection = itemToNpmTarball(item({ kind: 'skill', name: 'my-skill' }));
    expect(projection.shasum).toBe(createHash('sha1').update(projection.tgz).digest('hex'));
    expect(projection.integrity).toBe(
      `sha512-${createHash('sha512').update(projection.tgz).digest('base64')}`,
    );
  });

  it('packument carries dist-tags.latest and the tarball URL', () => {
    const it3 = item({ kind: 'skill', name: 'my-skill' });
    const doc = itemPackument(it3, 'https://x/u/1/registry/t/tok/my-skill/-/my-skill-3.0.0.tgz');
    expect(doc.name).toBe('my-skill');
    expect(doc['dist-tags']).toEqual({ latest: '3.0.0' });
    const versions = doc.versions as Record<string, { dist: { tarball: string } }>;
    expect(versions['3.0.0'].dist.tarball).toContain('my-skill-3.0.0.tgz');
    expect(itemSemver(it3)).toBe('3.0.0');
  });
});
