// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SeaChestClient } from '../src/client.js';
import type { LockerItem, LockerItemSummary } from '../src/types.js';
import { SeaChestPage } from '../src/ui/SeaChestPage.js';

afterEach(cleanup);

const SUMMARY: LockerItemSummary = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  userId: 'u1',
  teamId: null,
  kind: 'skill',
  name: 'my-skill',
  description: 'a skill',
  version: 2,
  published: false,
  createdAt: '2026-07-06T10:00:00.000Z',
  updatedAt: '2026-07-06T11:00:00.000Z',
};

const ITEM: LockerItem = { ...SUMMARY, content: { files: { 'SKILL.md': '# hi' } } };

function mockClient(overrides: Partial<SeaChestClient> = {}): SeaChestClient {
  return {
    listItems: vi.fn(async () => [SUMMARY]),
    getItem: vi.fn(async () => ITEM),
    updateItemMeta: vi.fn(async (_n, patch) => ({ ...ITEM, ...patch })),
    listVersions: vi.fn(async () => [
      { itemId: ITEM.id, version: 2, createdAt: ITEM.updatedAt },
      { itemId: ITEM.id, version: 1, createdAt: ITEM.createdAt },
    ]),
    getVersion: vi.fn(),
    installSnippet: vi.fn(async () => ({ snippet: 'claude plugin marketplace add "..."' })),
    listProfiles: vi.fn(async () => []),
    saveProfile: vi.fn(async (name, itemNames) => ({
      id: 'p1',
      userId: 'u1',
      name,
      itemNames,
      createdAt: ITEM.createdAt,
      updatedAt: ITEM.createdAt,
    })),
    listTokens: vi.fn(async () => []),
    createToken: vi.fn(async (label) => ({
      token: 'sc_plaintext-once',
      info: { id: 't1', userId: 'u1', label, createdAt: ITEM.createdAt, revokedAt: null },
    })),
    revokeToken: vi.fn(async () => undefined),
    setupManifest: vi.fn(),
    ...overrides,
  } as SeaChestClient;
}

describe('SeaChestPage', () => {
  it('lists locker items and drills into detail with version history', async () => {
    const client = mockClient();
    render(<SeaChestPage client={client} />);
    const itemButton = await screen.findByRole('button', { name: /my-skill — skill v2/ });
    fireEvent.click(itemButton);

    await screen.findByRole('heading', { name: /my-skill/ });
    await waitFor(() => {
      expect(screen.getByText(/v2 —/)).toBeTruthy();
      expect(screen.getByText(/v1 —/)).toBeTruthy();
    });
    expect(client.listVersions).toHaveBeenCalledWith('my-skill');
  });

  it('publish toggle calls updateItemMeta with published=true', async () => {
    const client = mockClient();
    render(<SeaChestPage client={client} />);
    fireEvent.click(await screen.findByRole('button', { name: /my-skill/ }));
    const checkbox = await screen.findByRole('checkbox', { name: /Published/ });
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(client.updateItemMeta).toHaveBeenCalledWith('my-skill', { published: true }),
    );
  });

  it('shows the install snippet on demand', async () => {
    const client = mockClient();
    render(<SeaChestPage client={client} />);
    fireEvent.click(await screen.findByRole('button', { name: /my-skill/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Show install snippet/ }));
    const snippet = await screen.findByTestId('install-snippet');
    expect(snippet.textContent).toContain('claude plugin marketplace add');
  });

  it('kind filter re-queries the client', async () => {
    const client = mockClient();
    render(<SeaChestPage client={client} />);
    await screen.findByRole('button', { name: /my-skill/ });
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'agent' } });
    await waitFor(() => expect(client.listItems).toHaveBeenLastCalledWith('agent'));
  });

  it('mints a token and shows the plaintext exactly once-style banner', async () => {
    const client = mockClient();
    render(<SeaChestPage client={client} />);
    await screen.findByRole('button', { name: /my-skill/ });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'laptop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mint token' }));
    const minted = await screen.findByTestId('minted-token');
    expect(minted.textContent).toContain('sc_plaintext-once');
    expect(client.createToken).toHaveBeenCalledWith('laptop');
  });

  it('saves a machine profile with selected items', async () => {
    const client = mockClient();
    render(<SeaChestPage client={client} />);
    await screen.findByRole('button', { name: /my-skill/ });
    fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'laptop-default' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /my-skill \(skill\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() =>
      expect(client.saveProfile).toHaveBeenCalledWith('laptop-default', ['my-skill']),
    );
  });

  it('surfaces API errors via role=alert', async () => {
    const client = mockClient({
      listItems: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    render(<SeaChestPage client={client} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('boom');
  });
});
