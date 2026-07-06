import { describe, expect, it } from 'vitest';
import {
  approxCount,
  capList,
  numberWord,
  renderFleetStatus,
  renderLedgerStatus,
  renderReadBack,
  renderSessionStatus,
  renderWhatsNew,
  sentenceClip,
  sessionActivity,
  speakableSessionName,
  stripForSpeech,
} from '../src/speech.js';
import type { FleetSession } from '../src/fleet.js';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}/i;

const fleet: FleetSession[] = [
  { sessionId: '984deabe-afba-4411-a079-a16be751eac1', name: 'auth token refactor', cwd: 'C:\\repos\\auth-service', status: 'busy' },
  { sessionId: 'd754cb3d-e33c-493f-bd18-495bced4f7c7', name: 'team tasks rls bug', cwd: 'C:\\repos\\team-tasks', state: 'blocked' },
  { sessionId: '4226671f-ca22-4753-9ffe-e786ab86b7f5', name: 'changelog polish', cwd: 'C:\\repos\\shareWork', state: 'done', status: 'idle' },
  { sessionId: 'aaaa671f-ca22-4753-9ffe-e786ab86b7f5', cwd: '/home/o/harbor', status: 'idle' },
];

describe('numbers for ears (§4 rounded)', () => {
  it('speaks small counts as words', () => {
    expect(numberWord(0)).toBe('no');
    expect(numberWord(1)).toBe('one');
    expect(numberWord(3)).toBe('three');
    expect(numberWord(12)).toBe('twelve');
    expect(numberWord(13)).toBe('13');
  });

  it('rounds large counts', () => {
    expect(approxCount(2)).toBe('two');
    expect(approxCount(17)).toBe('17');
    expect(approxCount(47)).toBe('about 50');
    expect(approxCount(50)).toBe('50');
    expect(approxCount(237)).toBe('about 250');
  });
});

describe('capList (§4 lists capped at 3)', () => {
  it('passes short lists through', () => {
    expect(capList([1, 2, 3])).toEqual({ shown: [1, 2, 3], more: 0 });
  });
  it('caps and counts the rest', () => {
    expect(capList([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2, 3], more: 2 });
  });
});

describe('text shaping', () => {
  it('stripForSpeech removes markdown decorations but keeps command names', () => {
    const md = '# Digest\n\n- **auth**: ran `npm test`, see [notes](http://x)\n\n```\nsecret code\n```';
    const spoken = stripForSpeech(md);
    expect(spoken).toContain('auth');
    expect(spoken).toContain('npm test');
    expect(spoken).toContain('notes');
    expect(spoken).not.toContain('#');
    expect(spoken).not.toContain('**');
    expect(spoken).not.toContain('```');
    expect(spoken).not.toContain('secret code'); // fenced blocks never speak
    expect(spoken).not.toContain('http://');
  });

  it('sentenceClip cuts at a sentence boundary', () => {
    const text = `${'First sentence here. '.repeat(20)}`;
    const clipped = sentenceClip(text, 100);
    expect(clipped.length).toBeLessThanOrEqual(100);
    expect(clipped.endsWith('.')).toBe(true);
  });

  it('sentenceClip leaves short text alone', () => {
    expect(sentenceClip('Short.', 100)).toBe('Short.');
  });
});

describe('speakable names (§4 names not ids)', () => {
  it('prefers the session name', () => {
    expect(speakableSessionName(fleet[0])).toBe('auth token refactor');
  });
  it('falls back to the repo folder', () => {
    expect(speakableSessionName(fleet[3])).toBe('the harbor session');
  });
  it('never a uuid', () => {
    for (const s of fleet) {
      expect(speakableSessionName(s)).not.toMatch(UUID_RE);
    }
  });
  it('activity from verified agents --json fields', () => {
    expect(sessionActivity(fleet[0])).toBe('is working');
    expect(sessionActivity(fleet[1])).toBe('is blocked waiting on an approval');
    expect(sessionActivity(fleet[2])).toBe('has finished');
    expect(sessionActivity(fleet[3])).toBe('is idle');
    expect(sessionActivity({})).toBe('is running');
  });
});

