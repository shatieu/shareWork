/**
 * Dependency-free line diff (plan 07 §3) -- powers the mandatory diff preview rail. Classic LCS
 * over lines; output is both a structured op list (the UI renders it directly) and a
 * unified-diff-style text (logs, CLI, evidence reports).
 */

export interface DiffOp {
  kind: 'same' | 'add' | 'del';
  line: string;
}

export function diffLines(before: string, after: string): DiffOp[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;
  // LCS table (settings files are small -- worst case a few thousand lines; O(n*m) is fine).
  const table: Uint32Array[] = [];
  for (let i = 0; i <= n; i += 1) table.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'same', line: a[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ kind: 'del', line: a[i] });
      i += 1;
    } else {
      ops.push({ kind: 'add', line: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ kind: 'del', line: a[i] });
    i += 1;
  }
  while (j < m) {
    ops.push({ kind: 'add', line: b[j] });
    j += 1;
  }
  return ops;
}

/** Unified-style text with `context` lines of surrounding sameness (default 3). */
export function formatUnifiedDiff(ops: DiffOp[], context = 3): string {
  const changed = ops.some((op) => op.kind !== 'same');
  if (!changed) return '';
  const keep = new Array<boolean>(ops.length).fill(false);
  for (let i = 0; i < ops.length; i += 1) {
    if (ops[i].kind === 'same') continue;
    for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k += 1) {
      keep[k] = true;
    }
  }
  const lines: string[] = [];
  let skipping = false;
  for (let i = 0; i < ops.length; i += 1) {
    if (!keep[i]) {
      if (!skipping) {
        lines.push('@@');
        skipping = true;
      }
      continue;
    }
    skipping = false;
    const op = ops[i];
    lines.push(`${op.kind === 'add' ? '+' : op.kind === 'del' ? '-' : ' '}${op.line}`);
  }
  return lines.join('\n');
}

export function countChanges(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.kind === 'add') added += 1;
    else if (op.kind === 'del') removed += 1;
  }
  return { added, removed };
}
