---
id: 03-captains-deck-researcher-report-r1-r6
---

# 03-captains-deck — Researcher report (R1–R6)

Date: 2026-07-05. Machine: Windows 11 Pro 10.0.26200, Windows Terminal 1.24.11321.0 (Store app),
Node v24.14.0, claude CLI 2.1.201, workspace fastify 5.9.0, chokidar 4.0.3, light-my-request 6.6.0.
All spawn/watch/SSE experiments ran in the session scratchpad
(`...\Temp\claude\C--thisismydesign-shareWork\4226671f-...\scratchpad`): `spawntest.mjs`,
`choktest.mjs`, `ssetest.mjs`, with raw output in `results.txt` / `harness.log` there.
Builds on report 02 (claude -p contract, nested `-p` spawn worked in 2.1.201) — not re-verified.

---

## R1 — win32 spawn of a visible terminal running a command in dir X (BLOCKING): **verified empirically; both branches work; spawn `cwd:`/`-d` makes `cd /d` unnecessary**

Test rig: probe `.cmd` scripts under paths **with spaces** (`...\space dir\probe one.cmd`,
target dir `...\space dir\repo dir`), spawned from Node with
`{ detached: true, stdio: 'ignore' }` + `.unref()`, plain args arrays (no `shell: true`).
Six cases; full argv per case in `harness.log`, results in `results.txt`.

| Case | Argv (shape) | Result |
|---|---|---|
| wt_direct | `spawn('wt.exe', ['-d', repoDir, 'cmd', '/c', probePath, out, tag])` | **WORKS.** Probe ran with `CD=<repo dir with spaces>`. Node's win32 quoting of `-d` value and probe path with spaces was correct as plain array elements. |
| start_wt | `spawn('cmd', ['/c','start','','wt','-d',repoDir,'cmd','/c',probePath,out,tag], {cwd: repoDir})` | **WORKS.** `''` element → `""` on the command line → consumed as `start`'s title, so the quoted path is never mistaken for a title. |
| start_cmd (fallback) | `spawn('cmd', ['/c','start','Claude test','cmd','/c',probePath,out,tag], {cwd: repoDir})` | **WORKS.** `CD=<repo dir>` proves **spawn `cwd:` propagates through `cmd /c start` to the new console** — no `cd /d` needed. Title-with-space quoted by Node worked as the window title. |
| start_shim | `start '' probeshim` with shim dir prepended to child PATH | **WORKS** — `start` (cmd) resolves bare `.cmd` shims via PATHEXT. |
| wt_shim | `wt -d X probeshim` (shim on PATH, no cmd wrapper) | **FAILS** — probe never ran. wt's CreateProcess does **not** apply PATHEXT; bare `.cmd` names don't resolve. Wrap the command: `wt -d X cmd /k <name>`. |
| hidden_parent | intermediate node child spawned `{detached, windowsHide:true}` then doing start_wt | **WORKS** — window still created from a hidden/detached service-like parent (user session). |

Visibility evidence: during a longer-lived case, `Get-Process WindowsTerminal` showed
`MainWindowHandle 11929496`, `MainWindowTitle C:\WINDOWS\system32\cmd.exe` — a real top-level window.

**Recommended argv (chip):**
- wt branch: `spawn('wt.exe', ['-w','new','-d', repoAbsPath, 'cmd','/k','claude'], {detached:true, stdio:'ignore', env: cleanedEnv})` — direct spawn, no `cmd /c start` wrapper needed; `-w new` forces a fresh window (deterministic even if the user's `windowingBehavior` is set to attach to an existing window; MS docs: `-w -1`/`new` "Always run this command in a new window"). `-d` handles spaces; `cmd /k` keeps the tab open after claude exits and resolves the `.cmd` shim.
- fallback branch: `spawn('cmd', ['/c','start','Claude — '+name,'cmd','/k','claude'], {cwd: repoAbsPath, detached:true, stdio:'ignore', env: cleanedEnv})` — title arg mandatory (or `''`) so nothing quoted is eaten as a title; `cwd:` alone sets the working dir (proven).
- Plan §4.5's candidate argv are both confirmed workable; the `-w new` addition is the one improvement.

**Caveats:** (1) wt treats `;` as a command delimiter — a repo path containing `;` would split the
command (escape as `\;` or route such paths to the cmd fallback; vanishingly rare). (2) With a
commandline passed, wt inherits the caller's environment by default (docs: `--inheritEnvironment`
"defaults to set when a commandline is passed"); empirically our env reached the child
(`CLAUDECODE=[1]` in probe output). With `-w new` the fresh window is created from the wt.exe
invocation, so the daemon's (cleaned) env is what claude sees. (3) Windows *services* in session 0
can't show windows — not our case; the daemon is a plain user process (hidden_parent proves the
wscript-launched-daemon scenario shows windows fine).

