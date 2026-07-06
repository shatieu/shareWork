import { createHash } from 'node:crypto';
import { buildTgz, type TarEntry } from './tar.js';
import { PLUGINABLE_KINDS, type LockerItem } from './types.js';

/**
 * Plugin-bundle projection (Locker_Spec §2.1: "locker items are stored as plugin-shaped
 * bundles so this serving is a projection, not a conversion").
 *
 * Layout facts verified against code.claude.com/docs/en/plugins-reference (researcher report
 * 12-sea-chest-researcher.md R3): only `plugin.json` lives under `.claude-plugin/`; component
 * directories (`skills/`, `agents/`, `commands/`, `hooks/hooks.json`, `.mcp.json`) sit at the
 * plugin root.
 *
 * Transfer facts (R4): a URL-hosted marketplace manifest is fetched by plain HTTP GET, but
 * plugin FILES are only ever transferred by git clone or npm install -- never generic HTTP
 * file serving. Hence the npm projection here: each pluginable item is also projected as a
 * minimal npm package (packument + deterministic tgz) that the marketplace handler serves as
 * a private registry, referenced from the manifest via the documented
 * `{"source": "npm", "package": ..., "registry": ...}` source type (R1).
 * Live `/plugin install` against a custom registry is NOT proven here -- parked for the
 * Captain (CAPTAIN-TODO / DECISIONS-NEEDED).
 */

export interface PluginBundle {
  /** Relative POSIX path → file text, including `.claude-plugin/plugin.json`. */
  files: Record<string, string>;
  pluginJson: Record<string, unknown>;
  warnings: string[];
}

export function itemSemver(item: Pick<LockerItem, 'version'>): string {
  return `${item.version}.0.0`;
}

export function isPluginable(item: Pick<LockerItem, 'kind'>): boolean {
  return PLUGINABLE_KINDS.includes(item.kind);
}

/** Project a locker item into a native Claude Code plugin file tree. */
export function itemToPluginBundle(item: LockerItem): PluginBundle {
  const warnings: string[] = [];
  const src = item.content.files;
  const out: Record<string, string> = {};

  const nestAll = (prefix: string) => {
    for (const [path, text] of Object.entries(src)) out[`${prefix}${path}`] = text;
  };

  switch (item.kind) {
    case 'skill': {
      const paths = Object.keys(src);
      const alreadyShaped = paths.every((p) => p.startsWith('skills/'));
      if (alreadyShaped) {
        nestAll('');
      } else if (paths.length === 1 && !('SKILL.md' in src)) {
        out[`skills/${item.name}/SKILL.md`] = src[paths[0]];
        if (!paths[0].endsWith('.md')) {
          warnings.push(`single non-.md file "${paths[0]}" projected as SKILL.md`);
        }
      } else {
        if (!('SKILL.md' in src)) warnings.push('multi-file skill without a SKILL.md');
        nestAll(`skills/${item.name}/`);
      }
      break;
    }
    case 'agent': {
      const paths = Object.keys(src);
      if (paths.every((p) => p.startsWith('agents/'))) {
        nestAll('');
      } else if (paths.length === 1) {
        out[`agents/${item.name}.md`] = src[paths[0]];
      } else {
        nestAll('agents/');
      }
      break;
    }
    case 'hook': {
      for (const [path, text] of Object.entries(src)) {
        if (path === 'hooks.json' || path === 'hooks/hooks.json') out['hooks/hooks.json'] = text;
        else out[path] = text; // hook scripts keep their relative paths
      }
      if (!('hooks/hooks.json' in out)) warnings.push('hook item has no hooks.json');
      break;
    }
    case 'mcp_config': {
      const paths = Object.keys(src);
      if ('.mcp.json' in src) {
        nestAll('');
      } else if (paths.length === 1 && paths[0].endsWith('.json')) {
        out['.mcp.json'] = src[paths[0]];
      } else {
        warnings.push('mcp_config item without a single .json file; projected as-is');
        nestAll('');
      }
      break;
    }
    case 'preset':
    case 'plugin_bundle': {
      nestAll(''); // stored plugin-shaped already
      break;
    }
    default: {
      // Non-pluginable kinds travel via locker_pull / setup manifests, never this projection.
      throw new Error(`kind "${item.kind}" does not project to a plugin bundle`);
    }
  }

  const providedManifest = out['.claude-plugin/plugin.json'];
  let pluginJson: Record<string, unknown>;
  if (providedManifest !== undefined) {
    try {
      pluginJson = JSON.parse(providedManifest) as Record<string, unknown>;
    } catch {
      warnings.push('bundle-provided .claude-plugin/plugin.json is invalid JSON; regenerated');
      pluginJson = defaultPluginJson(item);
    }
  } else {
    pluginJson = defaultPluginJson(item);
  }
  out['.claude-plugin/plugin.json'] = `${JSON.stringify(pluginJson, null, 2)}\n`;

  return { files: out, pluginJson, warnings };
}

function defaultPluginJson(item: LockerItem): Record<string, unknown> {
  return {
    name: item.name,
    description: item.description || `Sea Chest ${item.kind} "${item.name}"`,
    version: itemSemver(item),
  };
}

/** npm package name serving as the registry key for an item (private registry, no npm.org). */
export function itemNpmName(item: Pick<LockerItem, 'name'>): string {
  return item.name.toLowerCase();
}

export interface NpmProjection {
  packageName: string;
  version: string;
  tgz: Buffer;
  shasum: string;
  integrity: string;
}

/** Deterministic npm tarball of the plugin bundle (package/ root, generated package.json). */
export function itemToNpmTarball(item: LockerItem): NpmProjection {
  const bundle = itemToPluginBundle(item);
  const packageName = itemNpmName(item);
  const version = itemSemver(item);
  const entries: TarEntry[] = Object.entries(bundle.files).map(([path, content]) => ({
    name: `package/${path}`,
    content,
  }));
  entries.push({
    name: 'package/package.json',
    content: `${JSON.stringify({ name: packageName, version, private: false }, null, 2)}\n`,
  });
  const mtimeSec = Math.max(0, Math.floor(Date.parse(item.updatedAt) / 1000)) || 0;
  const tgz = buildTgz(entries, mtimeSec);
  return {
    packageName,
    version,
    tgz,
    shasum: createHash('sha1').update(tgz).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(tgz).digest('base64')}`,
  };
}

/** npm registry packument for an item (single published version = current locker version). */
export function itemPackument(item: LockerItem, tarballUrl: string): Record<string, unknown> {
  const projection = itemToNpmTarball(item);
  const versionDoc = {
    name: projection.packageName,
    version: projection.version,
    description: item.description,
    dist: {
      tarball: tarballUrl,
      shasum: projection.shasum,
      integrity: projection.integrity,
    },
  };
  return {
    name: projection.packageName,
    'dist-tags': { latest: projection.version },
    versions: { [projection.version]: versionDoc },
    time: { [projection.version]: item.updatedAt },
  };
}
