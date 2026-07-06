import { describe, expect, it } from 'vitest';
import {
  gitignoreMatch,
  matchCommandPattern,
  matchDomainRule,
  matchPathRule,
  matchRule,
  matchToolName,
  parseRule,
  splitCompoundCommand,
  stripProcessWrappers,
  toPosixPath,
  type RuleContext,
} from '../src/rules.js';

/** Every case in this file encodes a fact verified against code.claude.com/docs/en/permissions
 * (fetched 2026-07-06) -- cited in plan 07 §2. */

const ctx: RuleContext = { sourceDir: '/proj', cwd: '/proj', homeDir: '/home/alice' };

describe('parseRule', () => {
  it('parses bare tool, specifier, and rejects garbage', () => {
    expect(parseRule('Bash')).toEqual({ tool: 'Bash' });
    expect(parseRule('Bash(npm run build)')).toEqual({ tool: 'Bash', specifier: 'npm run build' });
    expect(parseRule('WebFetch(domain:example.com)')).toEqual({ tool: 'WebFetch', specifier: 'domain:example.com' });
    expect(parseRule('')).toBeUndefined();
    expect(parseRule('(x)')).toBeUndefined();
  });

  it('keeps nested parentheses inside the specifier', () => {
    expect(parseRule('Bash(echo (hi))')).toEqual({ tool: 'Bash', specifier: 'echo (hi)' });
  });
});

describe('tool-name matching (docs "Tool name wildcards")', () => {
  it('exact names match; unrelated names do not', () => {
    expect(matchToolName('Bash', 'Bash', 'allow').kind).toBe('match');
    expect(matchToolName('Bash', 'PowerShell', 'allow').kind).toBe('no-match');
  });

  it('deny/ask accept full-name globs: * and mcp__*', () => {
    expect(matchToolName('*', 'WebFetch', 'deny').kind).toBe('match');
    expect(matchToolName('mcp__*', 'mcp__github__get_issue', 'deny').kind).toBe('match');
    expect(matchToolName('mcp__*', 'Bash', 'deny').kind).toBe('no-match');
  });

  it('allow rules skip unanchored globs (CC warns + ignores them)', () => {
    for (const pattern of ['*', 'B*', 'mcp__*']) {
      const outcome = matchToolName(pattern, 'Bash', 'allow');
      expect(outcome.kind).toBe('no-match');
      expect((outcome as { note?: string }).note).toMatch(/unanchored/);
    }
  });

  it('allow globs anchored at a literal mcp__<server>__ prefix work', () => {
    expect(matchToolName('mcp__puppeteer__*', 'mcp__puppeteer__navigate', 'allow').kind).toBe('match');
    expect(matchToolName('mcp__github__get_*', 'mcp__github__get_issue', 'allow').kind).toBe('match');
    expect(matchToolName('mcp__github__get_*', 'mcp__github__create_issue', 'allow').kind).toBe('no-match');
  });

  it('bare mcp__server covers every tool of that server', () => {
    expect(matchToolName('mcp__puppeteer', 'mcp__puppeteer__navigate', 'allow').kind).toBe('match');
    expect(matchToolName('mcp__puppeteer', 'mcp__other__navigate', 'allow').kind).toBe('no-match');
  });
});

describe('Bash command patterns (docs "Wildcard patterns" + "Bash")', () => {
  it('exact match without glob', () => {
    expect(matchCommandPattern('npm run build', 'npm run build')).toBe(true);
    expect(matchCommandPattern('npm run build', 'npm run build --watch')).toBe(false);
  });

  it('trailing " *" enforces a word boundary: ls * matches ls -la and bare ls, not lsof', () => {
    expect(matchCommandPattern('ls *', 'ls -la')).toBe(true);
    expect(matchCommandPattern('ls *', 'ls')).toBe(true);
    expect(matchCommandPattern('ls *', 'lsof')).toBe(false);
  });

  it('no space before * = no word boundary: ls* matches lsof', () => {
    expect(matchCommandPattern('ls*', 'lsof')).toBe(true);
    expect(matchCommandPattern('ls*', 'ls -la')).toBe(true);
  });

  it(':* suffix is equivalent to a trailing " *"', () => {
    expect(matchCommandPattern('ls:*', 'ls -la')).toBe(true);
    expect(matchCommandPattern('ls:*', 'lsof')).toBe(false);
    expect(matchCommandPattern('git push:*', 'git push origin main')).toBe(true);
  });

  it(':* elsewhere is literal (docs: "Bash(git:* push)" treats the colon literally)', () => {
    expect(matchCommandPattern('git:* push', 'git checkout push')).toBe(false);
    expect(matchCommandPattern('git:* push', 'git:anything push')).toBe(true);
  });

  it('a single * spans spaces / multiple arguments', () => {
    expect(matchCommandPattern('git *', 'git log --oneline --all')).toBe(true);
    expect(matchCommandPattern('git * main', 'git push origin main')).toBe(true);
    expect(matchCommandPattern('git * main', 'git merge main')).toBe(true);
    expect(matchCommandPattern('git * main', 'git push origin dev')).toBe(false);
  });

  it('wildcards at the beginning and middle', () => {
    expect(matchCommandPattern('* --version', 'node --version')).toBe(true);
    expect(matchCommandPattern('* --help *', 'npm --help install')).toBe(true);
  });

  it('PowerShell matching is case-insensitive', () => {
    expect(matchCommandPattern('Get-ChildItem *', 'get-childitem -Force', true)).toBe(true);
    expect(matchCommandPattern('Get-ChildItem *', 'get-childitem -Force', false)).toBe(false);
  });
});