Sources: local experiments 2026-07-05 (scratchpad files above);
https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments (ms.date 2025-11-10).

---

## R2 — env hygiene + `claude` resolution (BLOCKING): **strip `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_BRIDGE_SESSION_ID`; set `INVOCATION_ID:''` — this is exactly what the claude CLI itself does; invoke via `cmd /k claude`**

- **No hard nesting guard found in 2.1.201.** String-searched the installed binary
  (`...\@anthropic-ai\claude-code\bin\claude.exe`, 241 MB native exe): no "cannot run inside a
  Claude session"-style guard message exists (the only nesting-refusal string is for
  `isolation:'remote'` inside a CCR session). Report 02 already proved nested `-p` runs work.
  Interactive nested launch not empirically run (would leave a live session window open overnight)
  — behavior-if-unstripped is **unverified**, but moot given the next point.
- **Vendor's own env-hygiene function (extracted verbatim from the 2.1.201 binary):**
  `function Eym(){let e={...process.env,INVOCATION_ID:""};delete e.CLAUDECODE,delete e.CLAUDE_CODE_SESSION_ID,delete e.CLAUDE_CODE_CHILD_SESSION,delete e.CLAUDE_CODE_BRIDGE_SESSION_ID;...}`
  — when Claude Code spawns a fresh claude session it strips exactly these four and blanks
  `INVOCATION_ID`. The daemon should mirror this list (cheap to also drop `CLAUDE_CODE_ENTRYPOINT`
  and `AI_AGENT`; harmless). Empirical necessity: our spawn chain **does** leak the parent env —
  probe children received `CLAUDECODE=[1]` through both wt and cmd/start branches.
- **Resolution on Windows:** `where claude` → `claude` + `claude.cmd` (npm shims in the node dir);
  **no `claude.exe` on PATH**. The npm shim `claude.cmd` execs the package-internal
  `bin\claude.exe` (native binary; npm installs of 2.x ship it). The native installer
  (`%USERPROFILE%\.local\bin\claude.exe`) is absent on this machine. Consequences, empirically
  proven by start_shim/wt_shim: `cmd`'s `start` **does** resolve `.cmd` shims (PATHEXT); wt's bare
  CreateProcess does **not**. Invoking as `cmd /k claude` in both branches works for both install
  flavors (.cmd shim and native .exe).

Sources: local binary string extraction + `where`/shim inspection 2026-07-05; spawn matrix above;
report 02 §R4(vii).

---

## R3 — `wt` detection when Windows Terminal is a Store app: **`where wt` works from a plain user process; alias is on by default; two failure modes to handle**

- Empirical: `where.exe wt` → `C:\Users\ourba\AppData\Local\Microsoft\WindowsApps\wt.exe`.
  `fsutil reparsepoint query` shows reparse tag `0x8000001b` (APPEXECLINK App Execution Alias →
  `Program Files\WindowsApps\Microsoft.WindowsTerminal_1.24.11321.0_...\wt.exe`). Node
  `spawn('wt.exe', ...)` executes the alias fine (wt_direct/start_wt above) — CreateProcess
  handles APPEXECLINK reparse points; no elevation, plain user process, works from a hidden
  detached parent too.
- Official doc: "The Windows Terminal alias is turned on by default" (Manage app execution
  aliases); PATH must contain `%LOCALAPPDATA%\Microsoft\WindowsApps` (per-user PATH default).
- **Failure modes:** (a) user disabled the alias in Settings → `where wt` finds nothing —
  detection-by-`where` correctly reports absence, fallback branch fires; (b) daemon started with a
  stripped/system PATH (not our launcher path, but e.g. a service context) → `where` misses it;
  belt-and-braces: also `fs.existsSync(path.join(env.LOCALAPPDATA,'Microsoft/WindowsApps/wt.exe'))`.
  No UserChoice-hash interaction — that mechanism (report 02 §R2) is about file associations, not
  execution aliases.

Sources: local checks 2026-07-05; https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments
("Add Windows Terminal executable to your PATH" section).

---

## R4 — Fastify v5 bare SSE: **`reply.hijack()` + `reply.raw` is the documented pattern; defaults don't kill the stream; test first-event via `inject({payloadAsStream:true})`, disconnect-cleanup via real ephemeral listen**

- **Pattern (verified against Fastify main docs + empirically on fastify 5.9.0):**
  `reply.hijack()` "halt[s] the execution of the normal request lifecycle" and prevents automatic
  send; then `reply.raw.writeHead(200, {'content-type':'text/event-stream','cache-control':'no-cache'})`,
  `reply.raw.write('event: ...\ndata: ...\n\n')`, heartbeat comment `': hb\n\n'` on an interval,
  and cleanup on `request.raw.on('close', ...)`. Docs warn raw use "is at your own risk"; onResponse
  hooks still run. Empirical (`ssetest.mjs`): 200 + `text/event-stream`, event and heartbeats
  received by a raw http client.
