import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applySettingsEdit,
  fetchSettingsCatalog,
  previewSettingsAdd,
  type SettingsAddPreviewResponse,
  type SettingsCatalogResponse,
  type SettingsEditPreview,
} from '../../src/api/client.js';
import { AddSettingsModal } from '../../src/settings/AddSettingsModal.js';
import { useDiffFlow } from '../../src/settings/useDiffFlow.js';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    fetchSettingsCatalog: vi.fn(),
    previewSettingsAdd: vi.fn(),
    previewSettingsEdit: vi.fn(),
    applySettingsEdit: vi.fn(),
  };
});

const mocks = {
  fetchSettingsCatalog: vi.mocked(fetchSettingsCatalog),
  previewSettingsAdd: vi.mocked(previewSettingsAdd),
  applySettingsEdit: vi.mocked(applySettingsEdit),
};

const PROJECT_DIR = 'C:/repos/alpha';

const CATALOG: SettingsCatalogResponse = {
  settings: [
    { key: 'autoMemoryEnabled', kind: 'boolean', description: 'Enable auto memory.', defaultValue: true },
    { key: 'cleanupPeriodDays', kind: 'number', description: 'Session file retention in days.', defaultValue: 30 },
    {
      key: 'editorMode',
      kind: 'string',
      description: 'Key-binding mode.',
      enumValues: ['normal', 'vim'],
      defaultValue: 'normal',
    },
    { key: 'env', kind: 'object', description: 'Environment variables for every session.', defaultValue: {} },
    { key: 'claudeMd', kind: 'string', description: 'Organization-wide CLAUDE.md content.', defaultValue: '', managedOnly: true },
    { key: 'companyAnnouncements', kind: 'string-array', description: 'Announcements displayed at startup.', defaultValue: [] },
    {
      key: 'permissions.defaultMode',
      kind: 'string',
      description: 'Default permission mode when no rule matches.',
      enumValues: ['default', 'acceptEdits', 'plan', 'bypassPermissions'],
      defaultValue: 'default',
    },
  ],
  ruleTemplates: [
    {
      id: 'bash-prefix',
      label: 'Bash command prefix',
      rule: 'Bash(npm run *)',
      defaultList: 'allow',
      description: 'Shell commands starting with a prefix.',
    },
    {
      id: 'read-path',
      label: 'Read a path',
      rule: 'Read(./.env)',
      defaultList: 'deny',
      description: 'File reads matching a gitignore-style pattern.',
    },
  ],
  modes: ['default', 'acceptEdits', 'plan', 'bypassPermissions'],
};

function makePreview(over: Partial<SettingsEditPreview> = {}): SettingsEditPreview {
  return {
    targetPath: 'C:/home/o/.claude/settings.json',
    exists: true,
    baseHash: 'hash-add',
    baseMalformed: false,
    ops: [{ kind: 'add', line: '  "editorMode": "vim"' }],
    unifiedDiff: '--- a\n+++ b\n',
    added: 1,
    removed: 0,
    validation: { ok: true, errors: [], warnings: [] },
    schemaSource: 'structural v1 (docs 2026-07-06)',
    unchanged: false,
    ...over,
  };
}

function makeAddResponse(over: Partial<SettingsAddPreviewResponse> = {}): SettingsAddPreviewResponse {
  return {
    newContent: '{\n  "editorMode": "vim"\n}\n',
    addedKeys: ['editorMode'],
    overwrittenKeys: [],
    addedRules: 0,
    preview: makePreview(),
    ...over,
  };
}

/** Mounts the modal with the REAL useDiffFlow rail (client module mocked) -- the exact wiring
 * SettingsPage uses, so the preview → DiffModal → apply chain is exercised end to end. */
function Harness({ project, onApplied }: { project?: string; onApplied?: () => void }): ReactElement {
  const flow = useDiffFlow();
  const [open, setOpen] = useState(true);
  return (
    <>
      {open && (
        <AddSettingsModal
          project={project}
          flow={flow}
          onApplied={onApplied ?? ((): void => {})}
          onClose={() => setOpen(false)}
        />
      )}
      {flow.modal}
    </>
  );
}

async function renderModal(props: { project?: string; onApplied?: () => void } = {}): Promise<void> {
  render(<Harness {...props} />);
  await screen.findByRole('dialog', { name: 'Add settings' });
  await screen.findByText('autoMemoryEnabled');
}

