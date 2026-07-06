import type { UsageSnapshot } from './types.js';

/**
 * Best-effort parsers for the two secondary signals Trio_Specs §C names:
 * transcript/CLI limit messages ("resets at ...") and statusline JSON quota
 * fields. Both are seams -- tolerant extractors that upgrade the fused
 * picture when present and simply return null when the shape is foreign.
 * The oauth endpoint remains the authoritative, field-proven source.
 */

const ISO_RE = /(\d{4}-\d{2}-\d{2}[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)/;
const CLOCK_RE = /resets?\s*(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

/**
 * Extract a resets_at ISO timestamp from a limit message, e.g.
 *   "5-hour limit reached - resets at 3:30 PM"
 *   "Your limit will reset at 2026-07-06T11:30:00Z"
 *
 * Clock-only times carry no date or zone; they are resolved to the NEXT
 * occurrence after `now`, interpreted in UTC+tzOffsetMinutes (pass the
 * machine's offset for local-time messages; defaults to UTC so results are
 * deterministic).
 */
export function parseLimitMessage(
  text: string,
  now: Date = new Date(),
  tzOffsetMinutes = 0,
): string | null {
  if (!/reset/i.test(text)) return null;

  const iso = text.match(ISO_RE);
  if (iso) {
    const t = Date.parse(iso[1]);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }

  const clock = text.match(CLOCK_RE);
  if (!clock) return null;
  let hour = Number(clock[1]);
  const minute = clock[2] ? Number(clock[2]) : 0;
  const meridiem = clock[3]?.toLowerCase();
  if (hour > 23 || minute > 59) return null;
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  const offsetMs = tzOffsetMinutes * 60_000;
  const zoned = new Date(now.getTime() + offsetMs);
  const candidate = new Date(
    Date.UTC(zoned.getUTCFullYear(), zoned.getUTCMonth(), zoned.getUTCDate(), hour, minute),
  );
  let resolved = candidate.getTime() - offsetMs;
  if (resolved <= now.getTime()) resolved += 24 * 60 * 60_000; // next occurrence
  return new Date(resolved).toISOString();
}

/** A limit message parsed into a full snapshot: the cap is by definition hit. */
export function snapshotFromLimitMessage(
  text: string,
  now: Date = new Date(),
  tzOffsetMinutes = 0,
): UsageSnapshot | null {
  const resetsAt = parseLimitMessage(text, now, tzOffsetMinutes);
  if (!resetsAt) return null;
  return {
    five_hour_pct: 100,
    seven_day_pct: 0,
    resets_at: resetsAt,
    checked_at: now.toISOString(),
    source: 'limit-message',
  };
}

/**
 * Extract quota fields from a statusline stdin JSON payload. Tolerant of the
 * shapes seen in the wild: the oauth payload embedded whole, our own
 * usage.json shape, or a nested `usage` object. Returns null on anything
 * else -- never throws.
 */
export function parseStatuslineJson(input: unknown, now: Date = new Date()): UsageSnapshot | null {
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (input === null || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;

  // Our own signal-file shape.
  if (typeof o.five_hour_pct === 'number' && typeof o.resets_at === 'string') {
    return {
      five_hour_pct: o.five_hour_pct,
      seven_day_pct: typeof o.seven_day_pct === 'number' ? o.seven_day_pct : 0,
      resets_at: o.resets_at,
      checked_at: typeof o.checked_at === 'string' ? o.checked_at : now.toISOString(),
      source: 'statusline',
    };
  }

  // The oauth payload shape ({ five_hour: { utilization, resets_at }, ... }).
  const fiveHour = o.five_hour as Record<string, unknown> | undefined;
  if (
    fiveHour &&
    typeof fiveHour.utilization === 'number' &&
    typeof fiveHour.resets_at === 'string'
  ) {
    const sevenDay = o.seven_day as Record<string, unknown> | undefined;
    return {
      five_hour_pct: fiveHour.utilization,
      seven_day_pct: typeof sevenDay?.utilization === 'number' ? sevenDay.utilization : 0,
      resets_at: fiveHour.resets_at,
      checked_at: now.toISOString(),
      source: 'statusline',
    };
  }

  // One level of nesting (e.g. { usage: {...} }).
  if (o.usage && typeof o.usage === 'object') return parseStatuslineJson(o.usage, now);

  return null;
}
