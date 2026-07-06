import { itemNpmName, isPluginable } from './bundle.js';
import { marketplaceUrl } from './marketplace.js';
import type { SeaChestStore } from './store.js';
import type { LockerItem, LockerKind } from './types.js';

/**
 * `locker_setup_machine` (Locker_Spec §2.2): "the one-step new-laptop flow: installs the
 * marketplace, pulls global settings templates, registers suite services."
 *
 * The tool runs on the PLATFORM, which cannot touch the calling machine -- so it returns a
 * structured SETUP MANIFEST that the calling Claude session executes locally (run the
 * marketplace-add command, write the listed files, register the listed services). File writes
 * default to `write-if-absent` so a setup run never clobbers an existing machine's config;
 * items can opt into `overwrite` via `content.meta.writeMode`.
 */

export interface SetupFileWrite {
  itemName: string;
  kind: LockerKind;
  /** Path inside the item's `content.files`. */
  sourcePath: string;
  /** Where the session should write it. `~/` prefixes are the caller's home directory. */
  targetPath: string;
  content: string;
  mode: 'write-if-absent' | 'overwrite';
}

export interface SetupManifest {
  profile: string | null;
  /** Profile item names that no longer exist in the locker (reported, never guessed). */
  missingItems: string[];
  marketplace: {
    url: string;
    addCommand: string;
    /** One `/plugin install` per pluginable item in scope. */
    installCommands: string[];
  } | null;
  fileWrites: SetupFileWrite[];
  /** `content.meta.services` entries carried through for suite-service registration
   * (~/.suite/services.json seam -- consumed by the suite CLI, phase 4+). */
  services: unknown[];
  notes: string[];
}

export interface SetupMachineOptions {
  /** Public platform base URL; without it (or a token) the marketplace step is omitted. */
  baseUrl?: string;
  /** Plaintext marketplace token to embed in the add-URL (minted via the UI/API). */
  marketplaceToken?: string;
}

export async function buildSetupManifest(
  store: SeaChestStore,
  userId: string,
  profileName: string | undefined,
  options: SetupMachineOptions = {},
): Promise<SetupManifest> {
  const notes: string[] = [];
  const missingItems: string[] = [];
  let items: LockerItem[];
  let profile: string | null = null;

  if (profileName) {
    const p = await store.getProfile(userId, profileName);
    if (!p) {
      notes.push(`machine profile "${profileName}" not found; falling back to ALL locker items`);
    } else {
      profile = p.name;
    }
    const names = profile ? (await store.getProfile(userId, profileName))!.itemNames : null;
    if (names) {
      items = [];
      for (const name of names) {
        const item = await store.getItem(userId, name);
        if (item) items.push(item);
        else missingItems.push(name);
      }
    } else {
      items = await allItems(store, userId);
    }
  } else {
    items = await allItems(store, userId);
  }

  const pluginables = items.filter((i) => isPluginable(i));
  let marketplace: SetupManifest['marketplace'] = null;
  if (options.baseUrl && options.marketplaceToken && pluginables.length > 0) {
    const url = marketplaceUrl(options.baseUrl, userId, options.marketplaceToken);
    const marketplaceName = `sea-chest-${userId.slice(0, 8)}`;
    marketplace = {
      url,
      addCommand: `claude plugin marketplace add "${url}"`,
      installCommands: pluginables.map(
        (item) => `/plugin install ${itemNpmName(item)}@${marketplaceName}`,
      ),
    };
  } else if (pluginables.length > 0) {
    notes.push(
      'marketplace step omitted: platform base URL and/or marketplace token unavailable ' +
        '(mint a token on the locker page, or pull items individually via locker_pull)',
    );
  }

  const fileWrites: SetupFileWrite[] = [];
  const services: unknown[] = [];
  for (const item of items) {
    const meta = item.content.meta ?? {};
    if (Array.isArray(meta.services)) services.push(...meta.services);
    if (isPluginable(item)) continue; // travels via the marketplace rail
    const mode = meta.writeMode === 'overwrite' ? 'overwrite' : 'write-if-absent';
    for (const [sourcePath, content] of Object.entries(item.content.files)) {
      fileWrites.push({
        itemName: item.name,
        kind: item.kind,
        sourcePath,
        targetPath: targetPathFor(item, sourcePath, meta),
        content,
        mode,
      });
    }
  }

  if (fileWrites.some((w) => w.mode === 'write-if-absent')) {
    notes.push('file writes are write-if-absent by default; existing files are left untouched');
  }

  return { profile, missingItems, marketplace, fileWrites, services, notes };
}

function targetPathFor(
  item: LockerItem,
  sourcePath: string,
  meta: Record<string, unknown>,
): string {
  if (typeof meta.targetPath === 'string' && meta.targetPath.length > 0) {
    // Single-file items may name their exact destination (e.g. "~/.claude/CLAUDE.md").
    const single = Object.keys(item.content.files).length === 1;
    return single ? meta.targetPath : `${meta.targetPath.replace(/\/+$/, '')}/${sourcePath}`;
  }
  switch (item.kind) {
    case 'settings_template':
      return `~/.suite/templates/${item.name}/${sourcePath}`;
    case 'claude_md':
      return `~/.suite/claude-md/${item.name}/${sourcePath}`;
    default:
      return `~/.suite/sea-chest/${item.name}/${sourcePath}`;
  }
}

async function allItems(store: SeaChestStore, userId: string): Promise<LockerItem[]> {
  const summaries = await store.listItems(userId);
  const items: LockerItem[] = [];
  for (const s of summaries) {
    const item = await store.getItem(userId, s.name);
    if (item) items.push(item);
  }
  return items;
}
