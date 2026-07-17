import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import {
  applySettingsEdit,
  previewSettingsEdit,
  previewSettingsMove,
  SettingsApiError,
  type SettingsEditPreview,
  type SettingsEffectiveResponse,
} from '../../src/api/client.js';
import { PermissionChips } from '../../src/settings/PermissionChips.js';
import { useDiffFlow } from '../../src/settings/useDiffFlow.js';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    previewSettingsMove: vi.fn(),
    previewSettingsEdit: vi.fn(),
    applySettingsEdit: vi.fn(),
  };
});

const mocks = {
  previewSettingsMove: vi.mocked(previewSettingsMove),
  previewSettingsEdit: vi.mocked(previewSettingsEdit),
  applySettingsEdit: vi.mocked(applySettingsEdit),
};

const PROJECT_DIR = 'C:/repos/alpha';
const PROJECT_FILE = 'C:/repos/alpha/.claude/settings.json';
const USER_FILE = 'C:/home/o/.claude/settings.json';
const MANAGED_FILE = 'C:/Program Files/ClaudeCode/managed-settings.json';

/** allow holds a two-member project-scope `Bash · git` group plus a user-scope git rule (three
 * chips, two scope files) and a user-scope pnpm chip; deny holds a managed (immovable) chip. */
const EFFECTIVE: SettingsEffectiveResponse = {
  values: {},
  permissions: {
    allow: [
      { rule: 'Bash(git status)', scope: 'project', file: PROJECT_FILE },
      { rule: 'Bash(git push *)', scope: 'project', file: PROJECT_FILE },
      { rule: 'Bash(git fetch *)', scope: 'user', file: USER_FILE },
      { rule: 'Bash(pnpm *)', scope: 'user', file: USER_FILE },
    ],
    ask: [],
    deny: [{ rule: 'Read(./.env)', scope: 'managed', file: MANAGED_FILE }],
    additionalDirectories: [],
  },
  excluded: [],
};

function makePreview(over: Partial<SettingsEditPreview> = {}): SettingsEditPreview {
  return {
    targetPath: PROJECT_FILE,
    exists: true,
    baseHash: 'hash-1',
    baseMalformed: false,
    ops: [],
    unifiedDiff: '',
    added: 1,
    removed: 1,
    validation: { ok: true, errors: [], warnings: [] },
    schemaSource: 'structural v1',
    unchanged: false,
    ...over,
  };
}

const onApplied = vi.fn();

function Harness({ effective }: { effective: SettingsEffectiveResponse }): ReactElement {
  const flow = useDiffFlow();
  return (
    <>
      <PermissionChips effective={effective} project={PROJECT_DIR} flow={flow} onApplied={onApplied} />
      {flow.modal}
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.previewSettingsMove.mockResolvedValue({
    newContent: '{"composed":true}',
    moved: 1,
    removed: 0,
    preview: makePreview(),
  });
  mocks.applySettingsEdit.mockResolvedValue({ targetPath: PROJECT_FILE, changed: true });
});

afterEach(() => {
  cleanup();
});

describe('chip grouping', () => {
  it('groups L1 by tool and L2 by Bash command word', () => {
    render(<Harness effective={EFFECTIVE} />);
    const allowCol = screen.getByRole('group', { name: 'allow rules' });
    const gitGroup = within(allowCol).getByText('Bash · git').closest('.chip-group');
    expect(gitGroup).not.toBeNull();
    expect(within(gitGroup as HTMLElement).getByText('Bash(git status)')).toBeInTheDocument();
    expect(within(gitGroup as HTMLElement).getByText('Bash(git push *)')).toBeInTheDocument();
    expect(within(gitGroup as HTMLElement).getByText('Bash(git fetch *)')).toBeInTheDocument();
    expect(within(allowCol).getByText('Bash · pnpm')).toBeInTheDocument();
  });
});

