/**
 * sea-chest -- the Sea Chest, code-complete seam (Locker_Spec phases 1-3).
 * Harbor mounts: `registerSeaChestTools` on its /api/mcp server, `handleMarketplaceRequest`
 * + `handleSeaChestApiRequest` in route handlers, `SeaChestPage` (./ui export) on the locker
 * page, `SupabaseSeaChestStore` over its Supabase client. Migrations in supabase/migrations.
 */
export {
  LOCKER_KINDS,
  PLUGINABLE_KINDS,
  SeaChestError,
  canonicalContentJson,
  filePathSchema,
  itemNameSchema,
  lockerContentSchema,
  lockerFilesSchema,
  lockerKindSchema,
  pushInputSchema,
} from './types.js';
export type {
  LockerContent,
  LockerItem,
  LockerItemSummary,
  LockerKind,
  LockerVersion,
  LockerVersionSummary,
  MachineProfile,
  MarketplaceTokenInfo,
  PushInput,
  PushOutcome,
  PushResult,
} from './types.js';

export {
  MemorySeaChestStore,
  hashMarketplaceToken,
  mintMarketplaceToken,
  tokenHashEquals,
} from './store.js';
export type { SeaChestStore } from './store.js';

export { SupabaseSeaChestStore } from './supabase-store.js';
export type {
  PgBuilder,
  PgResult,
  PgRow,
  PostgrestLikeClient,
  SupabaseSeaChestStoreOptions,
} from './supabase-store.js';

export {
  isPluginable,
  itemNpmName,
  itemPackument,
  itemSemver,
  itemToNpmTarball,
  itemToPluginBundle,
} from './bundle.js';
export type { NpmProjection, PluginBundle } from './bundle.js';

export { handleMarketplaceRequest, marketplaceUrl } from './marketplace.js';
export type {
  MarketplaceOptions,
  MarketplaceRequest,
  SeaChestHttpResponse,
} from './marketplace.js';

export { registerSeaChestTools } from './tools.js';
export type { SeaChestToolsOptions } from './tools.js';

export { buildSetupManifest } from './setup-machine.js';
export type { SetupFileWrite, SetupManifest, SetupMachineOptions } from './setup-machine.js';

export { handleSeaChestApiRequest } from './api.js';
export type { SeaChestApiOptions, SeaChestApiRequest } from './api.js';

export { createFetchSeaChestClient, SeaChestClientError } from './client.js';
export type { SeaChestClient } from './client.js';

export { diffFileMaps, diffLines, unifiedDiff } from './diff.js';
export type { DiffOp } from './diff.js';

export { buildTar, buildTgz, readTar } from './tar.js';
export type { TarEntry } from './tar.js';
