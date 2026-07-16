import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  repoSetupApply,
  repoSetupAudit,
  repoSetupRun,
  type RepoSetupAuditResponse,
} from '../../src/api/client.js';
import { useSetupWizard, type SetupWizardRepo } from '../../src/setup/useSetupWizard.js';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return { ...actual, repoSetupAudit: vi.fn(), repoSetupApply: vi.fn(), repoSetupRun: vi.fn() };
});

const mockAudit = vi.mocked(repoSetupAudit);
const mockApply = vi.mocked(repoSetupApply);
const mockRun = vi.mocked(repoSetupRun);

const alpha: SetupWizardRepo = { id: 'alpha', name: 'alpha' };

const auditResponse: RepoSetupAuditResponse = {
  repoId: 'alpha',
  items: [
    { id: 'chartroom-init', label: 'Chart Room init', state: 'missing', kind: 'auto', detail: 'no .docs/index.json' },
    { id: 'chartroom-skill', label: 'chart-room skill', state: 'partial', kind: 'auto', detail: 'skill outdated' },
    { id: 'gitignore-entries', label: '.gitignore entries', state: 'present', kind: 'auto', detail: 'all entries present' },
    {
      id: 'plugin-install',
      label: 'ship-crew plugin',
      state: 'missing',
      kind: 'human',
      detail: 'plugin not installed',
      command: 'claude plugin install ship-crew --scope project',
    },
    {
      id: 'mcp-ship-ledger',
      label: 'ship-ledger MCP',
      state: 'present',
      kind: 'human',
      detail: 'already configured',
      command: 'claude mcp add ship-ledger ...',
    },
  ],
};

/** Host mounting the hook the way App does: wizard opened for `alpha` on mount. */
function Host(): ReturnType<typeof useSetupWizard>['modal'] {
  const { open, modal } = useSetupWizard();
  useEffect(() => {
    open(alpha);
  }, [open]);
  return modal;
}

function renderWizard(): RenderResult {
  return render(<Host />);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('SetupWizard', () => {
  it('phase 1: audits on open, groups Auto/Human, pre-checks missing/partial auto items only', async () => {
    mockAudit.mockResolvedValue(auditResponse);
    renderWizard();

    const dialog = await screen.findByRole('dialog', { name: 'Set up alpha' });
    expect(mockAudit).toHaveBeenCalledExactlyOnceWith('alpha');
    expect(within(dialog).getByRole('heading', { name: 'Auto steps' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Human steps' })).toBeInTheDocument();

    // missing + partial pre-checked; present unchecked.
    expect(screen.getByRole('checkbox', { name: 'Apply Chart Room init' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Apply chart-room skill' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Apply .gitignore entries' })).not.toBeChecked();

    // state chips + detail lines render; human items show their command in a <code> block.
    expect(within(dialog).getAllByText('missing').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('no .docs/index.json')).toBeInTheDocument();
    const command = within(dialog).getByText('claude plugin install ship-crew --scope project');
    expect(command.tagName).toBe('CODE');
    // Human items get no checkbox.
    expect(screen.queryByRole('checkbox', { name: /ship-crew plugin/ })).not.toBeInTheDocument();
  });

  it('phase 2: applies the selected ids; per-item ok/fail rows render, failures never hide the rest', async () => {
    mockAudit.mockResolvedValue(auditResponse);
    mockApply.mockResolvedValue({
      results: [
        { id: 'chartroom-init', ok: true, detail: 'index written' },
        { id: 'chartroom-skill', ok: false, detail: 'EACCES writing skill file' },
      ],
    });
    renderWizard();

    fireEvent.click(await screen.findByRole('button', { name: 'apply 2 selected' }));

    const rows = await screen.findByRole('list', { name: 'Apply results' });
    expect(mockApply).toHaveBeenCalledExactlyOnceWith('alpha', ['chartroom-init', 'chartroom-skill']);
    expect(within(rows).getByText('index written')).toBeInTheDocument();
    expect(within(rows).getByText('ok')).toBeInTheDocument();
    expect(within(rows).getByText('fail')).toBeInTheDocument();
    expect(within(rows).getByText('EACCES writing skill file')).toBeInTheDocument();
  });

  it('a wholesale apply failure surfaces as role=alert with a way back to the checklist', async () => {
    mockAudit.mockResolvedValue(auditResponse);
    mockApply.mockRejectedValue(new Error('setup apply failed with status 500'));
    renderWizard();

    fireEvent.click(await screen.findByRole('button', { name: 'apply 2 selected' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('setup apply failed with status 500');

    fireEvent.click(screen.getByRole('button', { name: '← back to checklist' }));
    expect(await screen.findByRole('heading', { name: 'Auto steps' })).toBeInTheDocument();
  });

  it('phase 3: shows only non-present human steps, copies the command, runs it in a terminal', async () => {
    mockAudit.mockResolvedValue(auditResponse);
    mockApply.mockResolvedValue({ results: [{ id: 'chartroom-init', ok: true, detail: 'done' }] });
    mockRun.mockResolvedValue({ ok: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderWizard();

    fireEvent.click(await screen.findByRole('button', { name: 'apply 2 selected' }));
    fireEvent.click(await screen.findByRole('button', { name: 'continue →' }));

    // Only the missing human item remains; the present one (mcp-ship-ledger) is done.
    expect(await screen.findByText('ship-crew plugin')).toBeInTheDocument();
    expect(screen.queryByText('ship-ledger MCP')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy command for ship-crew plugin' }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith('claude plugin install ship-crew --scope project');

    fireEvent.click(screen.getByRole('button', { name: 'Run ship-crew plugin in terminal' }));
    await waitFor(() => expect(mockRun).toHaveBeenCalledExactlyOnceWith('alpha', 'plugin-install'));
  });

  it('re-audit loops back to phase 1 with FRESH data and recomputed pre-checks', async () => {
    const allPresent: RepoSetupAuditResponse = {
      repoId: 'alpha',
      items: auditResponse.items.map((item) => ({ ...item, state: 'present' as const })),
    };
    mockAudit.mockResolvedValueOnce(auditResponse).mockResolvedValueOnce(allPresent);
    renderWizard();

    // Jump straight to human steps (deselect nothing -- use the apply-less path).
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Apply Chart Room init' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Apply chart-room skill' }));
    fireEvent.click(screen.getByRole('button', { name: 'human steps →' }));
    fireEvent.click(await screen.findByRole('button', { name: 're-audit' }));

    await waitFor(() => expect(mockAudit).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'Auto steps' })).toBeInTheDocument();
    // Fresh audit: everything present, so nothing is pre-checked any more.
    expect(screen.getByRole('checkbox', { name: 'Apply Chart Room init' })).not.toBeChecked();
  });

  it('an audit failure shows role=alert with a retry; close dismisses the wizard', async () => {
    mockAudit.mockRejectedValueOnce(new Error('repo not found')).mockResolvedValueOnce(auditResponse);
    renderWizard();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('repo not found');

    fireEvent.click(screen.getByRole('button', { name: 'retry audit' }));
    expect(await screen.findByRole('heading', { name: 'Auto steps' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close setup wizard' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set up alpha' })).not.toBeInTheDocument());
  });
});
