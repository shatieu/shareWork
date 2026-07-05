---
id: 02-chartroom-v11-researcher-report-r1-r5
---

# 02-chartroom-v11 — Researcher report (R1–R5)

Date: 2026-07-05. Local machine: Windows 11 Pro 25H2 (build 10.0.26200.8655, `reg query HKLM\...\CurrentVersion /v DisplayVersion` → `25H2`). Claude Code CLI: **2.1.201** (`claude --version`). Node local: v24.14.0 (repo targets >=20).

---

## R1 — VBScript / wscript availability on Windows 11 (blocking for d): **GO for the VBS launcher, with an install-time presence check**

**Answer:** `wscript.exe` and VBScript are still present and enabled by default on all current Windows 11 releases (23H2/24H2/25H2). VBScript is *deprecated* (announced Oct 2023) and became a **Feature on Demand that is pre-installed and enabled by default in 24H2+**. Microsoft's published timeline: Phase 2 (~**2027**) the FoD stops being enabled by default; Phase 3 (date "currently unknown") full removal. As of the Microsoft Learn deprecated-features page (page `updated_at: 2026-02-02`), the entry still reads only: "VBScript is deprecated. In future releases of Windows, VBScript will be available as a feature on demand before its removal from the operating system." — no removal date committed, no acceleration reflected in the official docs.

**Empirical:** on this 25H2 box: `C:\Windows\System32\wscript.exe` (184320 bytes, dated 2025-06-09) and `C:\Windows\System32\vbscript.dll` + SysWOW64 copy all present; `cscript` executed a .vbs successfully (see R3).

**Verdict / design guidance:**
- **GO** for the wscript+VBS hidden launcher now — it works by default on every supported Win11 release through at least 2026, and the official Phase-2 (disabled-by-default) date is ~2027.
- The `associate` installer should do a cheap presence check (`wscript.exe` + `System32\vbscript.dll` exist) at install time and fall back if absent.
- **Fallback ranking (no new shipped binary, no admin):**
  1. `wscript.exe launcher.vbs "%1"` — zero window, the classic mechanism. Preferred while available.
  2. `powershell.exe -NoProfile -WindowStyle Hidden -Command ...` — functional, but a console window **flashes briefly** (powershell.exe is a console-subsystem app; the console is created before `-WindowStyle Hidden` takes effect). Widely-reported, long-standing behavior. Acceptable degraded mode.
  3. `conhost.exe --headless <cmd>` — **undocumented** flag; unverified across builds; do not rely on it (unverified — treat as not an option).
  4. Truly flash-free without VBS requires a GUI-subsystem helper exe → per plan Risk 1, that escalates to a Captain decision (only when Phase 2 actually lands).
- Note: re-enabling the VBScript FoD after Phase 2 (`Add-WindowsCapability`) **requires admin**, so the fallback path matters for the long term.

Sources:
- Microsoft, "VBScript deprecation: Timelines and next steps" (Windows IT Pro Blog, May 2024): Phase 1 = FoD pre-installed/enabled by default in 24H2+; Phase 2 ~2027 = not enabled by default; Phase 3 = retired/eliminated, date unknown. https://techcommunity.microsoft.com/blog/windows-itpro-blog/vbscript-deprecation-timelines-and-next-steps/4148301 (confirmed via search summary + devblogs mirror dated 2024-05-30; the techcommunity page itself is JS-rendered and would not fetch)
- Microsoft Learn, "Deprecated features in the Windows client", VBScript row, announced October 2023, page updated 2026-02-02. https://learn.microsoft.com/en-us/windows/whats-new/deprecated-features
- Local empirical checks above (2026-07-05).

---

## R2 — Per-user HKCU\Software\Classes ProgID + `.md\OpenWithProgIds` (blocking for d): **confirmed, design is sound**

**(i) Appears in "Open with → Choose another app": YES.** Microsoft Learn "File Types" (fa-file-types): "To make a file type registration visible to the current user only, create an entry for the file type in the **HKEY_CURRENT_USER\Software\Classes** subkey" and, for `OpenWithProgIds`: "This subkey contains a list of alternate ProgIDs for this file type. The programs for these ProgIDs appear in the **Open with** menu…". HKCR is the merged view of HKCU\Software\Classes over HKLM, and HKCU wins. So a non-admin write of `HKCU\Software\Classes\<ProgID>` (+ `shell\open\command`) and `HKCU\Software\Classes\.md\OpenWithProgIds\<ProgID>` is exactly the documented mechanism. Caveat from same doc: **call `SHChangeNotify(SHCNE_ASSOCCHANGED)` after writing** or Explorer may not notice until reboot/re-login. Also: "Windows respects the Default value only if the ProgID found there is a registered ProgID" — our ProgID must be fully registered (default value = friendly name, valid command) or it is ignored.

