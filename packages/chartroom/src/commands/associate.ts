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

/**
 * The hidden launcher's VBScript source (wave-2 feature 5): Explorer invokes
 * `wscript.exe <vbs> "<file>"`, and the script re-runs `node <cli.js> open "<file>"` with window
 * style 0 -- no console window ever flashes on a double-click. A `.cmd` shim would flash; a
 * VBS + `WScript.Shell.Run(..., 0)` is the standard no-window trick without any new dependency.
 *
 * Exported as a pure function of the two baked-in paths so a test can assert the quoting (VBScript
 * escapes a literal `"` by doubling it) without touching the registry or the real home dir.
 */
export function buildVbsLauncher(nodeExePath: string, cliJsPath: string): string {
  return [
    `' Chart Room hidden launcher -- written by \`chartroom associate\`. Safe to delete;`,
    `' re-run \`chartroom associate\` to regenerate.`,
    `If WScript.Arguments.Count < 1 Then WScript.Quit 1`,
    `Set sh = CreateObject("WScript.Shell")`,
    `sh.Run """${nodeExePath}"" ""${cliJsPath}"" open """ & WScript.Arguments(0) & """", 0, False`,
    ``,
  ].join('\r\n');
}

function reg(args: string[]): void {
  execFileSync('reg', args, { stdio: 'ignore' });
}

function vbsPath(homeDir: string): string {
  return join(homeDir, '.chartroom', VBS_NAME);
}

function install(homeDir: string): void {
  const launcher = vbsPath(homeDir);
  mkdirSync(dirname(launcher), { recursive: true });
  writeFileSync(launcher, buildVbsLauncher(process.execPath, CLI_JS), 'utf8');

  const classes = 'HKCU\\Software\\Classes';
  reg(['add', `${classes}\\${PROG_ID}`, '/ve', '/d', 'Chart Room Markdown', '/f']);
  reg(['add', `${classes}\\${PROG_ID}\\DefaultIcon`, '/ve', '/d', `${process.execPath},0`, '/f']);
  reg([
    'add',
    `${classes}\\${PROG_ID}\\shell\\open\\command`,
    '/ve',
    '/d',
    `wscript.exe "${launcher}" "%1"`,
    '/f',
  ]);
  // Only *offer* Chart Room in the "Open with" list -- never forcibly steal the user's current
  // default .md handler (the whole point of OpenWithProgIds vs. overwriting `.md`'s default value).
  reg(['add', `${classes}\\.md\\OpenWithProgIds`, '/v', PROG_ID, '/t', 'REG_SZ', '/d', '', '/f']);
}

function remove(homeDir: string): void {
  const classes = 'HKCU\\Software\\Classes';
  // Best-effort, order-independent: any of these may already be gone.
  try {
    reg(['delete', `${classes}\\${PROG_ID}`, '/f']);
  } catch {
    /* not installed */
  }
  try {
    reg(['delete', `${classes}\\.md\\OpenWithProgIds`, '/v', PROG_ID, '/f']);
  } catch {
    /* not installed */
  }
  try {
    const launcher = vbsPath(homeDir);
    if (existsSync(launcher)) unlinkSync(launcher);
  } catch {
    /* leave it -- harmless orphan */
  }
}

/**
 * `chartroom associate [--remove]` (wave-2 feature 5, win32 only): registers a per-user (HKCU, no
 * admin rights) "Chart Room" handler for `.md` files via `reg.exe`, so the user can pick it in
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
          remove(homedir());
          console.log('chartroom: removed the "Chart Room" handler for .md files.');
          return;
        }

        install(homedir());
        console.log('chartroom: registered "Chart Room" as an Open-with choice for .md files.');
        console.log('To make it your default:');
        console.log('  right-click a .md file -> Open with -> Choose another app -> Chart Room -> Always');
      } catch (err) {
        console.error(`chartroom: fatal error: ${(err as Error).message}`);
        process.exitCode = 2;
      }
    });
}
