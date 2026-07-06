import { closeSync, openSync, readSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { parseLine } from './parse.js';
import { projectFromCwd, type FileCursorRow } from './db.js';
import { listTranscriptFiles, type TranscriptFile } from './transcripts.js';

export interface CollectResult {
  filesSeen: number;
  filesParsed: number;
  linesParsed: number;
  newInvocations: number;
}

/**
 * Incremental transcript collector (plan 11 §1, spec §A "incremental parsing with a cursor per
 * file; zero config"). Each file keeps a byte cursor in `file_cursors`; only appended bytes are
 * parsed on subsequent runs. A file that SHRANK was replaced/truncated → its rows are dropped
 * and it reparses from zero (the UNIQUE(file,line_no,kind,name) key makes accidental reparse
 * idempotent anyway).
 *
 * Token attribution heuristic (documented, plan 11 §out-of-scope for exactness): an invocation
 * opens a window; every later assistant message's usage in the same file accrues to the most
 * recently opened invocation; a real (non-sidechain) user prompt closes the window. Windows
 * survive collector runs via `file_cursors.open_invocation_id`. Usage outside any window is
 * deliberately dropped — generic cost dashboards are out of scope (ccusage owns them).
 */
export function collectTranscripts(db: Database.Database, claudeProjectsDir: string): CollectResult {
  const files = listTranscriptFiles(claudeProjectsDir);
  const result: CollectResult = { filesSeen: files.length, filesParsed: 0, linesParsed: 0, newInvocations: 0 };

  const getCursor = db.prepare('SELECT * FROM file_cursors WHERE path = ?');
  const putCursor = db.prepare(`
    INSERT INTO file_cursors (path, offset, line_no, size, mtime_ms, open_invocation_id, updated_at)
    VALUES (@path, @offset, @line_no, @size, @mtime_ms, @open_invocation_id, @updated_at)
    ON CONFLICT (path) DO UPDATE SET
      offset = excluded.offset, line_no = excluded.line_no, size = excluded.size,
      mtime_ms = excluded.mtime_ms, open_invocation_id = excluded.open_invocation_id,
      updated_at = excluded.updated_at
  `);
  const dropFileRows = db.prepare('DELETE FROM invocations WHERE file = ?');
  const insertInvocation = db.prepare(`
    INSERT OR IGNORE INTO invocations
      (file, line_no, kind, name, trigger_mode, project, cwd, session_id, ts, date, model)
    VALUES (@file, @line_no, @kind, @name, @trigger_mode, @project, @cwd, @session_id, @ts, @date, @model)
  `);
  const findInvocationId = db.prepare(
    'SELECT id FROM invocations WHERE file = ? AND line_no = ? AND kind = ? AND name = ?',
  );
  const accrueUsage = db.prepare(`
    UPDATE invocations SET
      input_tokens = input_tokens + @input,
      output_tokens = output_tokens + @output,
      cache_create_tokens = cache_create_tokens + @cacheCreate,
      cache_read_tokens = cache_read_tokens + @cacheRead,
      model = COALESCE(model, @model)
    WHERE id = @id
  `);

  const collectFile = db.transaction((file: TranscriptFile) => {
    const cursor = getCursor.get(file.path) as FileCursorRow | undefined;
    let offset = cursor?.offset ?? 0;
    let lineNo = cursor?.line_no ?? 0;
    let openInvocationId: number | null = cursor?.open_invocation_id ?? null;

    if (cursor && file.size < cursor.offset) {
      // Truncated/replaced file: reparse from scratch, dropping the stale rows.
      dropFileRows.run(file.path);
      offset = 0;
      lineNo = 0;
      openInvocationId = null;
    } else if (cursor && file.size === cursor.size && file.mtimeMs === cursor.mtime_ms) {
      return; // Unchanged since last run.
    }

    // Read appended bytes only. One buffer per file keeps this simple; incremental cursors
    // mean only the FIRST run over a machine's history pays a whole-file read.
    const toRead = file.size - offset;
    let chunk: Buffer;
    if (toRead > 0) {
      const fd = openSync(file.path, 'r');
      try {
        chunk = Buffer.alloc(toRead);
        const bytesRead = readSync(fd, chunk, 0, toRead, offset);
        chunk = chunk.subarray(0, bytesRead);
      } finally {
        closeSync(fd);
      }
    } else {
      chunk = Buffer.alloc(0);
    }

    result.filesParsed += 1;
    let currentCwd: string | undefined;
    let currentSession: string | undefined;

    let start = 0;
    while (start < chunk.length) {
      const nl = chunk.indexOf(0x0a, start);
      if (nl === -1) break; // Trailing partial line: leave for the next run, don't advance.
      const raw = chunk.subarray(start, nl).toString('utf-8');
      start = nl + 1;
      lineNo += 1;
      result.linesParsed += 1;

      const parsed = parseLine(raw);
      if (!parsed) continue;
      currentCwd = parsed.cwd ?? currentCwd;
      currentSession = parsed.sessionId ?? currentSession;

      // Order matters: a user prompt line both closes the previous window and (when it carries
      // a slash command) opens a new one.
      if (parsed.closesWindow) openInvocationId = null;

      for (const inv of parsed.invocations) {
        const ts = parsed.timestamp ?? null;
        const info = insertInvocation.run({
          file: file.path,
          line_no: lineNo,
          kind: inv.kind,
          name: inv.name,
          trigger_mode: inv.trigger,
          project: projectFromCwd(currentCwd),
          cwd: currentCwd ?? null,
          session_id: currentSession ?? null,
          ts,
          date: ts ? ts.slice(0, 10) : null,
          model: null,
        });
        if (info.changes > 0) result.newInvocations += 1;
        const row = findInvocationId.get(file.path, lineNo, inv.kind, inv.name) as
          | { id: number }
          | undefined;
        if (row) openInvocationId = row.id;
      }

      if (parsed.usage && openInvocationId !== null) {
        accrueUsage.run({
          id: openInvocationId,
          input: parsed.usage.inputTokens,
          output: parsed.usage.outputTokens,
          cacheCreate: parsed.usage.cacheCreateTokens,
          cacheRead: parsed.usage.cacheReadTokens,
          model: parsed.usage.model ?? null,
        });
      }
    }

    putCursor.run({
      path: file.path,
      offset: offset + start,
      line_no: lineNo,
      size: file.size,
      mtime_ms: file.mtimeMs,
      open_invocation_id: openInvocationId,
      updated_at: new Date().toISOString(),
    });
  });

  for (const file of files) {
    collectFile(file);
  }
  return result;
}
