import { z } from 'zod';

/**
 * The Sea Chest's core shapes (Locker_Spec §3). Items are stored plugin-shaped from day one
 * (spec §2.1: "locker items are stored as plugin-shaped bundles so this serving is a
 * projection, not a conversion"): `content.files` is a map of relative POSIX paths → text.
 */

export const LOCKER_KINDS = [
  'skill',
  'agent',
  'hook',
  'settings_template',
  'claude_md',
  'mcp_config',
  'preset',
  'plugin_bundle',
] as const;

export type LockerKind = (typeof LOCKER_KINDS)[number];

/** Kinds that project into a natively installable Claude Code plugin (spec §2.1). The rest
 * travel via `locker_pull` / `locker_setup_machine` file-writes instead. */
export const PLUGINABLE_KINDS: readonly LockerKind[] = [
  'skill',
  'agent',
  'hook',
  'mcp_config',
  'preset',
  'plugin_bundle',
];

const RELATIVE_POSIX_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\0]+$/;

/** Relative POSIX path, no traversal, no backslashes, no NUL, non-empty. */
export const filePathSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(RELATIVE_POSIX_PATH, 'must be a relative POSIX path without ".." segments');

export const lockerFilesSchema = z
  .record(filePathSchema, z.string().max(1_000_000))
  .refine((files) => Object.keys(files).length > 0, 'at least one file is required');

export const lockerContentSchema = z.object({
  files: lockerFilesSchema,
  /** Free-form item metadata (e.g. `targetPath` for settings templates / CLAUDE.md snippets,
   * `services` registrations consumed by locker_setup_machine). */
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type LockerContent = z.infer<typeof lockerContentSchema>;

export const lockerKindSchema = z.enum(LOCKER_KINDS);

export const itemNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i, 'item names are alphanumeric plus . _ - (no spaces)');

export interface LockerItemSummary {
  id: string;
  userId: string;
  teamId: string | null;
  kind: LockerKind;
  name: string;
  description: string;
  version: number;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LockerItem extends LockerItemSummary {
  content: LockerContent;
}

export interface LockerVersionSummary {
  itemId: string;
  version: number;
  createdAt: string;
}

export interface LockerVersion extends LockerVersionSummary {
  content: LockerContent;
}

export interface MachineProfile {
  id: string;
  userId: string;
  name: string;
  /** Item names included in this profile, resolved at setup time (missing ones reported). */
  itemNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceTokenInfo {
  id: string;
  userId: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
}

export const pushInputSchema = z.object({
  name: itemNameSchema,
  kind: lockerKindSchema,
  description: z.string().max(2000).optional(),
  content: lockerContentSchema,
});

export type PushInput = z.infer<typeof pushInputSchema>;

export type PushOutcome = 'created' | 'bumped' | 'unchanged';

export interface PushResult {
  item: LockerItem;
  outcome: PushOutcome;
}

/** Typed Sea Chest error -- store impls throw these so transports map them to status codes. */
export class SeaChestError extends Error {
  constructor(
    public readonly code:
      | 'not_found'
      | 'kind_mismatch'
      | 'invalid_input'
      | 'conflict'
      | 'store_error',
    message: string,
  ) {
    super(message);
    this.name = 'SeaChestError';
  }
}

/** Canonical JSON for content equality: stable key order, so semantically identical pushes
 * compare equal regardless of client key ordering. */
export function canonicalContentJson(content: LockerContent): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((k) => [k, stable((value as Record<string, unknown>)[k])]),
      );
    }
    return value;
  };
  return JSON.stringify(stable(content));
}
