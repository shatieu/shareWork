import { z } from 'zod';

/**
 * One Voyage progress item (plan 03 §4.2): the shape of `progress.json` entries (mission
 * tracking) AND -- deliberately -- of Ship_Spec §3's future ledger progress fields, so the Deck's
 * Voyage tab renders both sources with one visual grammar. `source` is stamped by whichever
 * backend produced the item ('mission' = a progress.json file; 'ledger' = future ship-ledger
 * items -- designed for, not built, per plan §2).
 */

export const DIFFICULTIES = ['S', 'M', 'L', 'XL'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Difficulty weights, mirroring `render-progress.mjs` (S=1, M=2, L=3, XL=5; an unplanned/null
 * difficulty counts as M) -- the overall mission bar is the weighted mean of stage_progress. */
export const DIFFICULTY_WEIGHTS: Record<Difficulty, number> = { S: 1, M: 2, L: 3, XL: 5 };
export const UNPLANNED_WEIGHT = DIFFICULTY_WEIGHTS.M;

export const voyageItemSchema = z
  .looseObject({
    /** progress.json uses small integers; ledger items will use string ids. */
    id: z.union([z.number(), z.string()]),
    title: z.string(),
    /** Free-form status label ('pending', 'implementing', 'PASS+merged', 'parked', ...). */
    status: z.string(),
    /** 0-100. */
    stage_progress: z.number(),
    difficulty: z.enum(DIFFICULTIES).nullable().optional(),
    remaining_guess_h: z.number().nullable().optional(),
    /** ISO-8601. */
    updated_at: z.string().optional(),
    note: z.string().optional(),
    source: z.enum(['mission', 'ledger']).optional(),
  });

export type VoyageItem = z.infer<typeof voyageItemSchema>;

/** The whole `progress.json` file: `{ "packages": [...] }`, extra fields tolerated. */
export const voyageFileSchema = z.looseObject({
  packages: z.array(voyageItemSchema),
});

export type VoyageFile = z.infer<typeof voyageFileSchema>;

/** `POST /api/voyage/:project/items` request body (wave2-D): the caller supplies only the human
 * fields; the server assigns `id` (max numeric id + 1), `status` ('pending'), `stage_progress`
 * (0), and `updated_at` (its clock). Unknown body fields are stripped, not persisted. */
export const voyageAddItemInputSchema = z.object({
  title: z.string().trim().min(1, 'title is required'),
  difficulty: z.enum(DIFFICULTIES).nullable().optional(),
  note: z.string().optional(),
});

export type VoyageAddItemInput = z.infer<typeof voyageAddItemInputSchema>;

export function difficultyWeightOf(difficulty: Difficulty | null | undefined): number {
  return difficulty ? DIFFICULTY_WEIGHTS[difficulty] : UNPLANNED_WEIGHT;
}

/** Difficulty-weighted overall progress (0-100) across items -- the Voyage tab's mission bar and
 * `render-progress.mjs` must always agree, so the formula lives here once. */
export function weightedOverallProgress(items: ReadonlyArray<Pick<VoyageItem, 'stage_progress' | 'difficulty'>>): number {
  let weightedDone = 0;
  let weightTotal = 0;
  for (const item of items) {
    const weight = difficultyWeightOf(item.difficulty);
    weightTotal += weight;
    weightedDone += weight * (Math.min(Math.max(item.stage_progress, 0), 100) / 100);
  }
  if (weightTotal === 0) return 0;
  return Math.round((weightedDone / weightTotal) * 100);
}