function search(): HTMLElement {
  return screen.getByLabelText('Search settings catalog');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchSettingsCatalog.mockResolvedValue(CATALOG);
});

afterEach(() => {
  cleanup();
});

describe('catalog list + search', () => {
  it('renders both groups with kind chips and the managed-only warning chip', async () => {
    await renderModal();
    const dialog = screen.getByRole('dialog', { name: 'Add settings' });
    expect(within(dialog).getByText('cleanupPeriodDays')).toBeInTheDocument();
    expect(within(dialog).getByText('Bash command prefix')).toBeInTheDocument();
    // kind chip + the managed-only flag
    expect(within(dialog).getByText('number')).toBeInTheDocument();
    expect(within(dialog).getByText('managed-only')).toBeInTheDocument();
  });

  it('filters both groups case-insensitively over key, description and template label', async () => {
    await renderModal();
    fireEvent.change(search(), { target: { value: 'BASH' } });
    expect(screen.getByText('Bash command prefix')).toBeInTheDocument();
    expect(screen.queryByText('autoMemoryEnabled')).not.toBeInTheDocument();
    expect(screen.queryByText('Read a path')).not.toBeInTheDocument();

    // description matches too
    fireEvent.change(search(), { target: { value: 'auto memory' } });
    expect(screen.getByText('autoMemoryEnabled')).toBeInTheDocument();
    expect(screen.getByText('No rule templates match.')).toBeInTheDocument();
  });
});

