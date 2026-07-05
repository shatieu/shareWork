import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';

const HERE = dirname(fileURLToPath(import.meta.url));
/** dist/commands/associate.js -> dist/cli.js -- what the registered handler ultimately runs. */
const CLI_JS = join(HERE, '..', 'cli.js');

const PROG_ID = 'ChartRoom.md';
const VBS_NAME = 'open-md.vbs';
const PS1_NAME = 'open-md.ps1';

/**
 * The hidden launcher's VBScript source (v1.1): Explorer invokes `wscript.exe <vbs> "<file>"`, and
 * the script re-runs `node <cli.js> open "<file>"` with window style 0 -- no console window ever
 * flashes on a double-click. A `.cmd` shim would flash; VBS + `WScript.Shell.Run(..., 0)` is the
 * standard no-window trick without any new dependency. VBScript is deprecated but present and
 * enabled by default on all current Windows 11 releases (researcher R1, verified 2026-07-05;
 * disabled-by-default not expected before ~2027) -- `install` presence-checks it and falls back to
 * the PowerShell launcher when absent.
 *
 * Defensive per R1's adjacent note (wscript shows *blocking* GUI dialogs on script errors):
 * `On Error Resume Next` so a broken environment degrades to a silent no-op, never a modal trap.
 *
 * Exported as a pure function of the two baked-in paths so a test can assert the quoting (VBScript
 * escapes a literal `"` by doubling it) without touching the registry or the real home dir.
 */
export function buildVbsLauncher(nodeExePath: string, cliJsPath: string): string {
  return [
    `' Chart Room hidden launcher -- written by \`chartroom associate\`. Safe to delete;`,
    `' re-run \`chartroom associate\` to regenerate.`,
    `On Error Resume Next`,
    `If WScript.Arguments.Count < 1 Then WScript.Quit 1`,
    `Set sh = CreateObject("WScript.Shell")`,
    `sh.Run """${nodeExePath}"" ""${cliJsPath}"" open """ & WScript.Arguments(0) & """", 0, False`,
    ``,
  ].join('\r\n');
}

/**
 * Fallback launcher for machines without VBScript (researcher R1 fallback ranking #2): invoked as
 * `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File <ps1> "%1"`.
 * `-File` passes the path as one literal argument -- no nested-quoting hazards. Documented
 * degraded mode: powershell.exe is a console-subsystem app, so a console window flashes briefly
 * before `-WindowStyle Hidden` takes effect (R1: acceptable; truly flash-free without VBS would
 * need a shipped GUI helper exe, which is a Captain decision if/when VBS Phase 2 lands).
 */
export function buildPs1Launcher(nodeExePath: string, cliJsPath: string): string {
  return [
    `# Chart Room hidden launcher -- written by \`chartroom associate\`. Safe to delete;`,
    `# re-run \`chartroom associate\` to regenerate.`,
    `param([Parameter(Mandatory = $true)][string]$Path)`,
    `& '${nodeExePath.replace(/'/g, "''")}' '${cliJsPath.replace(/'/g, "''")}' open $Path`,
    ``,
  ].join('\r\n');
}

/** Injectable seams (plan §4.D): unit tests assert exact `reg.exe` argument vectors and launcher
 * bytes without touching the real registry, shell, or home directory. */
export interface AssociateDeps {
  homeDir?: string;
  /** Runs `reg.exe` with an args ARRAY, never a shell string (researcher R3: Node's win32 arg
   * quoting is exactly what reg.exe expects for quotes inside `/d`; `%1` is inert outside a
   * batch context, so it lands literally and ShellExecute substitutes it at open time). */
  regRun?: (args: string[]) => void;
  /** Fires SHChangeNotify(SHCNE_ASSOCCHANGED) -- researcher R2: without it Explorer may not
   * notice the new handler until re-login. Best-effort. */
  notifyShell?: () => void;
  platform?: NodeJS.Platform;
  /** R1 presence check: is the VBS runtime (wscript.exe + vbscript.dll) actually installed? */
  hasVbs?: () => boolean;
  systemRoot?: string;
  log?: (msg: string) => void;
}

function realRegRun(args: string[]): void {
  execFileSync('reg', args, { stdio: 'ignore' });
}

/** SHCNE_ASSOCCHANGED = 0x08000000, SHCNF_IDLIST = 0. Sent via a one-shot PowerShell P/Invoke
 * (no new dependency, no native module); `-EncodedCommand` sidesteps every quoting layer. */
