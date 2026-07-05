# Chart Room (phase 1)

Local-first markdown doc indexer, id-based link resolver, stale-link repair, and a pre-commit
hook that normalizes staged docs -- with zero automatic commits and zero diff noise in files not
already staged.

Phase 1 is single-repo, cwd-scoped: every command discovers the repo root by walking up from
`process.cwd()` until it finds a `.git` directory.

## Install

Inside this monorepo, `chartroom` is a workspace package (`packages/chartroom`). Build it before
first use:

```sh
npm run build       # or: npx tsc -p packages/chartroom/tsconfig.json
```

The CLI entrypoint is `dist/cli.js` (`bin: { "chartroom": "./dist/cli.js" }`); once built, invoke
it via `node packages/chartroom/dist/cli.js <command>` or, from within `packages/chartroom/`,
`npx chartroom <command>` / `npm run <script>`.

## Commands

### `chartroom init`
One-time (but safely re-runnable) bootstrap: assigns an `id:` to every doc missing one
(surgically injected into frontmatter -- an existing `id:` is left byte-for-byte alone), builds
the first `.docs/index.json`, and installs the pre-commit hook. Idempotent: re-running only
touches docs still missing an id.

- `--no-hook` -- skip installing the pre-commit hook.
- Exit codes: `0` success (including "nothing to do"), `1` fatal (not a git repo, fs error).

### `chartroom index`
Rebuilds `.docs/index.json` from scratch. **Never mutates doc files** -- read-only with respect
to markdown content, it only reads and writes `.docs/index.json`.

- `--json` -- also print the full index JSON to stdout.
- Exit codes: `0` success, `1` fatal.

### `chartroom resolve <id-or-path>`
Resolves an id or path against a freshly rebuilt in-memory index (never trusts a possibly-stale
`.docs/index.json` on disk for correctness -- but still writes the refreshed copy back as a side
effect). Resolution order: exact id -> exact path -> unique filename -> fuzzy title match
(flagged `guess: true`) -> tombstone -> not-found.

- `--json` -- emit the full structured result instead of a one-line summary.
- Exit codes: `0` resolved (id/path/filename/fuzzy), `3` tombstone (a "gone" result -- never a
  silent 404), `4` not-found, `1` fatal error.

### `chartroom fix-links [files...]`
Repo-wide (or scoped to given files) stale outbound link cleanup. **Defaults to report-only**
(matches the `eslint --fix` / `prettier --write` convention): bare `chartroom fix-links` computes
and prints what it would change but writes nothing. Pass `--write` to actually apply the changes.
`--dry-run` is accepted as an explicit no-op synonym for the default, kept for discoverability.

- `--write` -- apply the fixes to files on disk.
- `--dry-run` -- explicit synonym for the default report-only behavior.
- Exit codes: `0` ran successfully (whether or not anything needed fixing), `1` fatal error.
  (Deliberately not "non-zero if changes were needed" -- that's `check`'s job.)

### `chartroom check`
Read-only integrity gate for hooks/CI. Reports: outbound links whose target id resolves to a
tombstone or not-found; docs missing an `id:`; duplicate ids (two files claiming the same id --
flagged loudly, never silently resolved first-seen-wins). Phase 1 scope is link integrity +
missing ids only (staleness rules like `ttl_days`/orphans are phase 2).

- `--json` -- emit the full structured result instead of a human-readable list.
- Exit codes: `0` clean, `1` one or more issues found, `2` fatal (not a repo, fs error).

## Pre-commit hook behavior

`chartroom init` installs `.git/hooks/pre-commit` as a small Node-shebang shim (marked with a
`chartroom:managed-pre-commit-hook` comment so re-running `init` can safely refresh it) that
`import()`s this package's own built `dist/hook.js` in-process and calls `runPreCommitHook()`.
If a *different*, non-Chart-Room hook already exists at that path, `init` refuses to overwrite it
and prints instructions to chain the two manually.

On every commit, the hook:

1. Lists staged markdown files (`git diff --cached --name-only --diff-filter=ACMR -M`, so a
   `git mv` shows the new path directly).
2. For each one, reads the **staged blob** (`git show :path`) -- not the working-tree file --
   assigns a missing `id:` if needed, and repairs stale outbound links against a freshly rebuilt
   index (built from the working tree for every *other* file).
3. If the content changed, writes the new blob straight into the git object store
   (`git hash-object -w`) and repoints the index entry at it (`git update-index --cacheinfo`) --
   this all happens without ever touching the working tree.
4. If the file has **no** unstaged edits on top of what's staged, the working-tree file is also
   synced to match, so `git status` shows a clean tree post-commit. If the file **is** partially
   staged (unstaged hunks exist on top), the working-tree file is deliberately left untouched, and
   the hook prints a one-line note asking you to run `chartroom fix-links` after your next commit
   to sync the rest.
5. Refreshes `.docs/index.json` on disk (cache refresh only, not part of the commit).
6. Always exits `0` -- this hook only repairs, it never blocks a commit in phase 1.

Files that are **not** staged in a given commit are never touched, staged or unstaged, in any way.

## `.docs/index.json` shape (summary)

Gitignored, rebuilt from doc content (never authoritative on its own -- `resolve`/`check`/
`fix-links`/the hook all rebuild it fresh in memory first):

```ts
interface ChartRoomIndex {
  version: 1;
  generatedAt: string; // ISO 8601
  docs: {
    [id: string]: {
      path: string;       // repo-root-relative, forward-slash-normalized
      title: string;       // frontmatter title -> first H1 -> filename stem
      headings: string[];  // document order
      outbound: Array<{ targetId?: string; hrefAsWritten: string; stale: boolean }>;
    };
  };
  /** docs discovered on disk with no `id:` frontmatter at all -- not keyed by id, but still
   * resolvable by path/filename and still scanned for broken links by `check`. */
  unidentified: Array<{ path: string; title: string; headings: string[]; outbound: unknown[] }>;
  assets: { [sha256Hash: string]: { path: string } };
  /** tombstones: an id that no longer resolves to any doc on disk. */
  deleted: { [id: string]: { lastPath: string; deletedAt: string } };
}
```

A doc keeps its identity across `git mv`/renames because ids, not paths, are the source of truth:
moving a file (same id, new path) updates `docs[id].path` in place with **no** tombstone. A true
deletion (or the `id:` frontmatter line being removed) moves the id into `deleted[id]`. If the id
ever reappears, the tombstone is dropped and it's back in `docs` -- this all falls out naturally
from diffing the previous on-disk index against a fresh scan, with no special-casing needed.

See `acceptance/README.md` for a runnable, end-to-end proof of the `git mv` + resolve + hook
behavior described above.
