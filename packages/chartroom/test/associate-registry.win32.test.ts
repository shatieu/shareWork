// R3 integration proof (win32 only, plan §7bis): a `shell\open\command`-shaped value written via
// `reg.exe add` with an args ARRAY (no shell) survives byte-for-byte -- embedded quotes, spaces,
// unicode, and a literal `%1` (inert outside batch context). Writes ONLY to a scratch key under
// HKCU\Software\ChartRoomTest-* created by this test and removed again in teardown -- never the
// real Classes hive.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

const onWindows = process.platform === 'win32';
const SCRATCH_KEY = `HKCU\\Software\\ChartRoomTest-${randomBytes(6).toString('hex')}`;

function regRun(args: string[]): void {
  execFileSync('reg', args, { stdio: 'ignore' });
}

/** Read a value back through PowerShell/.NET with forced UTF-8 stdout -- `reg query`'s console
 * output would mangle unicode through the OEM codepage (researcher R3 empirical note). */
function readRegistryValue(key: string, valueName: string | null): string {
  const psPath = key.replace(/^HKCU\\/, 'HKCU:\\');
  const prop = valueName === null ? "'(default)'" : `'${valueName}'`;
  const script =
    `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ` +
    `(Get-ItemProperty -LiteralPath '${psPath}').${prop} | Write-Output`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return out.replace(/\r?\n$/, '');
}

afterAll(() => {
  if (!onWindows) return;
  try {
    regRun(['delete', SCRATCH_KEY, '/f']); // teardown of the key this test itself created
  } catch {
    /* never created */
  }
});

describe.runIf(onWindows)('reg.exe args-array write round-trip (scratch HKCU key)', () => {
  it('command value with quotes + spaces + unicode + literal %1 round-trips byte-for-byte', () => {
    const command =
      `"C:\\Program Files\\nodejs\\node.exe" ` +
      `"C:\\Users\\příliš žluťoučký\\.chartroom\\open-md.vbs" "%1"`;

    regRun(['add', `${SCRATCH_KEY}\\shell\\open\\command`, '/ve', '/t', 'REG_SZ', '/d', command, '/f']);
    expect(readRegistryValue(`${SCRATCH_KEY}\\shell\\open\\command`, null)).toBe(command);

    // Named-value form used for OpenWithProgIds (empty REG_SZ data under a named value).
    regRun(['add', SCRATCH_KEY, '/v', 'ChartRoom.md', '/t', 'REG_SZ', '/d', '', '/f']);
    expect(readRegistryValue(SCRATCH_KEY, 'ChartRoom.md')).toBe('');
  });
});
