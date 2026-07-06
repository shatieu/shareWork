/**
 * Jitter-proof usage-window identity.
 *
 * Field-proven necessity (guard.ps1 patch, 2026-07-06): the oauth endpoint
 * jitters resets_at by sub-seconds between polls, which defeated exact-string
 * dedup of "one resurrection per window" markers -- 5 resurrections fired in a
 * single window. Rounding to the nearest minute (add 30 s, truncate) makes
 * jitter across a minute boundary (06:29:59.9 vs 06:30:00.1) still yield one
 * key. Keys are UTC so two machines in different zones agree on the window.
 */
export function windowKeyOf(resetsAt: string): string {
  const parsed = Date.parse(resetsAt);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed + 30_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
      `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`
    );
  }
  // Unparseable input: fall back to a sanitized literal (prototype behavior)
  // rather than throwing -- a weird-but-stable string still dedups correctly
  // as long as the endpoint repeats it verbatim.
  return resetsAt.replace(/[^0-9A-Za-z-]/g, '-');
}

/** True when two resets_at strings identify the same usage window. */
export function sameWindow(a: string, b: string): boolean {
  return windowKeyOf(a) === windowKeyOf(b);
}
