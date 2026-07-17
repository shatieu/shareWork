import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applySettingsEdit,
  createSettingsTemplate,
  fetchAlwaysAllowed,
  fetchSettingsBackup,
  fetchSettingsBackups,
  fetchSettingsEffective,
  fetchSettingsFile,
  fetchSettingsScopes,
  fetchSettingsTemplates,
  previewRevokeRule,
  previewSettingsEdit,
  previewSettingsMove,
  previewSettingsTemplate,
  SettingsApiError,
  simulateSettings,
  type SettingsEditPreview,
  type SettingsEffectiveResponse,
  type SettingsScopesResponse,
  type SettingsTemplatePack,
  type SettingsVerdict,
} from '../../src/api/client.js';
import { SettingsPage } from '../../src/settings/SettingsPage.js';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    fetchSettingsScopes: vi.fn(),
    fetchSettingsEffective: vi.fn(),
    simulateSettings: vi.fn(),
    fetchSettingsFile: vi.fn(),
    previewSettingsEdit: vi.fn(),
    applySettingsEdit: vi.fn(),
    fetchSettingsTemplates: vi.fn(),
    previewSettingsTemplate: vi.fn(),
    createSettingsTemplate: vi.fn(),
    previewSettingsMove: vi.fn(),
    fetchAlwaysAllowed: vi.fn(),
    previewRevokeRule: vi.fn(),
    fetchSettingsBackups: vi.fn(),
    fetchSettingsBackup: vi.fn(),
  };
});

const mocks = {
  fetchSettingsScopes: vi.mocked(fetchSettingsScopes),
  fetchSettingsEffective: vi.mocked(fetchSettingsEffective),
  simulateSettings: vi.mocked(simulateSettings),
  fetchSettingsFile: vi.mocked(fetchSettingsFile),
  previewSettingsEdit: vi.mocked(previewSettingsEdit),
  applySettingsEdit: vi.mocked(applySettingsEdit),
  fetchSettingsTemplates: vi.mocked(fetchSettingsTemplates),
  previewSettingsTemplate: vi.mocked(previewSettingsTemplate),
  createSettingsTemplate: vi.mocked(createSettingsTemplate),
  previewSettingsMove: vi.mocked(previewSettingsMove),
  fetchAlwaysAllowed: vi.mocked(fetchAlwaysAllowed),
  previewRevokeRule: vi.mocked(previewRevokeRule),
  fetchSettingsBackups: vi.mocked(fetchSettingsBackups),
  fetchSettingsBackup: vi.mocked(fetchSettingsBackup),
};

const USER_FILE = 'C:/home/o/.claude/settings.json';
const PROJECT_FILE = 'C:/repos/alpha/.claude/settings.json';
const LOCAL_FILE = 'C:/repos/alpha/.claude/settings.local.json';
const PROJECT_DIR = 'C:/repos/alpha';

const SCOPES: SettingsScopesResponse = {
  scopes: [
    { scope: 'managed', path: 'C:/Program Files/ClaudeCode/managed-settings.json', exists: false, writable: false },
    { scope: 'local', path: LOCAL_FILE, exists: true, writable: true },
    { scope: 'project', path: PROJECT_FILE, exists: true, writable: true },
    { scope: 'user', path: USER_FILE, exists: true, writable: true },
  ],
  projects: [{ id: 'repo-a', name: 'alpha', absPath: PROJECT_DIR }],
  schemaSource: 'structural v1 (docs 2026-07-06)',
};

const EFFECTIVE: SettingsEffectiveResponse = {
  values: {
    model: {
      value: 'opus',
      scope: 'project',
      file: PROJECT_FILE,
      overridden: [{ scope: 'user', file: USER_FILE, value: 'sonnet' }],
    },
  },
  permissions: {
    allow: [{ rule: 'Bash(git:*)', scope: 'local', file: LOCAL_FILE }],
    deny: [{ rule: 'Read(./.env)', scope: 'project', file: PROJECT_FILE }],
    ask: [{ rule: 'Bash(git push:*)', scope: 'user', file: USER_FILE }],
    additionalDirectories: [],
    defaultMode: { value: 'acceptEdits', scope: 'project', file: PROJECT_FILE, overridden: [] },
  },
  excluded: [],
};

