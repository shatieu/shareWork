import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoyagePage, missionProgress, sectionOf } from '../../src/voyage/VoyagePage.js';
import {
  addVoyageItem,
  fetchVoyage,
  fetchVoyageProject,
  fetchVoyageProjects,
  type VoyageItem,
  type VoyageProject,
  type VoyageResponse,
} from '../../src/api/client.js';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    fetchVoyage: vi.fn(),
    fetchVoyageProjects: vi.fn(),
    fetchVoyageProject: vi.fn(),
    addVoyageItem: vi.fn(),
  };
});

const mockFetchVoyage = vi.mocked(fetchVoyage);
const mockFetchVoyageProjects = vi.mocked(fetchVoyageProjects);
const mockFetchVoyageProject = vi.mocked(fetchVoyageProject);
const mockAddVoyageItem = vi.mocked(addVoyageItem);

const DEFAULT_PROJECT: VoyageProject = {
  id: 'default',
  name: 'default',
  file: 'suite-design/overnight/progress.json',
  isDefault: true,
};

function item(overrides: Partial<VoyageItem> & Pick<VoyageItem, 'id' | 'title'>): VoyageItem {
  return {
    status: 'implementing',
    stage_progress: 0,
    difficulty: null,
    remaining_guess_h: null,
    ...overrides,
  };
}

/** weighted overall: S(1)*100 + XL(5)*60 + null→M(2)*0 = 400 / 8 = 50% */
const fixture: VoyageResponse = {
  file: 'suite-design/overnight/progress.json',
  updatedAt: '2026-07-05T20:52:55.732Z',
  packages: [
    item({ id: 0, title: 'Charter the crew', status: 'PASS+merged', stage_progress: 100, difficulty: 'S', remaining_guess_h: 0 }),
    item({ id: 3, title: 'Captains Deck', status: 'implementing', stage_progress: 60, difficulty: 'XL', remaining_guess_h: 10, note: 'deck in flight' }),
    item({ id: 5, title: 'Bridge phase 2', status: 'pending', stage_progress: 0, remaining_guess_h: 3 }),
  ],
};