describe('compound command splitting (docs "Compound commands")', () => {
  it('splits on && || ; | |& & and newlines', () => {
    expect(splitCompoundCommand('git status && npm test')).toEqual(['git status', 'npm test']);
    expect(splitCompoundCommand('a || b')).toEqual(['a', 'b']);
    expect(splitCompoundCommand('a; b | c')).toEqual(['a', 'b', 'c']);
    expect(splitCompoundCommand('a |& b')).toEqual(['a', 'b']);
    expect(splitCompoundCommand('sleep 5 &')).toEqual(['sleep 5']);
    expect(splitCompoundCommand('a\nb')).toEqual(['a', 'b']);
  });

  it('does not split inside quotes', () => {
    expect(splitCompoundCommand('echo "a && b"')).toEqual(['echo "a && b"']);
    expect(splitCompoundCommand("echo 'x; y'")).toEqual(["echo 'x; y'"]);
  });
});

describe('process wrapper stripping (docs "Process wrappers")', () => {
  it('strips timeout/time/nice/nohup/stdbuf', () => {
    expect(stripProcessWrappers('timeout 30 npm test')).toBe('npm test');
    expect(stripProcessWrappers('time npm test')).toBe('npm test');
    expect(stripProcessWrappers('nohup npm test')).toBe('npm test');
    expect(stripProcessWrappers('nice -n 10 npm test')).toBe('npm test');
    expect(stripProcessWrappers('stdbuf -o0 npm test')).toBe('npm test');
  });

  it('strips bare xargs but keeps flagged xargs (docs)', () => {
    expect(stripProcessWrappers('xargs grep pattern')).toBe('grep pattern');
    expect(stripProcessWrappers('xargs -n1 grep pattern')).toBe('xargs -n1 grep pattern');
  });

  it('rule matches through a wrapper: Bash(npm test *) matches timeout 30 npm test', () => {
    expect(matchCommandPattern('npm test *', 'timeout 30 npm test')).toBe(true);
  });
});

describe('Read/Edit path rules (docs "Read and Edit" -- gitignore semantics + anchors)', () => {
  it('// = filesystem root', () => {
    expect(matchPathRule('//Users/alice/secrets/**', '/Users/alice/secrets/key.pem', ctx).kind).toBe('match');
    expect(matchPathRule('//Users/alice/secrets/**', '/Users/bob/secrets/key.pem', ctx).kind).toBe('no-match');
  });

  it('~/ = home directory', () => {
    expect(matchPathRule('~/Documents/*.pdf', '/home/alice/Documents/tax.pdf', ctx).kind).toBe('match');
    expect(matchPathRule('~/Documents/*.pdf', '/home/alice/Documents/sub/tax.pdf', ctx).kind).toBe('no-match');
    expect(matchPathRule('~/.zshrc', '/home/alice/.zshrc', ctx).kind).toBe('match');
  });

  it('/ = the settings source dir, NOT the filesystem root (docs warning)', () => {
    expect(matchPathRule('/src/**/*.ts', '/proj/src/a/b.ts', ctx).kind).toBe('match');
    expect(matchPathRule('/src/**/*.ts', '/src/a/b.ts', ctx).kind).toBe('no-match');
    // Same rule in user settings anchors at ~/.claude
    const userCtx: RuleContext = { ...ctx, sourceDir: '/home/alice/.claude' };
    expect(matchPathRule('/secrets/**', '/home/alice/.claude/secrets/x', userCtx).kind).toBe('match');
    expect(matchPathRule('/secrets/**', '/proj/secrets/x', userCtx).kind).toBe('no-match');
  });

  it('bare filename matches at any depth under cwd: Read(.env) ≡ Read(**/.env)', () => {
    expect(matchPathRule('.env', '/proj/.env', ctx).kind).toBe('match');
    expect(matchPathRule('.env', '/proj/apps/web/.env', ctx).kind).toBe('match');
    expect(matchPathRule('**/.env', '/proj/apps/web/.env', ctx).kind).toBe('match');
    // ...but not outside the cwd anchor
    expect(matchPathRule('.env', '/elsewhere/.env', ctx).kind).toBe('no-match');
  });

  it('relative and ./ patterns anchor at cwd', () => {
    expect(matchPathRule('./.env', '/proj/.env', ctx).kind).toBe('match');
    expect(matchPathRule('src/**', '/proj/src/deep/file.ts', ctx).kind).toBe('match');
  });

  it('* stays within one segment; ** crosses directories', () => {
    expect(gitignoreMatch('src/*.ts', 'src/a.ts').kind).toBe('match');
    expect(gitignoreMatch('src/*.ts', 'src/deep/a.ts').kind).toBe('no-match');
    expect(gitignoreMatch('src/**/*.ts', 'src/deep/er/a.ts').kind).toBe('match');
  });

  it('Windows paths normalize to POSIX /c/... form (docs)', () => {
    expect(toPosixPath('C:\\Users\\alice\\x.env')).toBe('/c/Users/alice/x.env');
    expect(matchPathRule('//c/**/.env', 'C:\\Users\\alice\\proj\\.env', ctx).kind).toBe('match');
    expect(matchPathRule('//**/.env', 'D:\\anywhere\\.env', ctx).kind).toBe('match');
  });

  it('unsupported gitignore syntax is unevaluated, never silently non-matching', () => {
    expect(gitignoreMatch('!negated', 'whatever').kind).toBe('unevaluated');
    expect(gitignoreMatch('[ab].env', 'a.env').kind).toBe('unevaluated');
  });
});

