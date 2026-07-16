import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fsListRequest, type FsListResponse } from '../src/api/client.js';
import { crumbsOf, FolderPickerModal } from '../src/components/FolderPickerModal.js';

vi.mock('../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/client.js')>();
  return { ...actual, fsListRequest: vi.fn() };
});

const mockFsList = vi.mocked(fsListRequest);

const rootsView: FsListResponse = {
  path: null,
  parent: null,
  entries: [
    { name: 'C:\\', path: 'C:\\', isGitRepo: false },
    { name: 'D:\\', path: 'D:\\', isGitRepo: false },
  ],
};

const reposDir: FsListResponse = {
  path: 'C:\\repos',
  parent: 'C:\\',
  entries: [
    { name: 'alpha', path: 'C:\\repos\\alpha', isGitRepo: true },
    { name: 'scratch', path: 'C:\\repos\\scratch', isGitRepo: false },
  ],
};

let onSelect: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;

function renderPicker(initialPath?: string): void {
  onSelect = vi.fn();
  onClose = vi.fn();
  render(<FolderPickerModal initialPath={initialPath} onSelect={onSelect} onClose={onClose} />);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('crumbsOf', () => {
  it('windows paths: drive root keeps its trailing separator, every ancestor addressable', () => {
    expect(crumbsOf('C:\\repos\\alpha')).toEqual([
      { label: 'C:\\', path: 'C:\\' },
      { label: 'repos', path: 'C:\\repos' },
      { label: 'alpha', path: 'C:\\repos\\alpha' },
    ]);
    expect(crumbsOf('C:\\')).toEqual([{ label: 'C:\\', path: 'C:\\' }]);
  });

  it('unix paths: a leading / root crumb, accumulated ancestors', () => {
    expect(crumbsOf('/home/ondrej')).toEqual([
      { label: '/', path: '/' },
      { label: 'home', path: '/home' },
      { label: 'ondrej', path: '/home/ondrej' },
    ]);
  });
});

describe('FolderPickerModal', () => {
  it('opens on the roots view (no path param) and lists drives; select is disabled until a pick', async () => {
    mockFsList.mockResolvedValue(rootsView);
    renderPicker();

    expect(await screen.findByRole('button', { name: 'C:\\' })).toBeInTheDocument();
    expect(mockFsList).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(screen.getByRole('button', { name: 'select' })).toBeDisabled();

    // Highlighting a drive makes it selectable.
    fireEvent.click(screen.getByRole('button', { name: 'D:\\' }));
    fireEvent.click(screen.getByRole('button', { name: 'select' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('D:\\');
  });

  it('double-click descends into a directory; isGitRepo entries carry the git badge', async () => {
    mockFsList.mockResolvedValueOnce(rootsView).mockResolvedValueOnce(reposDir);
    renderPicker();

    fireEvent.doubleClick(await screen.findByRole('button', { name: 'C:\\' }));

    expect(await screen.findByRole('button', { name: 'alpha' })).toBeInTheDocument();
    expect(mockFsList).toHaveBeenLastCalledWith('C:\\');
    const alphaRow = screen.getByRole('button', { name: 'alpha' });
    expect(alphaRow).toHaveTextContent('git');
    expect(screen.getByRole('button', { name: 'scratch' })).not.toHaveTextContent('git');
  });

  it('with no highlighted entry, select returns the directory being browsed', async () => {
    mockFsList.mockResolvedValue(reposDir);
    renderPicker('C:\\repos');

    await screen.findByRole('button', { name: 'alpha' });
    fireEvent.click(screen.getByRole('button', { name: 'select' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('C:\\repos');
  });

  it('breadcrumb ancestors are clickable and refetch; "computer" returns to the roots view', async () => {
    mockFsList.mockResolvedValue(reposDir);
    renderPicker('C:\\repos\\alpha');

    // Crumbs derive from the requested path: C:\ › repos › alpha behind the computer crumb.
    const nav = await screen.findByRole('navigation', { name: 'Folder path' });
    expect(nav).toHaveTextContent('computer');
    expect(nav).toHaveTextContent('repos');

    mockFsList.mockResolvedValue(rootsView);
    fireEvent.click(screen.getByRole('button', { name: 'computer' }));
    await waitFor(() => expect(mockFsList).toHaveBeenLastCalledWith(undefined));
  });

  it('an unreadable path surfaces the daemon error as role=alert, crumbs still navigable', async () => {
    mockFsList.mockRejectedValueOnce(new Error('path not readable: C:\\gone')).mockResolvedValueOnce(rootsView);
    renderPicker('C:\\gone');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('path not readable: C:\\gone');
    expect(screen.getByRole('button', { name: 'select' })).toBeDisabled();

    // The error state never strands the human: climb out via the computer crumb.
    fireEvent.click(screen.getByRole('button', { name: 'computer' }));
    expect(await screen.findByRole('button', { name: 'C:\\' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('closes on Escape and the ✕ button; a shown loading state while the list is in flight', async () => {
    let resolveList: (value: FsListResponse) => void = () => undefined;
    mockFsList.mockImplementation(() => new Promise((resolve) => (resolveList = resolve)));
    renderPicker();

    expect(screen.getByText('listing…')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close folder picker' }));
    expect(onClose).toHaveBeenCalledTimes(2);

    resolveList(rootsView);
    await waitFor(() => expect(screen.queryByText('listing…')).not.toBeInTheDocument());
  });
});
