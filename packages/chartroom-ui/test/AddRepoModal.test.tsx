import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerRepoRequest, type RegisterRepoResult } from '../src/api/client.js';
import { AddRepoModal } from '../src/components/AddRepoModal.js';

vi.mock('../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/client.js')>();
  return { ...actual, registerRepoRequest: vi.fn() };
});

const mockRegister = vi.mocked(registerRepoRequest);

const registeredAlpha: RegisterRepoResult = {
  id: 'alpha',
  name: 'alpha',
  absPath: 'C:/repos/alpha',
  alreadyRegistered: false,
};

let onClose: ReturnType<typeof vi.fn>;
let onRegistered: ReturnType<typeof vi.fn>;

function renderModal(): void {
  onClose = vi.fn();
  onRegistered = vi.fn();
  render(<AddRepoModal onClose={onClose} onRegistered={onRegistered} />);
}

function pathInput(): HTMLElement {
  return screen.getByLabelText(/absolute path of a local git repo/i);
}

function submitButton(): HTMLElement {
  return screen.getByRole('button', { name: 'add repo' });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('AddRepoModal', () => {
  it('submits the trimmed path and shows the success pane; onRegistered fires with the result', async () => {
    mockRegister.mockResolvedValue(registeredAlpha);
    renderModal();

    fireEvent.change(pathInput(), { target: { value: '  C:/repos/alpha  ' } });
    fireEvent.click(submitButton());

    expect(await screen.findByText('✓ Registered')).toBeInTheDocument();
    expect(mockRegister).toHaveBeenCalledExactlyOnceWith('C:/repos/alpha');
    expect(onRegistered).toHaveBeenCalledExactlyOnceWith(registeredAlpha);
    expect(screen.getByText('is being indexed and watched now.', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('C:/repos/alpha')).toBeInTheDocument();
  });

  it('an already-registered repo is reported as such, not as a fresh registration', async () => {
    mockRegister.mockResolvedValue({ ...registeredAlpha, alreadyRegistered: true });
    renderModal();

    fireEvent.change(pathInput(), { target: { value: 'C:/repos/alpha/nested/dir' } });
    fireEvent.submit(pathInput().closest('form') as HTMLFormElement);

    expect(await screen.findByText('✓ Already registered')).toBeInTheDocument();
    expect(onRegistered).toHaveBeenCalledExactlyOnceWith({ ...registeredAlpha, alreadyRegistered: true });
  });

  it("surfaces the daemon's readable error as role=alert and stays recoverable", async () => {
    mockRegister
      .mockRejectedValueOnce(new Error('no git repository found at or above C:/tmp/not-a-repo'))
      .mockResolvedValueOnce(registeredAlpha);
    renderModal();

    fireEvent.change(pathInput(), { target: { value: 'C:/tmp/not-a-repo' } });
    fireEvent.click(submitButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('no git repository found at or above C:/tmp/not-a-repo');
    expect(onRegistered).not.toHaveBeenCalled();

    // Recoverable: correct the path and submit again -- the error clears, success pane shows.
    fireEvent.change(pathInput(), { target: { value: 'C:/repos/alpha' } });
    fireEvent.click(submitButton());
    expect(await screen.findByText('✓ Registered')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('submit is disabled while the input is blank (whitespace counts as blank)', () => {
    renderModal();
    expect(submitButton()).toBeDisabled();
    fireEvent.change(pathInput(), { target: { value: '   ' } });
    expect(submitButton()).toBeDisabled();
    fireEvent.change(pathInput(), { target: { value: 'C:/repos/alpha' } });
    expect(submitButton()).toBeEnabled();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('shows the in-flight state and blocks double submits', async () => {
    let resolveRegister: (value: RegisterRepoResult) => void = () => undefined;
    mockRegister.mockImplementation(() => new Promise((resolve) => (resolveRegister = resolve)));
    renderModal();

    fireEvent.change(pathInput(), { target: { value: 'C:/repos/alpha' } });
    fireEvent.click(submitButton());

    expect(await screen.findByRole('button', { name: 'registering…' })).toBeDisabled();
    fireEvent.submit(pathInput().closest('form') as HTMLFormElement);
    expect(mockRegister).toHaveBeenCalledTimes(1);

    resolveRegister(registeredAlpha);
    await waitFor(() => expect(screen.getByText('✓ Registered')).toBeInTheDocument());
  });

  it('closes on Escape, the ✕ button, the Done button, and an overlay mousedown', async () => {
    mockRegister.mockResolvedValue(registeredAlpha);
    renderModal();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.mouseDown(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledTimes(3);
    // ...but a mousedown INSIDE the dialog does not close.
    fireEvent.mouseDown(screen.getByRole('dialog', { name: 'Add a repo' }));
    expect(onClose).toHaveBeenCalledTimes(3);

    fireEvent.change(pathInput(), { target: { value: 'C:/repos/alpha' } });
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('"add another…" resets to a blank input form', async () => {
    mockRegister.mockResolvedValue(registeredAlpha);
    renderModal();

    fireEvent.change(pathInput(), { target: { value: 'C:/repos/alpha' } });
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: 'add another…' }));

    expect(pathInput()).toHaveValue('');
    expect(submitButton()).toBeDisabled();
    expect(screen.queryByText('✓ Registered')).not.toBeInTheDocument();
  });
});