describe('WebFetch domain rules (docs "WebFetch")', () => {
  it('exact domain, case-insensitive, trailing dot stripped', () => {
    expect(matchDomainRule('domain:example.com', 'https://EXAMPLE.com/path').kind).toBe('match');
    expect(matchDomainRule('domain:example.com.', 'https://example.com/').kind).toBe('match');
    expect(matchDomainRule('domain:example.com', 'https://example.org/').kind).toBe('no-match');
  });

  it('leading *. matches subdomains at any depth but NOT the apex', () => {
    expect(matchDomainRule('domain:*.example.com', 'https://api.example.com').kind).toBe('match');
    expect(matchDomainRule('domain:*.example.com', 'https://a.b.example.com').kind).toBe('match');
    expect(matchDomainRule('domain:*.example.com', 'https://example.com').kind).toBe('no-match');
  });

  it('elsewhere * matches within one dot-delimited label only', () => {
    expect(matchDomainRule('domain:example.*', 'https://example.org').kind).toBe('match');
    expect(matchDomainRule('domain:example.*', 'https://example.evil.com').kind).toBe('no-match');
  });

  it('domain:* matches everything', () => {
    expect(matchDomainRule('domain:*', 'https://anything.at.all').kind).toBe('match');
  });
});

describe('param rules Tool(param:value) (docs "Match by input parameter")', () => {
  const call = { tool: 'Agent', input: { model: 'opus', isolation: 'worktree' } };

  it('deny/ask match exact values and * wildcards', () => {
    expect(matchRule('Agent(model:opus)', call, ctx, 'deny').kind).toBe('match');
    expect(matchRule('Agent(model:sonnet)', call, ctx, 'deny').kind).toBe('no-match');
    expect(matchRule('Agent(isolation:*)', call, ctx, 'deny').kind).toBe('match');
  });

  it('an omitted param never matches', () => {
    expect(matchRule('Agent(model:*)', { tool: 'Agent', input: {} }, ctx, 'deny').kind).toBe('no-match');
  });

  it('param rules are deny/ask-only -- allow form is unevaluated', () => {
    expect(matchRule('Agent(model:opus)', call, ctx, 'allow').kind).toBe('unevaluated');
  });

  it('canonicalized fields are ignored by CC: Bash(command:rm *) is a definitive no-match with a note', () => {
    const outcome = matchRule('Bash(command:rm *)', { tool: 'Bash', command: 'rm -rf /' }, ctx, 'deny');
    expect(outcome.kind).toBe('no-match');
    expect((outcome as { note?: string }).note).toMatch(/canonicalized/);
  });
});

describe('matchRule end-to-end shapes', () => {
  it('bare Tool and Tool(*) are equivalent (docs)', () => {
    expect(matchRule('Bash', { tool: 'Bash', command: 'anything at all' }, ctx, 'deny').kind).toBe('match');
    expect(matchRule('Bash(*)', { tool: 'Bash', command: 'anything at all' }, ctx, 'deny').kind).toBe('match');
  });

  it('Agent(Explore)-style specifiers match the named subagent', () => {
    expect(matchRule('Agent(Explore)', { tool: 'Agent', input: { subagent_type: 'Explore' } }, ctx, 'deny').kind).toBe('match');
    expect(matchRule('Agent(Explore)', { tool: 'Agent', input: { subagent_type: 'Plan' } }, ctx, 'deny').kind).toBe('no-match');
  });

  it('a specifier with no evaluable input is unevaluated (never a silent skip)', () => {
    expect(matchRule('Read(./.env)', { tool: 'Read' }, ctx, 'deny').kind).toBe('unevaluated');
    expect(matchRule('Bash(rm *)', { tool: 'Bash' }, ctx, 'deny').kind).toBe('unevaluated');
  });

  it('mcp exact tool rules', () => {
    expect(matchRule('mcp__puppeteer__puppeteer_navigate', { tool: 'mcp__puppeteer__puppeteer_navigate' }, ctx, 'allow').kind).toBe('match');
  });
});
