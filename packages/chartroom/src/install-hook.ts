import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Marker comment written into the installed hook file, so a re-run of `chartroom init` can tell
 * "this is our own shim" (safe to refresh) apart from some unrelated pre-existing hook (refuse to
 * clobber -- plan §9.4). */
const HOOK_MARKER = 'chartroom:managed-pre-commit-hook';

export type InstallHookResult =
  | { status: 'installed' }
  | { status: 'already-present' }
  | { status: 'refused'; hookPath: string };

/**
 * Writes `.git/hooks/pre-commit` as a chain-safe shim (plan §9.4) that in-process `import()`s this
 * package's own built `hook.js` and calls `runPreCommitHook()`. If a *different*, non-Chart-Room
 * hook already exists there, refuses to overwrite it (the caller is responsible for printing the
 * manual-chaining instructions -- see `commands/init.ts`).
 */
export function installHook(repoRoot: string): InstallHookResult {
  const hooksDir = join(repoRoot, '.git', 'hooks');
  const hookPath = join(hooksDir, 'pre-commit');

  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, 'utf8');
    if (existing.includes(HOOK_MARKER)) {
      // Idempotent re-install: refresh the shim in case this package's own dist path moved since
      // it was last installed (e.g. a different chartroom install/version).
      writeShim(hookPath);
      return { status: 'already-present' };
    }
    return { status: 'refused', hookPath };
  }

  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }
  writeShim(hookPath);
  return { status: 'installed' };
}

function writeShim(hookPath: string): void {
  // This module is compiled to dist/install-hook.js; hook.js is compiled alongside it in the same
  // dist/ directory, so resolving relative to this file's own URL is robust regardless of where
  // the target repo lives or how chartroom itself was installed (workspace package or npm dep).
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const hookModulePath = join(thisDir, 'hook.js');
  const hookModuleUrl = pathToFileURL(hookModulePath).href;
  const shim =
    `#!/usr/bin/env node\n` +
    `// ${HOOK_MARKER} (do not edit by hand -- managed by \`chartroom init\`; re-run init to refresh)\n` +
    `import('${hookModuleUrl}').then((m) => m.runPreCommitHook());\n`;
  writeFileSync(hookPath, shim, 'utf8');
  try {
    chmodSync(hookPath, 0o755);
  } catch {
    // Best-effort: chmod isn't meaningful on every platform/filesystem. Git for Windows still
    // executes the hook via its shebang-aware shell regardless.
  }
}
