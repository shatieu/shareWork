// Compatibility shim for Milkdown preset-commonmark / preset-gfm 7.21.2's list `spread` attr
// (upstream inconsistency, worth filing): the node schemas declare `spread` with
// `validate: "boolean"`, but their own `parseMarkdown` runners always write it as the STRING
// `"true"`/`"false"` (preset-commonmark's bullet_list / ordered_list / list_item runners all do
// `` const spread = node.spread != null ? `${node.spread}` : ... ``), and their `toMarkdown`
// runners read it back with string semantics (`node.attrs.spread === "true"` on ordered_list and
// the gfm task-list branch; pass-through elsewhere). Ordinary node construction
// (`NodeType.create`, used by the live editor and `roundTrip.ts`) never runs attr validation, so
// the mismatch is invisible in normal editing — but any strict `Node.fromJSON` pass over a doc
// built by Milkdown's own parser throws
// `RangeError: Expected value of type boolean for attribute spread on type list_item, got string`
// (root cause of the phase-3 "edit makes all text disappear" bug — see
// `.ship-crew/exchange/wave2-a/findings.md`).
//
// This module relaxes ONLY the `validate` function of the `spread` attr on the three list node
// schemas, to accept exactly what Milkdown itself actually produces: a boolean (parseDOM path) OR
// the strings "true"/"false" (parseMarkdown path). Attr VALUES are deliberately left exactly as
// Milkdown writes them — coercing them to booleans would flip `toMarkdown`'s string-compare
// semantics (e.g. ordered_list's `node.attrs.spread === "true"`) and break the byte-identical
// round-trip guarantee this package's whole save pipeline is built on.
//
// Each extension chains the PREVIOUS schema factory via `extendSchema(prev => ...)`; for
// `list_item` it chains gfm's own task-list extension (`extendListItemSchemaForTask`), NOT
// commonmark's base schema, so the `checked` attr and task-list parse/serialize behavior are
// preserved verbatim. Must be `.use()`d AFTER `.use(commonmark).use(gfm)`: Milkdown assembles its
// Schema via `Object.fromEntries` over the registered node list, so the LAST registration for a
// given node id wins (the same mechanism gfm's own list_item extension already relies on).

import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx';
import type { NodeSchema } from '@milkdown/kit/transformer';
import { bulletListSchema, orderedListSchema } from '@milkdown/kit/preset/commonmark';
import { extendListItemSchemaForTask } from '@milkdown/kit/preset/gfm';

type GetNodeSchema = (ctx: Ctx) => NodeSchema;

/** Accepts the two shapes Milkdown's own presets genuinely produce for `spread` — nothing more. */
function validateSpread(value: unknown): void {
  if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
    throw new RangeError(
      `chartroom-ui: expected boolean or "true"/"false" for list attribute spread, got ${JSON.stringify(value)}`,
    );
  }
}

function relaxSpreadValidation(prev: GetNodeSchema): GetNodeSchema {
  return (ctx) => {
    const base = prev(ctx);
    const spread = base.attrs?.spread;
    if (!spread) return base;
    return {
      ...base,
      attrs: { ...base.attrs, spread: { ...spread, validate: validateSpread } },
    };
  };
}

/** The three relaxed list-node schema registrations, flattened for a single `.use()`. */
export const listAttrJsonCompat: MilkdownPlugin[] = [
  bulletListSchema.extendSchema(relaxSpreadValidation),
  orderedListSchema.extendSchema(relaxSpreadValidation),
  extendListItemSchemaForTask.extendSchema(relaxSpreadValidation),
].flat();
