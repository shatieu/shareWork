/**
 * Dependency-free line diff for `locker_diff` (Locker_Spec §2.2: "local copy vs locker
 * version -- feeds the config-matrix UI later"). Common-affix trim + LCS on the middle;
 * degrades to whole-replace beyond a size cap so pathological inputs stay O(reasonable).
 */

export interface DiffOp {
  type: 'ctx' | 'add' | 'del';
  line: string;
}

const LCS_CAP = 3000;

export function diffLines(aText: string, bText: string): DiffOp[] {
  const a = splitLines(aText);
  const b = splitLines(bText);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const ops: DiffOp[] = a.slice(0, start).map((line) => ({ type: 'ctx' as const, line }));

  if (midA.length > LCS_CAP || midB.length > LCS_CAP) {
    ops.push(...midA.map((line) => ({ type: 'del' as const, line })));
    ops.push(...midB.map((line) => ({ type: 'add' as const, line })));
  } else {
    ops.push(...lcsDiff(midA, midB));
  }

  ops.push(...a.slice(endA).map((line) => ({ type: 'ctx' as const, line })));
  return ops;
}

function lcsDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:], b[j:]
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'ctx', line: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      ops.push({ type: 'del', line: a[i] });
      i++;
    } else {
      ops.push({ type: 'add', line: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'del', line: a[i++] });
  while (j < m) ops.push({ type: 'add', line: b[j++] });
  return ops;
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.split('\n');
}

/** Unified diff text with @@ hunk headers (3 context lines), or '' when identical. */
export function unifiedDiff(
  aText: string,
  bText: string,
  aLabel: string,
  bLabel: string,
  context = 3,
): string {
  const ops = diffLines(aText, bText);
  if (!ops.some((op) => op.type !== 'ctx')) return '';

  interface Hunk {
    aStart: number;
    bStart: number;
    aLen: number;
    bLen: number;
    lines: string[];
  }
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  let aLine = 1;
  let bLine = 1;
  let trailingCtx = 0;

  const flush = () => {
    if (!current) return;
    if (trailingCtx > context) {
      const drop = trailingCtx - context;
      current.lines.splice(current.lines.length - drop, drop);
      current.aLen -= drop;
      current.bLen -= drop;
    }
    hunks.push(current);
    current = null;
    trailingCtx = 0;
  };

  const pending: string[] = [];
  for (const op of ops) {
    if (op.type === 'ctx') {
      if (current) {
        current.lines.push(` ${op.line}`);
        current.aLen++;
        current.bLen++;
        trailingCtx++;
        if (trailingCtx > context * 2) flush();
      } else {
        pending.push(op.line);
        if (pending.length > context) pending.shift();
      }
      aLine++;
      bLine++;
    } else {
      if (!current) {
        current = {
          aStart: aLine - pending.length,
          bStart: bLine - pending.length,
          aLen: pending.length,
          bLen: pending.length,
          lines: pending.map((l) => ` ${l}`),
        };
        pending.length = 0;
      }
      trailingCtx = 0;
      if (op.type === 'del') {
        current.lines.push(`-${op.line}`);
        current.aLen++;
        aLine++;
      } else {
        current.lines.push(`+${op.line}`);
        current.bLen++;
        bLine++;
      }
    }
  }
  flush();

  const out: string[] = [`--- ${aLabel}`, `+++ ${bLabel}`];
  for (const h of hunks) {
    out.push(`@@ -${h.aStart},${h.aLen} +${h.bStart},${h.bLen} @@`);
    out.push(...h.lines);
  }
  return out.join('\n');
}

/** Multi-file diff between two `files` maps; returns per-file unified diffs + status. */
export function diffFileMaps(
  local: Record<string, string>,
  stored: Record<string, string>,
): { path: string; status: 'added' | 'removed' | 'modified' | 'same'; diff: string }[] {
  const paths = [...new Set([...Object.keys(local), ...Object.keys(stored)])].sort();
  return paths.map((path) => {
    const inLocal = path in local;
    const inStored = path in stored;
    if (!inStored) return { path, status: 'added' as const, diff: '' };
    if (!inLocal) return { path, status: 'removed' as const, diff: '' };
    const diff = unifiedDiff(stored[path], local[path], `locker/${path}`, `local/${path}`);
    return { path, status: diff === '' ? ('same' as const) : ('modified' as const), diff };
  });
}
