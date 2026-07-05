import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listRepos, registerRepo, registryPath } from '../../src/daemon/registry.js';

// All tests use a disposable temp directory as a stand-in "HOME" -- never touches the real user's
// ~/.chartroom/repos.json (plan §8.1).
let fakeHome: string;
let repoAPath: string;
let repoBPath: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'chartroom-registry-test-home-'));
  repoAPath = mkdtempSync(join(tmpdir(), 'chartroom-registry-test-repo-a-'));
  repoBPath = mkdtempSync(join(tmpdir(), 'chartroom-registry-test-repo-b-'));
});

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(repoAPath, { recursive: true, force: true });
  rmSync(repoBPath, { recursive: true, force: true });
});

describe('registry', () => {
  it('registry file is created (with its parent dir) if ~/.chartroom does not exist yet', () => {
    expect(listRepos(fakeHome)).toEqual([]);
    registerRepo(repoAPath, fakeHome);
    const path = registryPath(fakeHome);
    expect(existsSync(path)).toBe(true);
  });

  it('register once produces exactly one entry', () => {
    const entry = registerRepo(repoAPath, fakeHome);
    const repos = listRepos(fakeHome);
    expect(repos).toHaveLength(1);
    expect(repos[0]).toEqual(entry);
    expect(repos[0].absPath).toBe(repoAPath);
  });

  it('registering the same absolute path twice is idempotent (still one entry)', () => {
    registerRepo(repoAPath, fakeHome);
    registerRepo(repoAPath, fakeHome);
    expect(listRepos(fakeHome)).toHaveLength(1);
  });

  it('registering two different paths gets two distinct entries', () => {
    registerRepo(repoAPath, fakeHome);
    registerRepo(repoBPath, fakeHome);
    const repos = listRepos(fakeHome);
    expect(repos).toHaveLength(2);
    expect(new Set(repos.map((r) => r.absPath))).toEqual(new Set([repoAPath, repoBPath]));
  });

  it('two paths sharing a basename get distinct ids via collision suffixing', () => {
    const nestedA = join(repoAPath, 'same-name');
    const nestedB = join(repoBPath, 'same-name');
    mkdirSync(nestedA, { recursive: true });
    mkdirSync(nestedB, { recursive: true });

    const entryA = registerRepo(nestedA, fakeHome);
    const entryB = registerRepo(nestedB, fakeHome);

    expect(entryA.id).toBe('same-name');
    expect(entryB.id).toBe('same-name-2');
    expect(entryA.id).not.toBe(entryB.id);
  });
});