beforeEach(() => {
  vi.useFakeTimers();
  mockFetchVoyage.mockReset();
  mockFetchVoyageProjects.mockReset();
  mockFetchVoyageProject.mockReset();
  mockAddVoyageItem.mockReset();
  // Single-project baseline: the switcher stays hidden and every pre-wave2-D test is unchanged.
  mockFetchVoyageProjects.mockResolvedValue([DEFAULT_PROJECT]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('sectionOf (deterministic status mapping)', () => {
  it('maps real progress.json statuses', () => {
    expect(sectionOf({ status: 'PASS+merged', stage_progress: 100 })).toBe('done');
    expect(sectionOf({ status: 'done', stage_progress: 80 })).toBe('done');
    expect(sectionOf({ status: 'PASS', stage_progress: 100 })).toBe('done');
    expect(sectionOf({ status: 'PASS', stage_progress: 90 })).toBe('inflight');
    expect(sectionOf({ status: 'parked (v1.2)', stage_progress: 40 })).toBe('parked');
    expect(sectionOf({ status: 'pending', stage_progress: 0 })).toBe('pending');
    expect(sectionOf({ status: 'implementing', stage_progress: 60 })).toBe('inflight');
    expect(sectionOf({ status: 'plan approved', stage_progress: 25 })).toBe('inflight');
  });
});

describe('missionProgress (difficulty-weighted overall)', () => {
  it('weights S=1 M=2 L=3 XL=5 and treats null as M', () => {
    expect(missionProgress(fixture.packages)).toBe(50);
    expect(missionProgress([])).toBe(0);
    expect(missionProgress([{ difficulty: 'M', stage_progress: 100 }])).toBe(100);
  });
});

describe('VoyagePage (jsdom has no EventSource, so this exercises the poll path)', () => {
  it('renders the four stage sections with items grouped by status', async () => {
    mockFetchVoyage.mockResolvedValue(fixture);
    render(<VoyagePage />);
    await flush();

    const inflight = screen.getByRole('region', { name: 'In flight' });
    expect(within(inflight).getByText('Captains Deck')).toBeInTheDocument();
    expect(within(inflight).getByText('~10h left')).toBeInTheDocument();
    expect(within(inflight).getByText('deck in flight')).toBeInTheDocument();
    expect(within(inflight).getByText('[XL]')).toBeInTheDocument();

    const done = screen.getByRole('region', { name: 'Done' });
    expect(within(done).getByText('Charter the crew')).toBeInTheDocument();
    expect(within(done).getByText('[S]')).toBeInTheDocument();

    const pending = screen.getByRole('region', { name: 'Pending' });
    expect(within(pending).getByText('Bridge phase 2')).toBeInTheDocument();
    // unsized difficulty renders as [?]
    expect(within(pending).getByText('[?]')).toBeInTheDocument();

    const parked = screen.getByRole('region', { name: 'Parked' });
    expect(within(parked).getByText('none')).toBeInTheDocument();
  });

  it('renders per-item bar widths and the difficulty-weighted overall bar', async () => {
    mockFetchVoyage.mockResolvedValue(fixture);
    render(<VoyagePage />);
    await flush();

    expect(screen.getByText('50%')).toBeInTheDocument();
    const overall = screen.getByRole('progressbar', { name: 'Overall mission progress' });
    expect(overall).toHaveAttribute('aria-valuenow', '50');
    expect(overall.querySelector('.progress__fill')).toHaveStyle({ width: '50%' });

    const deckBar = screen.getByRole('progressbar', { name: 'Captains Deck progress' });
    expect(deckBar).toHaveAttribute('aria-valuenow', '60');
    expect(deckBar.querySelector('.progress__fill')).toHaveStyle({ width: '60%' });
  });

  it('polls every 5s and applies fresh data (feature-detected fallback path)', async () => {
    mockFetchVoyage.mockResolvedValue(fixture);
    render(<VoyagePage />);
    await flush();
    expect(mockFetchVoyage).toHaveBeenCalledTimes(1);

    mockFetchVoyage.mockResolvedValue({
      ...fixture,
      stale: true,
      packages: [item({ id: 99, title: 'Fresh package', status: 'implementing', stage_progress: 10 })],
    });
    await flush(5_000);
    expect(mockFetchVoyage).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Fresh package')).toBeInTheDocument();
    expect(screen.getByText('stale')).toBeInTheDocument();
    expect(screen.queryByText('Captains Deck')).not.toBeInTheDocument();
  });

  it('shows a readable error state when the first fetch fails, then recovers on a later poll', async () => {
    mockFetchVoyage.mockRejectedValueOnce(new Error('voyage 404'));
    mockFetchVoyage.mockResolvedValue(fixture);
    render(<VoyagePage />);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Voyage data unavailable');

    await flush(5_000);
    expect(screen.getByText('Captains Deck')).toBeInTheDocument();
  });
});

describe('project switcher (wave2-D multi-project)', () => {
  const REPO_PROJECT: VoyageProject = { id: 'repoa', name: 'repo-a', file: '/repos/repo-a/.ship/voyage/progress.json', isDefault: false };
  const repoFixture: VoyageResponse = {
    file: REPO_PROJECT.file,
    updatedAt: '2026-07-17T12:00:00.000Z',
    packages: [item({ id: 1, title: 'Repo-A thing', status: 'implementing', stage_progress: 30 })],
  };

  it('stays hidden with a single project and when /projects is unavailable (older hull)', async () => {
    mockFetchVoyage.mockResolvedValue(fixture);
    render(<VoyagePage />);
    await flush();
    expect(screen.queryByRole('group', { name: 'Voyage projects' })).not.toBeInTheDocument();
    cleanup();

    mockFetchVoyageProjects.mockRejectedValue(new Error('404'));
    render(<VoyagePage />);
    await flush();
    expect(screen.getByText('Captains Deck')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Voyage projects' })).not.toBeInTheDocument();
  });

  it('renders chips from /projects and switches fetch to the selected project', async () => {
    mockFetchVoyage.mockResolvedValue(fixture);
    mockFetchVoyageProjects.mockResolvedValue([DEFAULT_PROJECT, REPO_PROJECT]);
    mockFetchVoyageProject.mockResolvedValue(repoFixture);
    render(<VoyagePage />);
    await flush();

    const switcher = screen.getByRole('group', { name: 'Voyage projects' });
    const repoChip = within(switcher).getByRole('button', { name: 'repo-a' });
    expect(within(switcher).getByRole('button', { name: 'default' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(repoChip);
    await flush();

    expect(mockFetchVoyageProject).toHaveBeenCalledWith('repoa');
    expect(repoChip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Repo-A thing')).toBeInTheDocument();
    expect(screen.queryByText('Captains Deck')).not.toBeInTheDocument();
  });
});

describe('add item (wave2-D)', () => {
  it('posts the form to the selected project and refetches immediately on success', async () => {
    mockFetchVoyage.mockResolvedValue(fixture);
    mockAddVoyageItem.mockResolvedValue({
      id: 6, title: 'Fresh idea', status: 'pending', stage_progress: 0,
      difficulty: 'L', remaining_guess_h: null, updated_at: '2026-07-17T12:00:00.000Z',
    });
    render(<VoyagePage />);
    await flush();
    expect(mockFetchVoyage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '+ Add item' }));
    fireEvent.change(screen.getByLabelText('Item title'), { target: { value: 'Fresh idea' } });
    fireEvent.change(screen.getByLabelText('Difficulty'), { target: { value: 'L' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'from the deck' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await flush();

    expect(mockAddVoyageItem).toHaveBeenCalledWith('default', { title: 'Fresh idea', difficulty: 'L', note: 'from the deck' });
    // Optimistic refresh: an immediate refetch, not a 5 s poll wait.
    expect(mockFetchVoyage).toHaveBeenCalledTimes(2);
    // Form collapsed back to the toggle.
    expect(screen.getByRole('button', { name: '+ Add item' })).toBeInTheDocument();
  });

  it('surfaces the server 409 message inline and keeps the form open', async () => {
    mockFetchVoyage.mockResolvedValue(fixture);
    mockAddVoyageItem.mockRejectedValue(new Error('refusing to add item: progress.json currently fails to parse'));
    render(<VoyagePage />);
    await flush();

    fireEvent.click(screen.getByRole('button', { name: '+ Add item' }));
    fireEvent.change(screen.getByLabelText('Item title'), { target: { value: 'Doomed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await flush();

    expect(screen.getByRole('alert')).toHaveTextContent('fails to parse');
    expect(screen.getByLabelText('Item title')).toHaveValue('Doomed');
  });
});
