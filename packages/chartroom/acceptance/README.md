# Chart Room acceptance script

`git-mv-resolution.mjs` is a standalone Node script that proves the Chart Room phase-1 spec's
acceptance line end-to-end:

> `git mv` a doc -> an agent resolves it via CLI, and via raw index Read; a staged commit
> normalizes only staged files; no repair ever creates a commit.

It operates entirely inside a disposable `fs.mkdtempSync` scratch directory with its own
throwaway `git init` -- it **never touches** the real repo tree it lives in, so it's always safe
to run.

## What it proves, step by step

1. Scaffolds a scratch repo with four markdown docs (`a`, `b`, `c`, `d`), each already carrying an
   `id:` (simulating post-`chartroom init` state); `b` links to `a` via
   `[text](path "id:target-id")`.
2. Runs `chartroom index` via the **built CLI** and asserts `.docs/index.json` exists and is
   well-formed.
3. Performs a real `git mv docs/a.md docs/sub/a.md` (staged automatically by git).
4. Runs `chartroom resolve doc-a --json` via the **built CLI** and asserts the result reflects the
   post-move path (`matchType: "id"`, `path: "docs/sub/a.md"`).
5. Raw-reads `.docs/index.json` from disk (`fs.readFileSync` + `JSON.parse`, no CLI involved) and
   asserts it also reflects the post-move path -- proving the "always-fresh" rule keeps the
   on-disk index current as a side effect of `resolve`, not just its own stdout.
6. Stages an edit to an unrelated third doc (`c`) and an edit to `b` (whose link to `a` is now
   stale because of the move in step 3), leaving a fourth doc (`d`) completely untouched.
7. Invokes the pre-commit hook logic directly (`executePreCommitHook` from `dist/hook.js` --
   **not** a real `git commit`, so the script can inspect intermediate state) and asserts:
   - doc `b`'s staged blob now has the corrected relative link to doc `a`;
   - doc `d`'s working-tree bytes are byte-identical to before the hook ran, and it was never part
     of the staged-file set the hook processed;
   - no commit was created (`git rev-list --count HEAD` is unchanged).
8. Exits `0` if every assertion passes; exits non-zero with a clear `ASSERTION FAILED: ...` message
   on the first failure.

## Running it

The package must already be built (the script drives `dist/cli.js` and imports `dist/hook.js`
directly):

```sh
npx tsc -p packages/chartroom/tsconfig.json    # or: npm run build (from packages/chartroom/)
node packages/chartroom/acceptance/git-mv-resolution.mjs
```

or, from `packages/chartroom/`:

```sh
npm run build
npm run test:acceptance
```
