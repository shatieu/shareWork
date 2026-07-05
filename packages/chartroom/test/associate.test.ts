import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildPs1Launcher,
  buildVbsLauncher,
  installAssociation,
  removeAssociation,
} from '../src/commands/associate.js';

let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'chartroom-associate-test-home-'));
});

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

describe('launcher generation (pure)', () => {
  it('VBS: doubles quotes VBScript-style, runs window-style 0 (hidden), defensive On Error', () => {
    const vbs = buildVbsLauncher('C:\\Program Files\\nodejs\\node.exe', 'C:\\x\\dist\\cli.js');
    expect(vbs).toContain(
      'sh.Run """C:\\Program Files\\nodejs\\node.exe"" ""C:\\x\\dist\\cli.js"" open """ & WScript.Arguments(0) & """", 0, False',
    );
    expect(vbs).toContain('On Error Resume Next');
    expect(vbs).toContain('WScript.Quit 1');
  });

  it('PS1: single-quote escaping by doubling, literal $Path pass-through', () => {
    const ps1 = buildPs1Launcher("C:\\it's\\node.exe", 'C:\\x\\dist\\cli.js');
    expect(ps1).toContain("& 'C:\\it''s\\node.exe' 'C:\\x\\dist\\cli.js' open $Path");
    expect(ps1).toContain('param([Parameter(Mandatory = $true)][string]$Path)');
  });
});

describe('installAssociation (injected reg runner -- never touches the real registry)', () => {
  it('VBS path: writes the launcher and exactly the four offer-only reg adds', () => {
    const calls: string[][] = [];
    let notified = 0;
    const result = installAssociation({
      homeDir: fakeHome,
      regRun: (args) => calls.push(args),
      notifyShell: () => {
        notified += 1;
      },
      hasVbs: () => true,
      systemRoot: 'C:\\Windows',
    });

    expect(result.launcher).toBe('vbs');
    const launcher = join(fakeHome, '.chartroom', 'open-md.vbs');
    expect(result.launcherPath).toBe(launcher);
    expect(readFileSync(launcher, 'utf8')).toContain('CreateObject("WScript.Shell")');

    expect(calls).toEqual([
      ['add', 'HKCU\\Software\\Classes\\ChartRoom.md', '/ve', '/t', 'REG_SZ', '/d', 'Chart Room Markdown', '/f'],
      [
        'add',
        'HKCU\\Software\\Classes\\ChartRoom.md\\DefaultIcon',
        '/ve',
        '/t',
        'REG_SZ',
        '/d',
        `${process.execPath},0`,
        '/f',
      ],
      [
        'add',
        'HKCU\\Software\\Classes\\ChartRoom.md\\shell\\open\\command',
        '/ve',
        '/t',
        'REG_SZ',
        '/d',
        `"C:\\Windows\\System32\\wscript.exe" "${launcher}" "%1"`,
        '/f',
      ],
      ['add', 'HKCU\\Software\\Classes\\.md\\OpenWithProgIds', '/v', 'ChartRoom.md', '/t', 'REG_SZ', '/d', '', '/f'],
    ]);
    // R2 non-negotiables: never the `.md` default value; SHChangeNotify fired.
    expect(calls.some((c) => c[1] === 'HKCU\\Software\\Classes\\.md' && c.includes('/ve'))).toBe(false);
    expect(notified).toBe(1);
  });

  it('no-VBS machine: falls back to the hidden PowerShell -File launcher', () => {
    const calls: string[][] = [];
    const result = installAssociation({
      homeDir: fakeHome,
      regRun: (args) => calls.push(args),
      notifyShell: () => {},
      hasVbs: () => false,
      systemRoot: 'C:\\Windows',
    });

    expect(result.launcher).toBe('ps1');
    const launcher = join(fakeHome, '.chartroom', 'open-md.ps1');
    expect(existsSync(launcher)).toBe(true);
    const commandCall = calls.find((c) => c[1].endsWith('shell\\open\\command'));
    expect(commandCall?.[6]).toBe(
      `"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass ` +
        `-WindowStyle Hidden -File "${launcher}" "%1"`,
    );
  });

  it('a notifyShell failure never fails the install (best-effort semantics)', () => {
    expect(() =>
      installAssociation({
        homeDir: fakeHome,
        regRun: () => {},
        notifyShell: () => {
          throw new Error('no shell32 today');
        },
        hasVbs: () => true,
      }),
    ).not.toThrow();
  });
});

describe('removeAssociation', () => {
  it('deletes ProgID + OpenWithProgIds value, removes launchers, tolerates absent keys', () => {
    installAssociation({ homeDir: fakeHome, regRun: () => {}, notifyShell: () => {}, hasVbs: () => true });
    const launcher = join(fakeHome, '.chartroom', 'open-md.vbs');
    expect(existsSync(launcher)).toBe(true);

    const calls: string[][] = [];
    removeAssociation({
      homeDir: fakeHome,
      regRun: (args) => {
        calls.push(args);
        if (args[0] === 'delete') throw new Error('key not found'); // must be swallowed
      },
      notifyShell: () => {},
    });

    expect(calls).toEqual([
      ['delete', 'HKCU\\Software\\Classes\\ChartRoom.md', '/f'],
      ['delete', 'HKCU\\Software\\Classes\\.md\\OpenWithProgIds', '/v', 'ChartRoom.md', '/f'],
    ]);
    expect(existsSync(launcher)).toBe(false);
  });
});