describe('moves through the preview→apply rail', () => {
  it('single chip move: button fallback previews the move and applies with the ticket', async () => {
    render(<Harness effective={EFFECTIVE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Bash(pnpm *) from allow to ask' }));

    await waitFor(() =>
      expect(mocks.previewSettingsMove).toHaveBeenCalledWith({
        scope: 'user',
        project: undefined,
        moves: [{ rule: 'Bash(pnpm *)', from: 'allow', to: 'ask' }],
      }),
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(mocks.applySettingsEdit).toHaveBeenCalledWith({
        scope: 'user',
        project: undefined,
        newContent: '{"composed":true}',
        baseHash: 'hash-1',
      }),
    );
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
  });

  it('group move to deny moves ALL members, batched per scope file and applied sequentially', async () => {
    render(<Harness effective={EFFECTIVE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move group Bash · git from allow to deny' }));

    // batch 1: the project-scope members
    await waitFor(() =>
      expect(mocks.previewSettingsMove).toHaveBeenCalledWith({
        scope: 'project',
        project: PROJECT_DIR,
        moves: [
          { rule: 'Bash(git status)', from: 'allow', to: 'deny' },
          { rule: 'Bash(git push *)', from: 'allow', to: 'deny' },
        ],
      }),
    );
    let dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName(expect.stringContaining('1/2'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

    // batch 2: the user-scope member, opened automatically after the first apply
    await waitFor(() =>
      expect(mocks.previewSettingsMove).toHaveBeenCalledWith({
        scope: 'user',
        project: undefined,
        moves: [{ rule: 'Bash(git fetch *)', from: 'allow', to: 'deny' }],
      }),
    );
    dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName(expect.stringContaining('2/2'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(mocks.applySettingsEdit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(2));
  });

  it('removes a chip when no destination is given', async () => {
    render(<Harness effective={EFFECTIVE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bash(pnpm *) from allow' }));
    await waitFor(() =>
      expect(mocks.previewSettingsMove).toHaveBeenCalledWith({
        scope: 'user',
        project: undefined,
        moves: [{ rule: 'Bash(pnpm *)', from: 'allow' }],
      }),
    );
  });

  it('native HTML5 drag-and-drop moves a chip between columns', async () => {
    render(<Harness effective={EFFECTIVE} />);
    const chip = screen.getByText('Bash(pnpm *)').closest('.chip') as HTMLElement;
    expect(chip).toHaveAttribute('draggable', 'true');
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };

    fireEvent.dragStart(chip, { dataTransfer });
    const askCol = screen.getByRole('group', { name: 'ask rules' });
    fireEvent.dragOver(askCol, { dataTransfer });
    fireEvent.drop(askCol, { dataTransfer });

    await waitFor(() =>
      expect(mocks.previewSettingsMove).toHaveBeenCalledWith({
        scope: 'user',
        project: undefined,
        moves: [{ rule: 'Bash(pnpm *)', from: 'allow', to: 'ask' }],
      }),
    );
  });

  it('D5 regression: base-drift recovery RECOMPOSES the move server-side, not a stale re-send', async () => {
    mocks.applySettingsEdit
      .mockRejectedValueOnce(new SettingsApiError('changed since the diff was previewed', 409, 'base-drift'))
      .mockResolvedValueOnce({ targetPath: USER_FILE, changed: true });
    render(<Harness effective={EFFECTIVE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Bash(pnpm *) from allow to ask' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await within(dialog).findByRole('alert');
    mocks.previewSettingsMove.mockResolvedValueOnce({
      newContent: '{"recomposed":true}',
      moved: 1,
      removed: 0,
      preview: makePreview({ baseHash: 'hash-fresh' }),
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reload & re-preview' }));

    await waitFor(() => expect(mocks.previewSettingsMove).toHaveBeenCalledTimes(2));
    expect(mocks.previewSettingsEdit).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(mocks.applySettingsEdit).toHaveBeenLastCalledWith(
        expect.objectContaining({ newContent: '{"recomposed":true}', baseHash: 'hash-fresh' }),
      ),
    );
  });
});

describe('managed-scope chips are immovable', () => {
  it('renders managed chips locked: no move buttons, not draggable, group controls absent', () => {
    render(<Harness effective={EFFECTIVE} />);
    const denyCol = screen.getByRole('group', { name: 'deny rules' });
    const chip = within(denyCol).getByText('Read(./.env)').closest('.chip') as HTMLElement;
    expect(chip).toHaveClass('chip--managed');
    expect(chip).toHaveAttribute('draggable', 'false');
    expect(within(denyCol).queryByRole('button', { name: /Move Read/ })).not.toBeInTheDocument();
    expect(within(denyCol).queryByRole('button', { name: /Remove Read/ })).not.toBeInTheDocument();
    // the all-managed group offers no group actions either
    expect(within(denyCol).queryByRole('button', { name: /Move group Read/ })).not.toBeInTheDocument();
    expect(mocks.previewSettingsMove).not.toHaveBeenCalled();
  });
});