function realNotifyShell(): void {
  const script =
    `Add-Type -Namespace ChartRoom -Name Shell -MemberDefinition ` +
    `'[DllImport("shell32.dll")] public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);';` +
    `[ChartRoom.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    stdio: 'ignore',
    timeout: 15_000,
  });
}

function defaultSystemRoot(): string {
  return process.env.SystemRoot ?? 'C:\\Windows';
}

function realHasVbs(systemRoot: string): boolean {
  return (
    existsSync(join(systemRoot, 'System32', 'wscript.exe')) &&
    existsSync(join(systemRoot, 'System32', 'vbscript.dll'))
  );
}

export interface InstallResult {
  launcher: 'vbs' | 'ps1';
  launcherPath: string;
}

/** Exported for unit testing (assert exact reg arg vectors + launcher content per launcher kind). */
export function installAssociation(deps: AssociateDeps = {}): InstallResult {
  const homeDir = deps.homeDir ?? homedir();
  const regRun = deps.regRun ?? realRegRun;
  const notifyShell = deps.notifyShell ?? realNotifyShell;
  const systemRoot = deps.systemRoot ?? defaultSystemRoot();
  const useVbs = (deps.hasVbs ?? (() => realHasVbs(systemRoot)))();

  const chartroomDir = join(homeDir, '.chartroom');
  mkdirSync(chartroomDir, { recursive: true });

  let launcherPath: string;
  let command: string;
  if (useVbs) {
    launcherPath = join(chartroomDir, VBS_NAME);
    writeFileSync(launcherPath, buildVbsLauncher(process.execPath, CLI_JS), 'utf8');
    const wscript = join(systemRoot, 'System32', 'wscript.exe');
    command = `"${wscript}" "${launcherPath}" "%1"`;
  } else {
    launcherPath = join(chartroomDir, PS1_NAME);
    writeFileSync(launcherPath, buildPs1Launcher(process.execPath, CLI_JS), 'utf8');
    const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    command = `"${powershell}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${launcherPath}" "%1"`;
  }

  const classes = 'HKCU\\Software\\Classes';
  // A ProgID is only honored if it is *fully* registered (researcher R2): friendly default value
  // AND a valid open command.
  regRun(['add', `${classes}\\${PROG_ID}`, '/ve', '/t', 'REG_SZ', '/d', 'Chart Room Markdown', '/f']);
  regRun(['add', `${classes}\\${PROG_ID}\\DefaultIcon`, '/ve', '/t', 'REG_SZ', '/d', `${process.execPath},0`, '/f']);
  regRun(['add', `${classes}\\${PROG_ID}\\shell\\open\\command`, '/ve', '/t', 'REG_SZ', '/d', command, '/f']);
  // Offer-only (researcher R2 (iii)): list the ProgID under OpenWithProgIds and NEVER write the
  // `.md` key's default value -- if no UserChoice exists, a `.md` default value would silently
  // become the effective handler, i.e. stealing. The user's own "Always" click sets UserChoice,
  // the only Windows-sanctioned way to change the default.
  regRun(['add', `${classes}\\.md\\OpenWithProgIds`, '/v', PROG_ID, '/t', 'REG_SZ', '/d', '', '/f']);

  try {
    notifyShell();
  } catch {
    // Best-effort: worst case Explorer shows the new entry after the next logon.
  }

  return { launcher: useVbs ? 'vbs' : 'ps1', launcherPath };
}

/** Exported for unit testing. Best-effort, order-independent: any of these may already be gone. */
export function removeAssociation(deps: AssociateDeps = {}): void {
  const homeDir = deps.homeDir ?? homedir();
  const regRun = deps.regRun ?? realRegRun;
  const notifyShell = deps.notifyShell ?? realNotifyShell;

  const classes = 'HKCU\\Software\\Classes';
  try {
    regRun(['delete', `${classes}\\${PROG_ID}`, '/f']);
  } catch {
    /* not installed */
  }
  try {
    regRun(['delete', `${classes}\\.md\\OpenWithProgIds`, '/v', PROG_ID, '/f']);
  } catch {
    /* not installed */
  }
  for (const name of [VBS_NAME, PS1_NAME]) {
    try {
      const launcher = join(homeDir, '.chartroom', name);
      if (existsSync(launcher)) unlinkSync(launcher);
    } catch {
      /* leave it -- harmless orphan */
    }
  }

  try {
    notifyShell();
  } catch {
    /* best-effort */
  }
}

/**
 * `chartroom associate [--remove]` (v1.1, win32 only): registers a per-user (HKCU, no admin
 * rights) "Chart Room" handler for `.md` files via `reg.exe`, so the user can pick it in
 * Explorer's "Open with" dialog. Deliberately does NOT change the current default handler -- the
 * user opts in per the printed instructions, Windows' own way.
 */
export function registerAssociateCommand(program: Command): void {
  program
    .command('associate')
    .description('Register Chart Room as an "Open with" choice for .md files (Windows only).')
    .option('--remove', 'remove the .md association again')
    .action((opts: { remove?: boolean }) => {
      if (process.platform !== 'win32') {
        console.log('chartroom: `associate` manages Windows file associations and is Windows only.');
        return;
      }

      try {
        if (opts.remove) {
          removeAssociation();
          console.log('chartroom: removed the "Chart Room" handler for .md files.');
          return;
        }

        const result = installAssociation();
        console.log('chartroom: registered "Chart Room" as an Open-with choice for .md files.');
        if (result.launcher === 'ps1') {
          console.log(
            'chartroom: note -- VBScript is not installed on this machine, so the PowerShell launcher was ' +
              'used instead (a console window may flash briefly when opening files).',
          );
        }
        console.log('To make it your default:');
        console.log('  right-click a .md file -> Open with -> Choose another app -> Chart Room -> Always');
      } catch (err) {
        console.error(`chartroom: fatal error: ${(err as Error).message}`);
        process.exitCode = 2;
      }
    });
}