**(ii) User's "Always" sets UserChoice without admin: YES.** The default-handler choice lives in `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice` (ProgId + Hash). The hash is written **by the Windows shell in the user's own context** when the user picks the app in the Open-with/Settings UI — no elevation involved (the whole key is per-user HKCU). The hash mechanism exists precisely to force the choice through the user GUI; the GUI path is the supported, non-admin path. (Empirical on this box: no `FileExts\.md\UserChoice` currently exists — .md is unclaimed here, which is the easy case.)

**(iii) UserChoice-hash caveat:** the hash only blocks **programmatic** setting of the default (writes without a valid hash are ignored/reset, and the UserChoice key carries a deny-ACL against the user's own SetValue). It does **not** interfere with the user selecting our handler in the dialog. New 2025 caveat: Windows 11 consumer builds added a second **`UserChoiceLatest`** key with a new hash algorithm (includes a machine ID) — again only relevant to hash-spoofing tools (it broke SetUserFTA-style utilities), not to GUI selection. Since the plan never sets the default programmatically, **no caveat blocks the design**. One behavioral note: if *no* UserChoice exists for `.md`, the legacy `HKCU\Software\Classes\.md` default-value ProgID can itself become the effective handler; the plan's "offer, never steal" approach should set `OpenWithProgIds` only (not the `.md` default value) to stay strictly non-stealing.

Sources: MS Learn fa-file-types (updated 2025-04-15), https://learn.microsoft.com/en-us/windows/win32/shell/fa-file-types; MS Learn HKEY_CLASSES_ROOT key doc; kolbi.cz "SetUserFTA: UserChoice Hash defeated" (2017-10-25) and "UserChoiceLatest – Microsoft's new protection for file type associations" (2025-04-20), https://kolbi.cz/blog/2025/04/20/userchoicelatest-microsofts-new-protection-for-file-type-associations/; local reg queries (2026-07-05).

---

## R3 — `"%1"` quoting through `shell\open\command` written via `reg.exe add /d`: **verified (arg leg empirically; reg leg analytically)**

**Empirical (wscript/cscript arg leg):** script `argtest2.vbs`/`existstest.vbs` invoked as `cscript //nologo existstest.vbs "<path with spaces + Czech diacritics>"` — result: `count=1`, `exists=True` via `FileSystemObject.FileExists` on a real file at `...\path with spaces\příliš žluťoučký\note žluť.md`. So a quoted path containing spaces **and non-ASCII** arrives as exactly one argument, byte-correct (the mojibake seen in cscript's console echo is OEM-codepage *display* only — FileExists proves the string itself is intact). `WScript.Arguments(0)` strips the surrounding quotes; pass it on re-quoted when building the CLI command inside the .vbs.

**Analytic (reg.exe leg):**
- Write the value with Node `spawnSync("reg.exe", ["add", key, "/ve", "/t", "REG_SZ", "/d", value, "/f"])` — **args array, no `shell: true`**. Node's Windows arg-quoting turns embedded `"` into `\"` on the CreateProcess command line, which is exactly the escaping reg.exe expects for quotes inside `/d`. Value string in JS: `"C:\\Windows\\System32\\wscript.exe" "C:\\...\\launcher.vbs" "%1"` (literal quotes around all three parts).
- `%1` is inert everywhere outside a running .bat/.cmd batch context — cmd.exe only expands `%1` as a batch parameter, and `%1` cannot match `%VAR%` env expansion (no terminating `%name%` pair). So the literal `%1` lands in the registry and is substituted by the **shell** (ShellExecute) at open time, quoted because we wrote `"%1"`.
- reg.exe and the registry are UTF-16 end-to-end (REG_SZ), so unicode install paths in the command value are safe.
- Pitfall to avoid: building the command as a single string through `cmd /c reg add ...` — then you need `\"`/`^` escaping and `%` handling by hand. Don't; use the args array.
- Not empirically run end-to-end here because registry **writes** were out of scope for this research pass (read-only queries only). Recommend implementation add an integration test that writes to a scratch key (e.g. `HKCU\Software\ChartRoomTest\...`), reads it back with `reg query`, and launches the launcher directly.

---

## R4 — `claude -p` headless contract (blocking for c): **all sub-questions verified; hooks incl. PostToolUseFailure empirically confirmed in -p mode**

Verified against Claude Code docs (code.claude.com, fetched 2026-07-05) **and** live runs with local CLI **2.1.201**.

**(i) Permission flags:** `--permission-mode <acceptEdits|auto|bypassPermissions|manual|dontAsk|plan>`; `--allowedTools "Read,Bash(git *),Edit"` (permission-rule syntax, space before `*` matters); `--disallowedTools`; `--tools` restricts the available built-in tool set; `--dangerously-skip-permissions` = bypassPermissions. For the acceptance script's scratch-repo runs, prefer `--allowedTools "Read"` (or the minimal set) over skip-permissions. Empirical: `--allowedTools "Read"` ran Read without any prompt.

**(ii) `--output-format json` fields** (empirical, full payload from a real run): `type:"result"`, `subtype:"success"`, `is_error`, `duration_ms`, `duration_api_ms`, `num_turns`, **`result`** (final text), `stop_reason`, **`session_id`**, **`total_cost_usd`**, `usage` (tokens incl. cache), `modelUsage` (per-model cost), `permission_denials`, `terminal_reason`, `uuid`. With `--json-schema`, structured output lands in `structured_output`.

**(iii) Resume:** `claude -p "<prompt>" --resume <session_id>` — empirically confirmed: resumed session `324017ee-...`, model recalled prior-turn content, JSON echoed the **same** session_id. `--fork-session` mints a new ID; `--continue` resumes most recent in cwd; session lookup is scoped to the invocation directory (run phase A and B from the same cwd). `--session-id <uuid>` pins an explicit ID.

**(iv) Turn/cost caps:** `--max-turns <n>` is accepted and documented (docs: "Stop after N agentic turns; exit with error at limit") — **note: it no longer appears in `claude --help` in 2.1.201 but is still accepted** (empirically passed `--max-turns 6` without error). `--max-budget-usd <amount>` is in help and docs (print-mode only). Recommend passing both in the acceptance script.

**(v) Do project `.claude/` hooks and skills load AND fire in `-p`?** **YES — empirically confirmed for hooks.** Scratch project with `.claude/settings.json` defining `PostToolUse` and `PostToolUseFailure` hooks (matcher `Read`): a single `claude -p` run that Read a missing file then a real file produced `hookslog.txt` containing both `PostToolUseFailure` and `PostToolUse`. Docs confirm the general rule: "Without it [--bare], `claude -p` loads the same context an interactive session would" (hooks, skills, plugins, MCP, CLAUDE.md). Skills: docs note "User-invoked skills and custom commands work in -p mode: include /skill-name in the prompt string". Caveats: `--bare` and `--safe-mode` skip hooks/skills — do NOT use them for phase c; `--setting-sources` can also exclude project settings; help text warns settings files that fail validation are **silently ignored** in -p mode (validate the JSON in tests).

**(vi) `PostToolUseFailure`:** **exists and is correct.** Current hooks doc lifecycle table: "PostToolUseFailure — After a tool call fails"; receives tool-specific input, matches on tool name via `matcher`; cannot block (exit 2 → "Shows stderr to Claude; the tool already failed"). Empirically fired on the failed Read (above). Phase 5's correction stands.

**(vii) Nesting pitfalls:** spawning `claude -p` from inside this Claude Code session (env has `CLAUDECODE=1`, `CLAUDE_CODE_ENTRYPOINT=cli`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION=1`) **worked with no nesting guard triggered** in 2.1.201. Trust dialog is skipped in -p (per `--help`: "The workspace trust dialog is skipped when Claude is run in non-interactive mode… Only use this in directories you trust"). For determinism the acceptance script may want to scrub `CLAUDE_*`/`CLAUDECODE` from the child env anyway, but it is not required. One real interaction: `-p` runs terminate lingering background Bash tasks ~5 s after the result (v2.1.163+).

**(viii) Auth reuse:** **YES** — no `ANTHROPIC_API_KEY` present in env (verified), yet `-p` runs completed using the logged-in OAuth credentials. Exception: `--bare` never reads OAuth/keychain (requires ANTHROPIC_API_KEY or apiKeyHelper) — another reason to avoid `--bare` here.

Sources: https://code.claude.com/docs/en/cli-reference, https://code.claude.com/docs/en/headless, https://code.claude.com/docs/en/hooks (all fetched 2026-07-05); empirical runs in scratchpad `claude-p-test` (transcript in session; total spend ~$0.05, model haiku).

---

## R5 — Node `os.homedir()` honors `USERPROFILE` (win32) / `HOME` (POSIX): **YES**

Node v20 docs (os.homedir): "On Windows, it uses the `USERPROFILE` environment variable if defined. Otherwise it uses the path to the profile directory of the current user." / POSIX: "it uses the `$HOME` environment variable if defined." Same text for v22/v24 (behavior lives in libuv `uv_os_homedir`, unchanged across these lines). **Empirical (local, Node 24.14.0):** setting `process.env.USERPROFILE='C:/fake-home-test'` before calling `os.homedir()` returned `C:/fake-home-test`. Caveat for the acceptance script: the override must be set in the **child process env** (`spawn(..., { env: {...process.env, USERPROFILE: isoDir} })`) — mutating it after a library cached `os.homedir()` won't help; and cross-platform scripts should set **both** `USERPROFILE` and `HOME`.

Source: https://nodejs.org/docs/latest-v20.x/api/os.html (fetched 2026-07-05) + local test.

---

## Adjacent one-liners
- `--max-turns` vanished from `claude --help` in 2.1.201 while remaining functional — treat help output, not docs, as incomplete.
- Windows help: `reg query` under git-bash needs `MSYS_NO_PATHCONV=1` (or `//v`) to stop `/v`→path mangling — relevant for any bash-side acceptance tooling.
- wscript.exe shows GUI error dialogs on script errors and blocks forever; the launcher .vbs should be defensive (On Error) and tests should use `cscript //nologo` (console, non-blocking).
- `--no-session-persistence` exists; do NOT pass it in phase A or `--resume` in phase B will fail.
