import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { diffFileMaps } from './diff.js';
import { buildSetupManifest } from './setup-machine.js';
import type { SeaChestStore } from './store.js';
import {
  itemNameSchema,
  lockerFilesSchema,
  lockerKindSchema,
  LOCKER_KINDS,
  SeaChestError,
  type LockerItem,
} from './types.js';

/**
 * The Sea Chest MCP surface (Locker_Spec §2.2), designed for Harbor's EXISTING `/api/mcp`
 * server: `registerSeaChestTools(server, store, { getUserId })` is the whole mount.
 *
 * Note on the spec's client-perspective signatures (`locker_push(path, ...)`): these tools run
 * on the PLATFORM, which cannot read or write the calling machine's filesystem. The calling
 * session does the file I/O -- so push takes `files` (path → content it already read), pull
 * RETURNS files for the session to write, and diff takes the local copies. `source_path` /
 * `target_path` ride along as hints only.
 */

export interface SeaChestToolsOptions {
  /** Resolve the authenticated platform user for one tool call. `extra` is the MCP SDK's
   * per-request context (Harbor derives the user from its session/token there). */
  getUserId: (extra: unknown) => string | Promise<string>;
  /** Public platform base URL (for locker_setup_machine's marketplace step). */
  baseUrl?: string;
  /** Plaintext marketplace token provider for locker_setup_machine (e.g. mint-on-demand or
   * look up a stored one). Omitted → setup manifests skip the marketplace step with a note. */
  getMarketplaceToken?: (userId: string) => Promise<string | null>;
}

const asResult = (payload: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
});

const asError = (message: string) => ({
  isError: true as const,
  content: [{ type: 'text' as const, text: message }],
});