describe('keyboard navigation', () => {
  it('moves the highlight with ArrowDown/ArrowUp and toggles the highlighted item with Enter', async () => {
    await renderModal();
    fireEvent.keyDown(search(), { key: 'ArrowDown' });
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(screen.getByLabelText('Select cleanupPeriodDays')).toBeChecked();

    // Enter again toggles it back off; ArrowUp walks back to the first row
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(screen.getByLabelText('Select cleanupPeriodDays')).not.toBeChecked();
    fireEvent.keyDown(search(), { key: 'ArrowUp' });
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(screen.getByLabelText('Select autoMemoryEnabled')).toBeChecked();
  });

  it('toggles across groups: the highlight walks into the rule templates', async () => {
    await renderModal();
    fireEvent.change(search(), { target: { value: 'bash' } });
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(screen.getByLabelText('Select rule Bash command prefix')).toBeChecked();
  });

  it('Esc closes the modal', async () => {
    await renderModal();
    fireEvent.keyDown(search(), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Add settings' })).not.toBeInTheDocument();
  });
});

describe('additions payload', () => {
  it('sends boolean/enum/number values through per-kind inputs', async () => {
    mocks.previewSettingsAdd.mockResolvedValue(makeAddResponse());
    await renderModal();

    fireEvent.click(screen.getByLabelText('Select autoMemoryEnabled'));
    fireEvent.click(screen.getByLabelText('Select editorMode'));
    fireEvent.click(screen.getByLabelText('Select cleanupPeriodDays'));

    // prefilled from defaultValue, then edited
    expect(screen.getByLabelText('Value for autoMemoryEnabled')).toBeChecked();
    fireEvent.click(screen.getByLabelText('Value for autoMemoryEnabled')); // toggle → false
    fireEvent.change(screen.getByLabelText('Value for editorMode'), { target: { value: 'vim' } });
    fireEvent.change(screen.getByLabelText('Value for cleanupPeriodDays'), { target: { value: '45' } });

    fireEvent.click(screen.getByRole('button', { name: 'Preview & apply' }));
    await waitFor(() =>
      expect(mocks.previewSettingsAdd).toHaveBeenCalledWith({
        scope: 'user',
        project: undefined,
        additions: { values: { autoMemoryEnabled: false, editorMode: 'vim', cleanupPeriodDays: 45 } },
      }),
    );
  });

  it('routes permissions.defaultMode to additions.defaultMode, never additions.values', async () => {
    mocks.previewSettingsAdd.mockResolvedValue(makeAddResponse({ addedKeys: ['permissions.defaultMode'] }));
    await renderModal();

    fireEvent.click(screen.getByLabelText('Select permissions.defaultMode'));
    fireEvent.change(screen.getByLabelText('Value for permissions.defaultMode'), { target: { value: 'plan' } });

    fireEvent.click(screen.getByRole('button', { name: 'Preview & apply' }));
    await waitFor(() =>
      expect(mocks.previewSettingsAdd).toHaveBeenCalledWith({
        scope: 'user',
        project: undefined,
        additions: { defaultMode: 'plan' },
      }),
    );
  });

  it('sends rule selections into the chosen permissions list with edited rule text', async () => {
    mocks.previewSettingsAdd.mockResolvedValue(makeAddResponse({ addedKeys: [], addedRules: 2 }));
    await renderModal();

    fireEvent.click(screen.getByLabelText('Select rule Bash command prefix'));
    fireEvent.click(screen.getByLabelText('Select rule Read a path'));
    // bash-prefix moves allow → ask; read-path keeps its deny default but the pattern is edited
    fireEvent.change(screen.getByLabelText('List for Bash command prefix'), { target: { value: 'ask' } });
    fireEvent.change(screen.getByLabelText('Rule for Read a path'), { target: { value: 'Read(./secrets/**)' } });

    fireEvent.click(screen.getByRole('button', { name: 'Preview & apply' }));
    await waitFor(() =>
      expect(mocks.previewSettingsAdd).toHaveBeenCalledWith({
        scope: 'user',
        project: undefined,
        additions: { permissions: { deny: ['Read(./secrets/**)'], ask: ['Bash(npm run *)'] } },
      }),
    );
  });

  it('blocks the preview on invalid JSON for object kinds, with a visible field issue', async () => {
    await renderModal();
    fireEvent.click(screen.getByLabelText('Select env'));
    fireEvent.change(screen.getByLabelText('Value for env'), { target: { value: 'not json' } });

    expect(screen.getByText('must be valid JSON')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview & apply' })).toBeDisabled();
    expect(mocks.previewSettingsAdd).not.toHaveBeenCalled();
  });
});

describe('scope picker', () => {
  it('disables project/local when the page has no project selected (same rule as the editor)', async () => {
    await renderModal();
    const picker = screen.getByLabelText('Add target scope');
    expect(within(picker).getByRole('option', { name: 'project' })).toBeDisabled();
    expect(within(picker).getByRole('option', { name: 'local' })).toBeDisabled();
    expect(within(picker).getByRole('option', { name: 'user' })).not.toBeDisabled();
  });

  it('enables them with a project and passes it on non-user scopes', async () => {
    mocks.previewSettingsAdd.mockResolvedValue(makeAddResponse());
    await renderModal({ project: PROJECT_DIR });
    const picker = screen.getByLabelText('Add target scope');
    expect(within(picker).getByRole('option', { name: 'local' })).not.toBeDisabled();

    fireEvent.click(screen.getByLabelText('Select editorMode'));
    fireEvent.change(picker, { target: { value: 'local' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview & apply' }));
    await waitFor(() =>
      expect(mocks.previewSettingsAdd).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'local', project: PROJECT_DIR }),
      ),
    );
  });
});

describe('preview → apply chain (the existing DiffModal rail)', () => {
  it('opens the DiffModal with the add summary, applies with newContent + baseHash, fires refresh and closes', async () => {
    const onApplied = vi.fn();
    mocks.previewSettingsAdd.mockResolvedValue(
      makeAddResponse({
        newContent: '{\n  "editorMode": "vim"\n}\n',
        addedKeys: ['editorMode'],
        overwrittenKeys: ['cleanupPeriodDays'],
        addedRules: 1,
        preview: makePreview({ baseHash: 'hash-add' }),
      }),
    );
    mocks.applySettingsEdit.mockResolvedValue({ targetPath: 'C:/home/o/.claude/settings.json', changed: true });
    await renderModal({ onApplied });

    fireEvent.click(screen.getByLabelText('Select editorMode'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview & apply' }));

    // overwrites are visible in the diff-modal header
    const dialog = await screen.findByRole('dialog', {
      name: 'Add to user settings (1 added, 1 overwritten, 1 rule(s) appended)',
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(mocks.applySettingsEdit).toHaveBeenCalledWith({
        scope: 'user',
        project: undefined,
        newContent: '{\n  "editorMode": "vim"\n}\n',
        baseHash: 'hash-add',
      }),
    );
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    // both the diff modal and the add modal are gone after a successful apply
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('surfaces a preview-step error inside the add modal and stays open', async () => {
    mocks.previewSettingsAdd.mockRejectedValue(new Error('unregistered project'));
    await renderModal();
    fireEvent.click(screen.getByLabelText('Select editorMode'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview & apply' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('unregistered project');
    expect(screen.getByRole('dialog', { name: 'Add settings' })).toBeInTheDocument();
  });
});
