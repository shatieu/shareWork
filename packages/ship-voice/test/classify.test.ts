import { describe, expect, it } from 'vitest';
import {
  classifyPermission,
  commandClipOf,
  confirmPhraseMatches,
  requiredConfirmPhrase,
} from '../src/classify.js';

const bash = (command: string) => ({ command });

describe('destructive classification (§6 spec-named classes)', () => {
  it('force push', () => {
    expect(classifyPermission('Bash', bash('git push --force origin main'))).toEqual({ destructive: true, verb: 'force push' });
    expect(classifyPermission('Bash', bash('git push -f'))).toEqual({ destructive: true, verb: 'force push' });
    expect(classifyPermission('Bash', bash('git push --force-with-lease'))).toEqual({ destructive: true, verb: 'force push' });
  });
  it('publish', () => {
    expect(classifyPermission('Bash', bash('npm publish --access public'))).toEqual({ destructive: true, verb: 'publish' });
    expect(classifyPermission('PowerShell', bash('pnpm publish'))).toEqual({ destructive: true, verb: 'publish' });
  });
  it('delete family across both shells', () => {
    expect(classifyPermission('Bash', bash('rm -rf dist')).verb).toBe('delete');
    expect(classifyPermission('PowerShell', bash('Remove-Item -Recurse build')).verb).toBe('delete');
    expect(classifyPermission('PowerShell', bash('del /s temp')).verb).toBe('delete');
    expect(classifyPermission('Bash', bash('rmdir old')).verb).toBe('delete');
  });
  it('migrations and drops', () => {
    expect(classifyPermission('Bash', bash('npx prisma migrate deploy')).verb).toBe('migrate');
    expect(classifyPermission('Bash', bash('psql -c "DROP TABLE users"')).verb).toBe('drop');
  });
  it('hard resets', () => {
    expect(classifyPermission('Bash', bash('git reset --hard origin/main')).verb).toBe('hard reset');
    expect(classifyPermission('Bash', bash('git clean -fd')).verb).toBe('hard reset');
  });
  it('ordinary commands are not destructive', () => {
    for (const cmd of ['git push origin main', 'npm test', 'git status', 'pnpm build', 'ls -la', 'git commit -m "x"']) {
      expect(classifyPermission('Bash', bash(cmd)).destructive).toBe(false);
    }
  });
  it('non-shell tools are not destructive by default', () => {
    expect(classifyPermission('Read', { file_path: '/x' }).destructive).toBe(false);
  });
});

describe('confirm phrases (§6: explicit phrase, never a bare yes)', () => {
  it('builds and matches phrases case/space-insensitively', () => {
    expect(requiredConfirmPhrase('publish')).toBe('confirm publish');
    expect(confirmPhraseMatches('Confirm  Publish', 'publish')).toBe(true);
    expect(confirmPhraseMatches('confirm force push', 'force push')).toBe(true);
  });
  it('rejects a bare yes and wrong verbs', () => {
    expect(confirmPhraseMatches('yes', 'publish')).toBe(false);
    expect(confirmPhraseMatches('confirm', 'publish')).toBe(false);
    expect(confirmPhraseMatches('confirm delete', 'publish')).toBe(false);
    expect(confirmPhraseMatches(undefined, 'publish')).toBe(false);
  });
});

describe('commandClipOf (§3 command metadata only)', () => {
  it('speaks the first line of a shell command, clipped', () => {
    expect(commandClipOf('Bash', bash('npm publish\nrm -rf /'))).toBe('`npm publish`');
    const long = commandClipOf('Bash', bash('x'.repeat(200)));
    expect(long.length).toBeLessThan(100);
    expect(long.endsWith('…`')).toBe(true);
  });
  it('names non-shell tools without exposing their inputs', () => {
    const clip = commandClipOf('Write', { file_path: '/etc/passwd', content: 'SECRET' });
    expect(clip).toBe('the Write tool');
    expect(clip).not.toContain('SECRET');
    expect(clip).not.toContain('/etc/passwd');
  });
});