- **Timeout interplay (Fastify v5 docs, Server.md):** `requestTimeout` default **0** (and it bounds
  *receiving the request*, not the response), `connectionTimeout` default **0**,
  `keepAliveTimeout` default **72000 ms** but applies to idle sockets *between* requests — none
  kills an in-flight SSE response. With the planned 25 s heartbeat the socket is never idle anyway.
- **Client disconnect:** empirically, destroying the client socket fired `request.raw` `'close'`
  and ran cleanup (`clearInterval`). `await app.close()` returned in ~1 ms even with a live SSE
  client still attached (v5 force-closes idle connections) — no shutdown hang; still, have the
  station's `stop()` end tracked SSE responses explicitly for deterministic teardown.
- **Test strategy:** `app.inject({url, payloadAsStream: true})` (light-my-request 6.6.0 in the
  workspace supports it) works for status/headers/first-event assertions — but destroying the
  injected stream did **not** fire the server-side `'close'` (cleanups stayed 0), so
  disconnect/cleanup tests need a real `listen({port:0, host:'127.0.0.1'})`. Exactly the plan's
  split ("inject; real listen only where SSE forces it") — confirmed with the boundary now known.

Sources: https://github.com/fastify/fastify/blob/main/docs/Reference/Reply.md and .../Server.md
(fetched 2026-07-05); local `ssetest.mjs` runs on fastify 5.9.0.

---

## R5 — chokidar 4.0.3 single-file watch on Windows vs atomic rename-over: **survives; `awaitWriteFinish` (and `atomic`) still supported in v4; no polling fallback needed**

Empirical (`choktest.mjs`, workspace chokidar 4.0.3, watching one `progress.json` with
`{ignoreInitial:true, awaitWriteFinish:{stabilityThreshold:150,pollInterval:50}}`):
plain rewrite → `change`; **three consecutive atomic rename-overs (tmp write + `renameSync` onto
the target) → `change` each time — the watch survives**; delete → `unlink`; recreate → event
resumed (came as `change`, not `add` — listen on `'all'` or add+change+unlink); rename-over after
recreate → `change`. Final read-back content correct (`{"v":6}`).

v4 option support (installed package README): "Atomic writes are supported, using `atomic` option"
(default true when not polling); "`awaitWriteFinish` (default false)" with
`stabilityThreshold`/`pollInterval` object form — both still documented in v4. `usePolling`/
`fs.watchFile` fallback exists but is **not needed** for this file-watch on Windows; keep
`awaitWriteFinish` (~150 ms stability) so half-written JSON isn't parsed (the parse-tolerant
last-good behavior in the plan covers any residue risk).

Source: local experiment 2026-07-05 + `packages/chartroom/node_modules/chokidar/README.md` (v4.0.3).

---

## R6 — npm name availability (facts for the Captain; publishing stays Captain-only)

Checked via `https://registry.npmjs.org/<name>` on 2026-07-05:
- **`ship` — TAKEN** (v0.2.5, last publish 2015-08-27, "Multi-platform deployment with node",
  maintainers jescalan/kylemac). Long-abandoned but occupied; npm name disputes/adoption are a
  human process.
- **`ship-cli` — TAKEN** (v1.0.0, 2016-11-18).
- **`captains-deck` — AVAILABLE** (404). Punctuation-variant `captainsdeck` also 404, so the name
  is genuinely publishable under npm's moniker/typosquat similarity rule (new names may not differ
  from existing ones only by punctuation).
- **`ship-hull` — AVAILABLE** (404); variant `shiphull` also 404 → publishable.
- `@ship/*` scope: **unverified** — npmjs.com org pages return 403 to anonymous fetches and the
  registry can't distinguish "org exists, package unpublished" from "org free". A scope the
  Captain already owns (or a new org, checkable at signup) is the reliable scoped route, e.g.
  `@<captain-scope>/ship`.
- Local bin name `ship` is unaffected by any of this (bin names aren't registry-scoped).

---

## Adjacent one-liners
- wt `;` command-delimiter is the only quoting landmine found for wt argv; Node array quoting handled every space case tested.
- The wt env-inheritance behavior changed across wt versions (GH issues #6434/#11094); on 1.24 with a commandline it inherits — pin behavior with `-w new` rather than relying on defaults.
- `light-my-request` injected-stream `.destroy()` not propagating to server `'close'` is worth a code comment in the SSE tests so nobody "simplifies" the real-listen test away.
- chokidar v4 emits `change` (not `add`) on recreate-after-unlink of a directly-watched file — handler should treat them identically.