export function registerSeaChestTools(
  server: McpServer,
  store: SeaChestStore,
  options: SeaChestToolsOptions,
): void {
  const run = async (extra: unknown, fn: (userId: string) => Promise<unknown>) => {
    try {
      const userId = await options.getUserId(extra);
      return asResult(await fn(userId));
    } catch (err) {
      if (err instanceof SeaChestError) return asError(`${err.code}: ${err.message}`);
      throw err;
    }
  };

  server.registerTool(
    'locker_list',
    {
      title: "List the Sea Chest locker's items",
      description:
        "What's in my locker. Returns summaries (name, kind, version, published, timestamps) " +
        `of your Sea Chest items, optionally filtered by kind (${LOCKER_KINDS.join('|')}).`,
      inputSchema: {
        kind: lockerKindSchema.optional().describe('Filter to one item kind.'),
      },
    },
    async (args, extra) =>
      run(extra, async (userId) => ({ items: await store.listItems(userId, args.kind) })),
  );

  server.registerTool(
    'locker_pull',
    {
      title: 'Pull a locker item into this project',
      description:
        'Fetch an item (its files, by name) from your Sea Chest locker so you can write it ' +
        'into the current project/machine. Optionally a specific version. Write the returned ' +
        '`files` relative to `target_path` (or the suggested target).',
      inputSchema: {
        item: itemNameSchema.describe('Locker item name.'),
        version: z.number().int().positive().optional()
          .describe('Specific version; defaults to the latest.'),
        target_path: z.string().optional().describe('Where the caller intends to write.'),
      },
    },
    async (args, extra) =>
      run(extra, async (userId) => {
        const item = await store.getItem(userId, args.item);
        if (!item) throw new SeaChestError('not_found', `no locker item "${args.item}"`);
        let files = item.content.files;
        let version = item.version;
        if (args.version !== undefined && args.version !== item.version) {
          const v = await store.getVersion(userId, args.item, args.version);
          if (!v) {
            throw new SeaChestError(
              'not_found',
              `item "${args.item}" has no version ${args.version} (latest is ${item.version})`,
            );
          }
          files = v.content.files;
          version = v.version;
        }
        return {
          name: item.name,
          kind: item.kind,
          version,
          description: item.description,
          files,
          meta: item.content.meta ?? {},
          target_path: args.target_path ?? suggestedTarget(item),
        };
      }),
  );

  server.registerTool(
    'locker_push',
    {
      title: 'Store/update an item in the locker',
      description:
        '"Store this skill in my locker." Read the files locally first, then pass them as ' +
        '`files` (relative path → content). Creates the item at version 1 or bumps the ' +
        'version when content changed; identical content is reported `unchanged`.',
      inputSchema: {
        name: itemNameSchema.describe('Locker item name (stable identity; re-push bumps).'),
        kind: lockerKindSchema,
        files: lockerFilesSchema.describe('Relative POSIX path → file content.'),
        description: z.string().max(2000).optional(),
        source_path: z.string().optional()
          .describe('Where the files came from on the pushing machine (hint, stored in meta).'),
        meta: z.record(z.string(), z.unknown()).optional()
          .describe('Item metadata (e.g. targetPath, writeMode, services).'),
      },
    },
    async (args, extra) =>
      run(extra, async (userId) => {
        const meta = { ...(args.meta ?? {}) } as Record<string, unknown>;
        if (args.source_path) meta.sourcePath = args.source_path;
        const result = await store.pushItem(userId, {
          name: args.name,
          kind: args.kind,
          description: args.description,
          content: { files: args.files, ...(Object.keys(meta).length ? { meta } : {}) },
        });
        return {
          outcome: result.outcome,
          name: result.item.name,
          kind: result.item.kind,
          version: result.item.version,
        };
      }),
  );

  server.registerTool(
    'locker_diff',
    {
      title: 'Diff local files against a locker item',
      description:
        'Compare the local copy of an item (pass the local file contents) against the locker ' +
        'version. Returns per-file status (added/removed/modified/same) with unified diffs -- ' +
        'feeds drift detection and the future config-matrix UI.',
      inputSchema: {
        item: itemNameSchema.describe('Locker item name.'),
        local_files: lockerFilesSchema.describe('Local relative path → content to compare.'),
      },
    },
    async (args, extra) =>
      run(extra, async (userId) => {
        const item = await store.getItem(userId, args.item);
        if (!item) throw new SeaChestError('not_found', `no locker item "${args.item}"`);
        const files = diffFileMaps(args.local_files, item.content.files);
        return {
          name: item.name,
          lockerVersion: item.version,
          clean: files.every((f) => f.status === 'same'),
          files,
        };
      }),
  );

  server.registerTool(
    'locker_setup_machine',
    {
      title: 'One-step new-machine setup manifest',
      description:
        'The new-laptop flow: returns a setup manifest for this machine -- a marketplace add ' +
        'command + plugin installs for pluginable items, file writes for settings templates / ' +
        'CLAUDE.md snippets (write-if-absent by default), and suite service registrations. ' +
        'Execute the returned steps locally. Optionally scoped to a named machine profile.',
      inputSchema: {
        profile: z.string().optional().describe('Machine profile name (e.g. "laptop-default").'),
      },
    },
    async (args, extra) =>
      run(extra, async (userId) => {
        const token = options.getMarketplaceToken
          ? await options.getMarketplaceToken(userId)
          : null;
        return buildSetupManifest(store, userId, args.profile, {
          baseUrl: options.baseUrl,
          marketplaceToken: token ?? undefined,
        });
      }),
  );
}

function suggestedTarget(item: LockerItem): string {
  const meta = item.content.meta ?? {};
  if (typeof meta.targetPath === 'string' && meta.targetPath) return meta.targetPath;
  switch (item.kind) {
    case 'skill':
      return `.claude/skills/${item.name}/`;
    case 'agent':
      return `.claude/agents/`;
    case 'claude_md':
      return `~/.suite/claude-md/${item.name}/`;
    case 'settings_template':
      return `~/.suite/templates/${item.name}/`;
    default:
      return `./`;
  }
}