describe('renderFleetStatus (the §9.1 acceptance renderer)', () => {
  it('reads as a natural paragraph: counts as words, names not ids, no JSON', () => {
    const spoken = renderFleetStatus({
      sessions: fleet,
      pending: { permissionsPending: 1, questionsOpen: 0 },
      todayLine: 'auth finished tests and opened a PR',
    });
    expect(spoken).toContain('Three sessions are running.');
    expect(spoken).toContain('Auth token refactor is working.');
    expect(spoken).toContain('is blocked waiting on an approval');
    expect(spoken).toContain('One session has finished.');
    expect(spoken).toContain('One permission request is waiting for you.');
    expect(spoken).toContain('Earlier today: auth finished tests and opened a PR.');
    expect(spoken).not.toMatch(UUID_RE);
    expect(spoken).not.toMatch(/[{}[\]"]/);
  });

  it('caps the session list at 3', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      sessionId: `s-${i}`,
      name: `session number ${i}`,
      status: 'busy',
    }));
    const spoken = renderFleetStatus({ sessions: many });
    expect(spoken).toContain('And three more.');
    expect(spoken).not.toContain('session number 4');
  });

  it('handles the empty fleet and the unreachable fleet', () => {
    expect(renderFleetStatus({ sessions: [] })).toContain('No sessions are running');
    expect(renderFleetStatus({ sessions: null })).toContain('can’t see the fleet');
  });

  it('says when nothing is waiting', () => {
    const spoken = renderFleetStatus({
      sessions: [fleet[0]],
      pending: { permissionsPending: 0, questionsOpen: 0 },
    });
    expect(spoken).toContain('Nothing is waiting on you.');
  });
});

describe('renderSessionStatus (§3 minimization: counts, never paths)', () => {
  it('speaks name, activity, summary clip and a file count', () => {
    const spoken = renderSessionStatus({
      session: fleet[0],
      latestSummary: 'Refactored token refresh; all tests green.',
      filesTouched: 47,
    });
    expect(spoken).toContain('Auth token refactor is working.');
    expect(spoken).toContain('Last log: Refactored token refresh; all tests green.');
    expect(spoken).toContain('About 50 files touched.');
    expect(spoken).not.toMatch(UUID_RE);
  });
});

describe('renderWhatsNew', () => {
  it('prefers the rollup digest line', () => {
    expect(renderWhatsNew('two projects moved forward', [])).toBe(
      'Since this morning: two projects moved forward.',
    );
  });
  it('falls back to capped per-project lines', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      project: `proj-${i}`,
      summary: `did thing ${i}.`,
    }));
    const spoken = renderWhatsNew(undefined, entries);
    expect(spoken).toContain('Five sessions logged today.');
    expect(spoken).toContain('Proj-0: did thing 0.');
    expect(spoken).toContain('And two more sessions.');
    expect(spoken).not.toContain('proj-4');
  });
  it('says so when the log is empty', () => {
    expect(renderWhatsNew(undefined, [])).toBe('Nothing new in the log today yet.');
  });
});

describe('renderLedgerStatus', () => {
  it('caps items at 3 and speaks statuses', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      title: `Task ${i}`,
      status: 'todo',
      project: i === 0 ? 'harbor' : null,
    }));
    const spoken = renderLedgerStatus(items);
    expect(spoken).toContain('Five ledger items.');
    expect(spoken).toContain('Task 0 on harbor — todo.');
    expect(spoken).toContain('And two more items.');
  });
  it('handles empty and query scopes', () => {
    expect(renderLedgerStatus([], 'auth')).toContain('matching “auth”');
    expect(renderLedgerStatus([])).toContain('nothing open');
  });
});

describe('renderReadBack (§6)', () => {
  it('reads the command back as metadata', () => {
    const spoken = renderReadBack('session three', '`npm publish`', { destructive: true, verb: 'publish' });
    expect(spoken).toContain('Session three wants to run `npm publish` — approve?');
    expect(spoken).toContain('Say “confirm publish” to approve.');
  });
  it('plain read-back for non-destructive commands', () => {
    const spoken = renderReadBack('the harbor session', '`git status`', { destructive: false });
    expect(spoken).toBe('The harbor session wants to run `git status` — approve?');
  });
});
