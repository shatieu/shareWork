#!/usr/bin/env node
// Build-step script (plan §2/§3): copies chartroom-ui's built `dist/` into
// `packages/chartroom`'s own `dist/public/`, so that publishing only `packages/chartroom` to npm
// ships a fully self-contained package -- `npx chartroom serve` must work from a bare
// `npm install chartroom` with no sibling monorepo packages present, which is only true if the
// UI's compiled static assets physically live inside `chartroom`'s own published `dist/`.
//
// Invoked by package.json's `build` script, after `tsc`. If `chartroom-ui/dist` doesn't exist yet
// (e.g. it hasn't been built in this checkout), this script logs a warning and exits 0 rather than
// failing the whole `chartroom` build -- `server.ts`'s UI static mount is skipped gracefully at
// runtime when `dist/public` is absent (used deliberately by the test suite, which never depends
// on a built UI bundle).

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, '..', '..', 'chartroom-ui', 'dist');
const DEST_DIR = join(HERE, '..', 'dist', 'public');

function main() {
  if (!existsSync(SRC_DIR)) {
    console.warn(
      `chartroom: copy-ui-dist -- ${SRC_DIR} not found, skipping UI bundle copy ` +
        `(build chartroom-ui first with "pnpm --filter chartroom-ui build" if you want the UI served).`,
    );
    return;
  }

  // Note: deliberately does not `rm` the destination first (repo convention: never delete/rm --
  // see suite-design/overnight/REMOVALS.md). `cpSync` with `force: true` overwrites same-named
  // files; a file removed from chartroom-ui's dist since the last copy would linger harmlessly in
  // dest/public until the next full clean, which is an acceptable tradeoff for a build artifact.
  mkdirSync(dirname(DEST_DIR), { recursive: true });
  cpSync(SRC_DIR, DEST_DIR, { recursive: true, force: true });
  console.log(`chartroom: copied UI bundle ${SRC_DIR} -> ${DEST_DIR}`);
}

main();
