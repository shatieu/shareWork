import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App.js';
import {
  fetchAlwaysAllowed,
  fetchDoc,
  fetchDocs,
  fetchHullStations,
  fetchInbox,
  fetchRepos,
  fetchSettingsBackups,
  fetchSettingsEffective,
  fetchSettingsFile,
  fetchSettingsScopes,
  fetchSettingsTemplates,
  fetchVoyage,
  type SettingsEffectiveResponse,
  type SettingsScopesResponse,
} from '../../src/api/client.js';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    fetchRepos: vi.fn(),
    fetchDocs: vi.fn(),
    fetchDoc: vi.fn(),
    fetchInbox: vi.fn(),
    fetchHullStations: vi.fn(),
    fetchVoyage: vi.fn(),
    fetchSettingsScopes: vi.fn(),
    fetchSettingsEffective: vi.fn(),
    fetchSettingsFile: vi.fn(),
    fetchSettingsTemplates: vi.fn(),
    fetchAlwaysAllowed: vi.fn(),
    fetchSettingsBackups: vi.fn(),
  };
});

const mocks = {
  fetchRepos: vi.mocked(fetchRepos),
  fetchDocs: vi.mocked(fetchDocs),
  fetchDoc: vi.mocked(fetchDoc),
  fetchInbox: vi.mocked(fetchInbox),
  fetchHullStations: vi.mocked(fetchHullStations),
  fetchVoyage: vi.mocked(fetchVoyage),
  fetchSettingsScopes: vi.mocked(fetchSettingsScopes),
  fetchSettingsEffective: vi.mocked(fetchSettingsEffective),
  fetchSettingsFile: vi.mocked(fetchSettingsFile),
  fetchSettingsTemplates: vi.mocked(fetchSettingsTemplates),
  fetchAlwaysAllowed: vi.mocked(fetchAlwaysAllowed),
  fetchSettingsBackups: vi.mocked(fetchSettingsBackups),
};

const USER_FILE = 'C:/home/o/.claude/settings.json';

const SCOPES: SettingsScopesResponse = {
  scopes: [{ scope: 'user', path: USER_FILE, exists: true, writable: true }],
  projects: [],
  schemaSource: 'structural v1 (docs 2026-07-06)',
};

const EFFECTIVE: SettingsEffectiveResponse = {
  values: {},
  permissions: { allow: [], deny: [], ask: [], additionalDirectories: [] },
  excluded: [],
};

beforeEach(() => {
  window.location.hash = '';
  window.localStorage.clear();
  vi.clearAllMocks();
  mocks.fetchRepos.mockResolvedValue([
    { id: 'repo-a', name: 'alpha', absPath: 'C:/repos/alpha', docCount: 0, brokenLinkCount: 0, needsYouCount: 0 },
  ]);
  mocks.fetchDocs.mockResolvedValue([]);
  mocks.fetchDoc.mockRejectedValue(new Error('not under test'));
  mocks.fetchInbox.mockResolvedValue([]);
  mocks.fetchVoyage.mockRejectedValue(new Error('404'));
  mocks.fetchHullStations.mockResolvedValue([
    { name: 'chartroom', tab: { id: 'docs', title: 'Docs' } },
    { name: 'settings-manager', tab: { id: 'settings', title: 'Settings' } },
  ]);
  mocks.fetchSettingsScopes.mockResolvedValue(SCOPES);
  mocks.fetchSettingsEffective.mockResolvedValue(EFFECTIVE);
  mocks.fetchSettingsFile.mockResolvedValue({
    scope: 'user',
    path: USER_FILE,
    exists: true,
    content: '{}',
    baseHash: 'hash-1',
    writable: true,
  });
  mocks.fetchSettingsTemplates.mockResolvedValue({ packs: [], warnings: [] });
  mocks.fetchAlwaysAllowed.mockResolvedValue({ available: false, entries: [] });
  mocks.fetchSettingsBackups.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe('Deck shell: Settings tab routing', () => {
  it('shows the hull-provided Settings tab; selecting it routes to #/settings and renders the page', async () => {
    render(<App />);
    const tab = await screen.findByRole('tab', { name: 'Settings' });
    fireEvent.click(tab);
    expect(window.location.hash).toBe('#/settings');
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Permission simulator' })).toBeInTheDocument();
  });

  it('deep link #/settings renders the settings page directly and is not hijacked by repo auto-select', async () => {
    window.location.hash = '#/settings';
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    // repos load must NOT rewrite the deep link to #/repo/...
    expect(await screen.findByText('1 watched')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/settings');
  });

  it('without a settings station the tab is absent (standalone hull)', async () => {
    mocks.fetchHullStations.mockResolvedValue([{ name: 'chartroom', tab: { id: 'docs', title: 'Docs' } }]);
    render(<App />);
    expect(await screen.findByText('1 watched')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Settings' })).not.toBeInTheDocument();
  });
});
