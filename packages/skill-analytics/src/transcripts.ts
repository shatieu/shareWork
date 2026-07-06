import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Default transcript root. Layout verified on this machine: one directory per encoded
 * project cwd, `<sessionId>.jsonl` files inside (subagent scratch dirs sit alongside as
 * plain directories and are skipped). READ-ONLY: the collector never writes here. */
export function defaultClaudeProjectsDir(homeDir: string = homedir()): string {
  return join(homeDir, '.claude', 'projects');
}

export interface TranscriptFile {
  path: string;
  size: number;
  mtimeMs: number;
}

/**
 * Enumerate every `*.jsonl` transcript under the projects root. Tolerant of the root not
 * existing (fresh machine → empty list, zero config). Non-recursive by design: the verified
 * layout is exactly `<root>/<project-dir>/<session>.jsonl`.
 */
export function listTranscriptFiles(claudeProjectsDir: string): TranscriptFile[] {
  if (!existsSync(claudeProjectsDir)) return [];
  const out: TranscriptFile[] = [];
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(claudeProjectsDir);
  } catch {
    return [];
  }
  for (const dirName of projectDirs) {
    const dirPath = join(claudeProjectsDir, dirName);
    let entries: string[];
    try {
      const dirStat = statSync(dirPath);
      if (!dirStat.isDirectory()) continue;
      entries = readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const filePath = join(dirPath, entry);
      try {
        const st = statSync(filePath);
        if (st.isFile()) out.push({ path: filePath, size: st.size, mtimeMs: st.mtimeMs });
      } catch {
        // File vanished between readdir and stat -- skip.
      }
    }
  }
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}