const DENY_VERDICT: SettingsVerdict = {
  behavior: 'deny',
  decidingRule: { rule: 'Bash(rm:*)', list: 'deny', scope: 'project', file: PROJECT_FILE },
  mode: 'acceptEdits',
  modeSource: { scope: 'project', file: PROJECT_FILE },
  explanation:
    "DENIED by deny rule 'Bash(rm:*)' (project scope) -- deny rules are evaluated first and cannot be overridden by any allow rule in any scope.",
  caveats: ['PreToolUse hooks can deny or force prompts at runtime; hooks are not simulated.'],
  unevaluated: [],
  notes: [],
};

function makePreview(over: Partial<SettingsEditPreview> = {}): SettingsEditPreview {
  return {
    targetPath: USER_FILE,
    exists: true,
    baseHash: 'hash-1',
    baseMalformed: false,
    ops: [
      { kind: 'same', line: '{' },
      { kind: 'del', line: '  "model": "sonnet"' },
      { kind: 'add', line: '  "model": "opus"' },
      { kind: 'same', line: '}' },
    ],
    unifiedDiff: '--- a\n+++ b\n',
    added: 1,
    removed: 1,
    validation: { ok: true, errors: [], warnings: [] },
    schemaSource: 'structural v1 (docs 2026-07-06)',
    unchanged: false,
    ...over,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  mocks.fetchSettingsScopes.mockResolvedValue(SCOPES);
  mocks.fetchSettingsEffective.mockResolvedValue(EFFECTIVE);
  mocks.fetchSettingsFile.mockResolvedValue({
    scope: 'user',
    path: USER_FILE,
    exists: true,
    content: '{\n  "model": "sonnet"\n}',
    baseHash: 'hash-1',
    writable: true,
  });
  mocks.fetchSettingsTemplates.mockResolvedValue({
    packs: [
      {
        id: 'safe-web-dev',
        name: 'safe web dev',
        version: '1.0.0',
        description: 'Everyday web-dev commands without the dangerous tail.',
        permissions: { allow: ['Bash(pnpm:*)', 'WebFetch(domain:localhost)'], deny: ['Read(./.env)'], ask: [] },
        source: 'builtin',
      },
    ],
    warnings: [],
  });
  mocks.fetchAlwaysAllowed.mockResolvedValue({
    available: true,
    entries: [
      {
        rule: 'Bash(git:*)',
        cwd: PROJECT_DIR,
        project: 'alpha',
        decidedAt: '2026-07-05T10:00:00.000Z',
        backupPath: null,
      },
    ],
  });
  mocks.fetchSettingsBackups.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  render(<SettingsPage />);
  await screen.findByRole('heading', { name: 'Settings' });
  // the editor section settles last (file fetch after project bootstrap)
  await screen.findByLabelText('Settings file content');
}

describe('Simulator (the §B centerpiece)', () => {
  it('renders a deny verdict with the deciding rule, scope and source file', async () => {
    mocks.simulateSettings.mockResolvedValue(DENY_VERDICT);
    await renderPage();

    fireEvent.change(screen.getByLabelText('command'), { target: { value: 'rm -rf ./dist' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));

    const card = await screen.findByRole('status');
    expect(card).toHaveTextContent('deny');
    expect(within(card).getByText('Bash(rm:*)')).toBeInTheDocument();
    // scope badge + source file (full path rides the title attribute)
    expect(card.querySelector('.scope-badge--project')).toHaveTextContent('project');
    expect(within(card).getAllByTitle(PROJECT_FILE).length).toBeGreaterThan(0);
    expect(within(card).getByText(/DENIED by deny rule/)).toBeInTheDocument();
    // honest-limits surfaces stay present (collapsed)
    expect(within(card).getByText(/caveats \(1\)/)).toBeInTheDocument();

    expect(mocks.simulateSettings).toHaveBeenCalledWith({
      project: PROJECT_DIR,
      tool: 'Bash',
      command: 'rm -rf ./dist',
    });
  });

  it('switches the argument field per tool and sends a url for WebFetch', async () => {
    mocks.simulateSettings.mockResolvedValue({ ...DENY_VERDICT, behavior: 'allow' });
    await renderPage();

    fireEvent.change(screen.getByLabelText('Tool'), { target: { value: 'WebFetch' } });
    fireEvent.change(screen.getByLabelText('url'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));

    await waitFor(() =>
      expect(mocks.simulateSettings).toHaveBeenCalledWith({
        project: PROJECT_DIR,
        tool: 'WebFetch',
        url: 'https://example.com',
      }),
    );
  });
});

describe('Effective view', () => {
  it('groups merged rules deny/ask/allow with scope badges and source files', async () => {
    await renderPage();
    const view = screen.getByRole('region', { name: 'Effective settings' });

    const denyRule = within(view).getByText('Read(./.env)');
    expect(denyRule.closest('.settings-rules--deny')).not.toBeNull();
    expect(denyRule.parentElement?.querySelector('.scope-badge--project')).toHaveTextContent('project');

    const askRule = within(view).getByText('Bash(git push:*)');
    expect(askRule.closest('.settings-rules--ask')).not.toBeNull();
    expect(askRule.parentElement?.querySelector('.scope-badge--user')).toHaveTextContent('user');

    const allowRule = within(view).getByText('Bash(git:*)');
    expect(allowRule.closest('.settings-rules--allow')).not.toBeNull();
    expect(allowRule.parentElement?.querySelector('.scope-badge--local')).toHaveTextContent('local');
  });

  it('shows defaultMode with its source and the shadowed values of other keys', async () => {
    await renderPage();
    const view = screen.getByRole('region', { name: 'Effective settings' });
    expect(within(view).getByText('acceptEdits')).toBeInTheDocument();
    // model: winning value + 1 shadowed scope
    expect(within(view).getByText('"opus"')).toBeInTheDocument();
    expect(within(view).getByText('1 scope(s)')).toBeInTheDocument();
    // scope-file list badges
    expect(within(view).getAllByText('absent').length).toBe(1); // managed
    expect(within(view).getAllByText('read-only').length).toBe(1);
  });
});

describe('Editor rails', () => {
  it('gates Apply behind the diff preview and applies with the preview baseHash', async () => {
    mocks.previewSettingsEdit.mockResolvedValue(makePreview());
    mocks.applySettingsEdit.mockResolvedValue({ targetPath: USER_FILE, changed: true, backupPath: 'b' });
    await renderPage();

    // no Apply anywhere before a preview exists -- the modal is the only write path
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();

    const textarea = screen.getByLabelText('Settings file content');
    fireEvent.change(textarea, { target: { value: '{\n  "model": "opus"\n}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview diff' }));

    const dialog = await screen.findByRole('dialog', { name: 'Edit user settings' });
    expect(mocks.previewSettingsEdit).toHaveBeenCalledWith({
      scope: 'user',
      project: undefined,
      newContent: '{\n  "model": "opus"\n}',
    });
    // diff ops render with +/- markers
    expect(within(dialog).getByText(/"model": "opus"/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(mocks.applySettingsEdit).toHaveBeenCalledWith({
        scope: 'user',
        project: undefined,
        newContent: '{\n  "model": "opus"\n}',
        baseHash: 'hash-1',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // a successful apply refreshes the effective view
    await waitFor(() => expect(mocks.fetchSettingsEffective).toHaveBeenCalledTimes(2));
  });

  it('handles a 409 base-drift with a reload-and-re-preview path and applies with the fresh hash', async () => {
    mocks.previewSettingsEdit.mockResolvedValueOnce(makePreview({ baseHash: 'hash-1' }));
    mocks.applySettingsEdit
      .mockRejectedValueOnce(new SettingsApiError('settings.json changed since the diff was previewed', 409, 'base-drift'))
      .mockResolvedValueOnce({ targetPath: USER_FILE, changed: true });
    await renderPage();

    fireEvent.change(screen.getByLabelText('Settings file content'), { target: { value: '{"a":1}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview diff' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

    // the typed 409 surfaces with the recovery affordance
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(/changed since the diff was previewed/);
    mocks.previewSettingsEdit.mockResolvedValueOnce(makePreview({ baseHash: 'hash-2' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reload & re-preview' }));

    await waitFor(() => expect(mocks.previewSettingsEdit).toHaveBeenCalledTimes(2));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(mocks.applySettingsEdit).toHaveBeenLastCalledWith(expect.objectContaining({ baseHash: 'hash-2' })),
    );
  });

  it('blocks Apply on schema validation errors', async () => {
    mocks.previewSettingsEdit.mockResolvedValue(
      makePreview({
        validation: {
          ok: false,
          errors: [{ path: 'permissions.allow', message: 'must be an array of strings' }],
          warnings: [],
        },
      }),
    );
    await renderPage();

    fireEvent.change(screen.getByLabelText('Settings file content'), { target: { value: '{"permissions":{"allow":1}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview diff' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText(/must be an array of strings/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(mocks.applySettingsEdit).not.toHaveBeenCalled();
  });

  it('offers the clearly-labeled malformed-target recovery checkbox and sends the flag', async () => {
    mocks.previewSettingsEdit.mockResolvedValue(
      makePreview({ baseMalformed: true, baseError: 'not valid JSON' }),
    );
    mocks.applySettingsEdit.mockResolvedValue({ targetPath: USER_FILE, changed: true });
    await renderPage();

    fireEvent.change(screen.getByLabelText('Settings file content'), { target: { value: '{}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview diff' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(within(dialog).getByText(/Overwrite the malformed target file/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(mocks.applySettingsEdit).toHaveBeenCalledWith(
        expect.objectContaining({ overwriteMalformedBase: true, baseHash: 'hash-1' }),
      ),
    );
  });
});

describe('Editor defect regressions (D2/D3/D6)', () => {
  const FRESH_FILE = {
    scope: 'user' as const,
    path: USER_FILE,
    exists: true,
    content: '{\n  "model": "opus"\n}',
    baseHash: 'hash-2',
    writable: true,
  };

  function applyTemplatePack(): void {
    mocks.previewSettingsTemplate.mockResolvedValue({
      pack: { id: 'safe-web-dev', name: 'safe web dev', version: '1.0.0' },
      addedRules: 1,
      newContent: '{"permissions":{"allow":["Bash(pnpm:*)"]}}',
      preview: makePreview({ baseHash: 'hash-t' }),
    });
    mocks.applySettingsEdit.mockResolvedValue({ targetPath: USER_FILE, changed: true });
    const packs = screen.getByRole('region', { name: 'Template packs' });
    fireEvent.click(within(packs).getByRole('button', { name: 'Apply to user' }));
  }

  it('D2: an apply in another section re-syncs a CLEAN editor from disk', async () => {
    mocks.fetchSettingsFile
      .mockResolvedValueOnce({
        scope: 'user',
        path: USER_FILE,
        exists: true,
        content: '{\n  "model": "sonnet"\n}',
        baseHash: 'hash-1',
        writable: true,
      })
      .mockResolvedValue(FRESH_FILE);
    await renderPage();
    expect(screen.getByLabelText('Settings file content')).toHaveValue('{\n  "model": "sonnet"\n}');

    applyTemplatePack();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(screen.getByLabelText('Settings file content')).toHaveValue('{\n  "model": "opus"\n}'),
    );
  });

  it('D2: a DIRTY editor keeps the edits, flags the drift, and offers an explicit discard', async () => {
    mocks.fetchSettingsFile
      .mockResolvedValueOnce({
        scope: 'user',
        path: USER_FILE,
        exists: true,
        content: '{\n  "model": "sonnet"\n}',
        baseHash: 'hash-1',
        writable: true,
      })
      .mockResolvedValue(FRESH_FILE);
    await renderPage();
    fireEvent.change(screen.getByLabelText('Settings file content'), { target: { value: '{"mine":1}' } });

    applyTemplatePack();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

    const editor = screen.getByRole('region', { name: 'Settings editor' });
    await within(editor).findByText(/changed on disk since you started editing/);
    expect(screen.getByLabelText('Settings file content')).toHaveValue('{"mine":1}');

    fireEvent.click(within(editor).getByRole('button', { name: 'Load disk version (discards my edits)' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Settings file content')).toHaveValue('{\n  "model": "opus"\n}'),
    );
  });

  it('D3: switching scope with unsaved edits requires confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderPage();
    fireEvent.change(screen.getByLabelText('Settings file content'), { target: { value: '{"x":1}' } });

    fireEvent.change(screen.getByLabelText('Editor scope'), { target: { value: 'project' } });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Editor scope')).toHaveValue('user');
    expect(screen.getByLabelText('Settings file content')).toHaveValue('{"x":1}');

    confirmSpy.mockReturnValue(true);
    fireEvent.change(screen.getByLabelText('Editor scope'), { target: { value: 'project' } });
    await waitFor(() => expect(mocks.fetchSettingsFile).toHaveBeenLastCalledWith('project', PROJECT_DIR));
  });

  it('D3: switching project with unsaved edits requires confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderPage();
    fireEvent.change(screen.getByLabelText('Settings file content'), { target: { value: '{"x":1}' } });

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '' } });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // the selection did not change
    expect(window.localStorage.getItem('chartroom.settings.project')).toBe(PROJECT_DIR);
    expect(screen.getByLabelText('Settings file content')).toHaveValue('{"x":1}');
  });

  it('D6: preview-step failures render inside the editor section, not at the page top', async () => {
    mocks.previewSettingsEdit.mockRejectedValue(new Error('station exploded'));
    await renderPage();
    fireEvent.change(screen.getByLabelText('Settings file content'), { target: { value: '{"x":1}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview diff' }));

    const editor = screen.getByRole('region', { name: 'Settings editor' });
    expect(await within(editor).findByText('station exploded')).toBeInTheDocument();
    expect(screen.getAllByText('station exploded')).toHaveLength(1); // nothing at the page top
  });
});

describe('Template packs', () => {
  it('previews a pack server-side and applies through the same diff modal', async () => {
    mocks.previewSettingsTemplate.mockResolvedValue({
      pack: { id: 'safe-web-dev', name: 'safe web dev', version: '1.0.0' },
      addedRules: 3,
      newContent: '{"permissions":{"allow":["Bash(pnpm:*)"]}}',
      preview: makePreview({ baseHash: 'hash-t' }),
    });
    mocks.applySettingsEdit.mockResolvedValue({ targetPath: USER_FILE, changed: true });
    await renderPage();

    const packs = screen.getByRole('region', { name: 'Template packs' });
    expect(within(packs).getByText('safe web dev')).toBeInTheDocument();
    expect(within(packs).getByText('allow 2 · deny 1 · ask 0')).toBeInTheDocument();

    fireEvent.click(within(packs).getByRole('button', { name: 'Apply to user' }));
    await waitFor(() =>
      expect(mocks.previewSettingsTemplate).toHaveBeenCalledWith({ id: 'safe-web-dev', scope: 'user', project: undefined }),
    );
    const dialog = await screen.findByRole('dialog', { name: "Apply pack 'safe web dev' to user" });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(mocks.applySettingsEdit).toHaveBeenCalledWith({
        scope: 'user',
        project: undefined,
        newContent: '{"permissions":{"allow":["Bash(pnpm:*)"]}}',
        baseHash: 'hash-t',
      }),
    );
  });

  it('creates a user pack from the current effective permissions; it appears and applies', async () => {
    const created: SettingsTemplatePack = {
      id: 'team-web',
      name: 'Team web',
      version: '1.0.0',
      description: '',
      permissions: { allow: ['Bash(git:*)'], deny: ['Read(./.env)'], ask: ['Bash(git push:*)'] },
      source: 'user',
    };
    mocks.createSettingsTemplate.mockResolvedValue({ pack: created });
    await renderPage();
    const packs = screen.getByRole('region', { name: 'Template packs' });

    fireEvent.click(within(packs).getByRole('button', { name: 'New pack…' }));
    fireEvent.change(within(packs).getByLabelText('Pack id'), { target: { value: 'team-web' } });
    fireEvent.change(within(packs).getByLabelText('Pack name'), { target: { value: 'Team web' } });
    fireEvent.click(within(packs).getByRole('button', { name: 'Prefill from current effective permissions' }));
    expect(within(packs).getByLabelText('Pack allow rules')).toHaveValue('Bash(git:*)');
    expect(within(packs).getByLabelText('Pack deny rules')).toHaveValue('Read(./.env)');
    expect(within(packs).getByLabelText('Pack ask rules')).toHaveValue('Bash(git push:*)');

    // the post-create catalog refresh now includes the new pack
    const existing = await mocks.fetchSettingsTemplates.mock.results[0].value;
    mocks.fetchSettingsTemplates.mockResolvedValue({ packs: [...existing.packs, created], warnings: [] });
    fireEvent.click(within(packs).getByRole('button', { name: 'Create pack' }));

    await waitFor(() =>
      expect(mocks.createSettingsTemplate).toHaveBeenCalledWith({
        id: 'team-web',
        name: 'Team web',
        version: '1.0.0',
        description: '',
        permissions: { allow: ['Bash(git:*)'], deny: ['Read(./.env)'], ask: ['Bash(git push:*)'] },
      }),
    );
    const card = (await within(packs).findByText('Team web')).closest('.settings-card');
    expect(card?.querySelector('.settings-chip')?.textContent).toBe('user'); // source badge

    // the new pack applies through the EXISTING preview→apply pipeline
    mocks.previewSettingsTemplate.mockResolvedValue({
      pack: { id: 'team-web', name: 'Team web', version: '1.0.0' },
      addedRules: 3,
      newContent: '{"permissions":{"allow":["Bash(git:*)"]}}',
      preview: makePreview({ baseHash: 'hash-u' }),
    });
    mocks.applySettingsEdit.mockResolvedValue({ targetPath: USER_FILE, changed: true });
    const applyButtons = within(packs).getAllByRole('button', { name: 'Apply to user' });
    fireEvent.click(applyButtons[applyButtons.length - 1]);
    await waitFor(() =>
      expect(mocks.previewSettingsTemplate).toHaveBeenCalledWith({ id: 'team-web', scope: 'user', project: undefined }),
    );
    const dialog = await screen.findByRole('dialog', { name: "Apply pack 'Team web' to user" });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(mocks.applySettingsEdit).toHaveBeenCalledWith(expect.objectContaining({ baseHash: 'hash-u' })),
    );
  });
});

describe('Always-allowed (ship integration)', () => {
  it('labels entries with origin + date and revokes through the diff modal into the local scope', async () => {
    mocks.previewRevokeRule.mockResolvedValue({
      newContent: '{"permissions":{"allow":[]}}',
      preview: makePreview({ targetPath: LOCAL_FILE, baseHash: 'hash-l' }),
    });
    mocks.applySettingsEdit.mockResolvedValue({ targetPath: LOCAL_FILE, changed: true });
    await renderPage();

    const section = screen.getByRole('region', { name: 'Always-allowed rules' });
    expect(within(section).getByText(/written by ship-inbox on/)).toBeInTheDocument();

    fireEvent.click(within(section).getByRole('button', { name: 'Revoke rule Bash(git:*)' }));
    await waitFor(() =>
      expect(mocks.previewRevokeRule).toHaveBeenCalledWith({ project: PROJECT_DIR, rule: 'Bash(git:*)' }),
    );
    const dialog = await screen.findByRole('dialog', { name: "Revoke 'Bash(git:*)'" });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(mocks.applySettingsEdit).toHaveBeenCalledWith({
        scope: 'local',
        project: PROJECT_DIR,
        newContent: '{"permissions":{"allow":[]}}',
        baseHash: 'hash-l',
      }),
    );
    // the ledger refreshes after a successful revoke
    await waitFor(() => expect(mocks.fetchAlwaysAllowed).toHaveBeenCalledTimes(2));
  });

  it('shows the not-mounted empty state when the inbox contract is unavailable', async () => {
    mocks.fetchAlwaysAllowed.mockResolvedValue({ available: false, entries: [] });
    await renderPage();
    const section = screen.getByRole('region', { name: 'Always-allowed rules' });
    expect(within(section).getByText(/Inbox station not mounted/)).toBeInTheDocument();
  });
});

describe('Backups', () => {
  const BACKUP = {
    id: '20260706T010203Z--home_o_.claude_settings.json',
    path: 'C:/home/o/.suite/settings-backups/20260706T010203Z--home_o_.claude_settings.json',
    targetPath: 'C:\\home\\o\\.claude\\settings.json', // backslashes: exercises path normalization
    createdAt: '2026-07-06T01:02:03.000Z',
    bytes: 24,
  };

  it('restores by mapping the origin path onto a writable scope, through the diff modal', async () => {
    mocks.fetchSettingsBackups.mockResolvedValue([BACKUP]);
    mocks.fetchSettingsBackup.mockResolvedValue({ entry: BACKUP, content: '{"model":"sonnet"}' });
    mocks.previewSettingsEdit.mockResolvedValue(makePreview());
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: `Restore backup of ${BACKUP.targetPath}` }));
    await waitFor(() =>
      expect(mocks.previewSettingsEdit).toHaveBeenCalledWith({
        scope: 'user',
        project: undefined,
        newContent: '{"model":"sonnet"}',
      }),
    );
    expect(await screen.findByRole('dialog', { name: 'Restore backup into user settings' })).toBeInTheDocument();
  });

  it('falls back to read-only viewing when the origin path maps to no writable scope', async () => {
    const foreign = { ...BACKUP, targetPath: 'C:/elsewhere/.claude/settings.json' };
    mocks.fetchSettingsBackups.mockResolvedValue([foreign]);
    mocks.fetchSettingsBackup.mockResolvedValue({ entry: foreign, content: '{"model":"x"}' });
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: `Restore backup of ${foreign.targetPath}` }));
    expect(await screen.findByText(/Cannot map/)).toBeInTheDocument();
    expect(screen.getByLabelText('Backup content')).toHaveTextContent('{"model":"x"}');
    expect(mocks.previewSettingsEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Project picker', () => {
  it('persists the selection and refetches scoped data when changed', async () => {
    await renderPage();
    expect(window.localStorage.getItem('chartroom.settings.project')).toBe(PROJECT_DIR);

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '' } });
    await waitFor(() => expect(window.localStorage.getItem('chartroom.settings.project')).toBe(''));
    await waitFor(() => expect(mocks.fetchSettingsEffective).toHaveBeenLastCalledWith(undefined));
  });
});
