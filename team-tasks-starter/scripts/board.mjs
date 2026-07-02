#!/usr/bin/env node
// Prints the task board grouped by status. Zero dependencies.
// Usage: node scripts/board.mjs   (run from the hub repo root)

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const tasksDir = join(dirname(fileURLToPath(import.meta.url)), "..", "tasks");

// Minimal front-matter reader: pulls top-level "key: value" pairs from the --- block.
function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const fm = {};
  if (!m) return fm;
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
}

const ORDER = ["open", "claimed", "in-progress", "in-review", "blocked", "done"];
const tasks = readdirSync(tasksDir)
  .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "template.md")
  .map((f) => frontmatter(readFileSync(join(tasksDir, f), "utf8")))
  .filter((t) => t.id);

const byStatus = Object.fromEntries(ORDER.map((s) => [s, []]));
for (const t of tasks) (byStatus[t.status] ??= []).push(t);

console.log(`\n  TEAM TASKS BOARD  (${tasks.length} tasks)\n`);
for (const status of ORDER) {
  const items = byStatus[status] ?? [];
  if (!items.length) continue;
  console.log(`  ${status.toUpperCase()}`);
  for (const t of items.sort((a, b) => (a.id > b.id ? 1 : -1))) {
    const who = t.assignee ? `  →  ${t.assignee}` : "";
    const proj = t.project ? `[${t.project}] ` : "";
    console.log(`    #${t.id}  ${proj}${t.title || ""}${who}`);
  }
  console.log("");
}
