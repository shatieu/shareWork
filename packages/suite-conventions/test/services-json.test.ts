import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearHullRegistration,
  deleteServicesFile,
  readServices,
  servicesJsonPath,
  writeHullRegistration,
} from '../src/services-json.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'suite-conventions-services-test-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('~/.suite/services.json helpers', () => {
  it('read of a missing file -> empty { version: 1 }', () => {
    expect(readServices(home)).toEqual({ version: 1 });
  });

  it('write -> read round-trip preserves the hull registration', () => {
    writeHullRegistration(
      { port: 4317, pid: 1234, startedAt: '2026-07-05T22:00:00.000Z', stations: ['chartroom'] },
      home,
    );
    expect(readServices(home)).toEqual({
      version: 1,
      hull: { port: 4317, pid: 1234, startedAt: '2026-07-05T22:00:00.000Z', stations: ['chartroom'] },
    });
  });

  it('corrupt JSON degrades to empty, never throws', () => {
    const path = servicesJsonPath(home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{ not json', 'utf8');
    expect(readServices(home)).toEqual({ version: 1 });
  });

  it('wrong-shaped JSON (hull missing port) degrades to empty', () => {
    const path = servicesJsonPath(home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 1, hull: { pid: 1 } }), 'utf8');
    expect(readServices(home)).toEqual({ version: 1 });
  });

  it('overwrite is atomic in effect: the final file is complete valid JSON, no tmp residue read', () => {
    writeHullRegistration({ port: 1, pid: 1, startedAt: '', stations: [] }, home);
    writeHullRegistration({ port: 2, pid: 2, startedAt: '', stations: ['chartroom'] }, home);
    const onDisk = JSON.parse(readFileSync(servicesJsonPath(home), 'utf8'));
    expect(onDisk.hull.port).toBe(2);
    expect(readServices(home).hull?.stations).toEqual(['chartroom']);
  });

  it('clearHullRegistration removes only the hull entry and never throws on a missing file', () => {
    clearHullRegistration(home); // no file yet -- must not throw
    writeHullRegistration({ port: 3, pid: 3, startedAt: 't', stations: ['chartroom'] }, home);
    clearHullRegistration(home);
    expect(readServices(home)).toEqual({ version: 1 });
  });

  it('deleteServicesFile removes the file entirely', () => {
    writeHullRegistration({ port: 4, pid: 4, startedAt: 't', stations: [] }, home);
    deleteServicesFile(home);
    expect(readServices(home)).toEqual({ version: 1 });
  });
});
