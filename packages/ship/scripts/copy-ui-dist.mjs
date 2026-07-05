#!/usr/bin/env node
// Build-step script (plan 03 §4.7): copies chartroom-ui's built `dist/` (the Captain's Deck app)
// into `packages/ship`'s own `dist/public/`, so `ship serve` serves the Deck from its own package
// -- same pattern and rationale as packages/chartroom/scripts/copy-ui-dist.mjs (the ONE UI build
// is copied into BOTH packages; standalone `chartroom serve` and the hull each stay
// self-contained).
//
// If `chartroom-ui/dist` doesn't exist yet, logs a warning and exits 0 rather than failing the
// build -- hull's UI static mount is skipped gracefully at runtime when `dist/public` is absent
// (used deliberately by the test suite).

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, '..', '..', 'chartroom-ui', 'dist');
const DEST_DIR = join(HERE, '..', 'dist', 'public');

function main() {
  if (!existsSync(SRC_DIR)) {
    console.warn(
      `ship: copy-ui-dist -- ${SRC_DIR} not found, skipping Deck bundle copy ` +
        `(build chartroom-ui first with "pnpm --filter chartroom-ui build" if you want the Deck served).`,
    );
    return;
  }

  // Deliberately no `rm` of the destination first (repo convention: never delete -- see
  // suite-design/overnight/REMOVALS.md); `cpSync` force-overwrites same-named files.
  mkdirSync(dirname(DEST_DIR), { recursive: true });
  cpSync(SRC_DIR, DEST_DIR, { recursive: true, force: true });
  console.log(`ship: copied Deck bundle ${SRC_DIR} -> ${DEST_DIR}`);
}

main();
