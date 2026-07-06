#!/usr/bin/env node
// Acceptance: package 07 (settings manager, Trio_Specs §B) -- the deterministic, CI-able form of
// the spec's centerpiece line:
//
//   "load the scopes, show the merged effective result, and answer: would `Bash(rm -rf ./dist)`
//    be allowed right now -- and which rule in which file decides?"
//
// ...plus the non-negotiable editor rails, live over the REAL spawned `ship serve` bin (hull +
// chartroom + ship-log + ship-ledger + ship-inbox + settings-manager) with an isolated
// HOME/USERPROFILE and a registered scratch repo. NOTHING faked:
//   - the simulator answers the spec question against real settings files across scopes, and a
//     byte/mtime snapshot proves the whole Q&A wrote nothing (the read-only guarantee);
//   - preview -> apply rides the rails: CSRF header, baseHash ticket, timestamped backup under
//     ~/.suite/settings-backups/, atomic replace;
//   - base drift and a malformed target are TYPED refusals leaving the file byte-identical;
//   - a template pack applies additively (seeded rules + unknown keys survive verbatim);
//   - revoke removes exactly one always-allow rule;
//   - the standalone read-only CLI answers the same spec question with exit code 1 on deny.
//
// Exit code: non-zero on any failed assertion.

import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIP_CLI = join(HERE, '..', '..', 'ship', 'dist', 'cli.js');
const SM_CLI = join(HERE, '..', 'dist', 'cli.js');

const DECK_HEADER = { 'x-ship-deck': '1' };

let failures = 0;
function assert(cond, label) {
  if (cond) console.log(`  ok  ${label}`);
  else {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(probe, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await probe();
      if (value !== undefined && value !== false) return value;
    } catch {
      /* keep polling */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await sleep(150);
  }
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) return undefined;
  return res.json();
}

async function postJson(url, body, headers = DECK_HEADER) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

async function main() {
  assert(existsSync(SHIP_CLI), `ship CLI built at ${SHIP_CLI} (run \`pnpm --filter ship build\`)`);
  assert(existsSync(SM_CLI), `settings-manager CLI built at ${SM_CLI} (run \`pnpm --filter settings-manager build\`)`);
  if (failures > 0) process.exit(1);

  const home = mkdtempSync(join(tmpdir(), 'sm-accept-home-'));
  const projectDir = mkdtempSync(join(tmpdir(), 'sm-accept-proj-'));

  // A registered scratch repo (the chartroom registry gates the settings write guard) with
  // settings across scopes: USER allows the exact command, PROJECT broadly denies `rm` -- the
  // spec question's interesting case (deny beats specific allow, across scopes).
  mkdirSync(join(projectDir, '.git'), { recursive: true });
  writeFileSync(join(projectDir, 'readme.md'), '---\nid: sm-accept\n---\n\n# scratch\n', 'utf8');
  mkdirSync(join(projectDir, '.claude'), { recursive: true });
  const projectSettings = `${JSON.stringify({ permissions: { deny: ['Bash(rm *)'] } }, null, 2)}\n`;
  writeFileSync(join(projectDir, '.claude', 'settings.json'), projectSettings, 'utf8');
  const localSeed = {
    permissions: { allow: ['WebFetch(domain:example.com)', 'Read'], deny: ['WebSearch'] },
    someUnknownKey: { keep: ['me', 'intact'] },
  };
  writeFileSync(join(projectDir, '.claude', 'settings.local.json'), `${JSON.stringify(localSeed, null, 2)}\n`, 'utf8');
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(
    join(home, '.claude', 'settings.json'),
    `${JSON.stringify({ permissions: { allow: ['Bash(rm -rf ./dist)'] } }, null, 2)}\n`,
    'utf8',
  );
  mkdirSync(join(home, '.chartroom'), { recursive: true });
  writeFileSync(
    join(home, '.chartroom', 'repos.json'),
    JSON.stringify({ repos: [{ id: 'sm-accept', absPath: projectDir, addedAt: 't' }] }, null, 2),
    'utf8',
  );

  const env = { ...process.env, USERPROFILE: home, HOME: home };
  const ship = spawn(process.execPath, [SHIP_CLI, 'serve'], { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  ship.stdout.on('data', (c) => (output += String(c)));
  ship.stderr.on('data', (c) => (output += String(c)));

  try {
    console.log('--- Phase 1: hull up, settings-manager mounted with the Settings tab ---');
    const port = await waitFor(() => {
      const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
      return m ? Number(m[1]) : undefined;
    }, 'ship serve to print its URL');
    const base = `http://127.0.0.1:${port}`;
    await waitFor(() => getJson(`${base}/api/settings-manager/health`), 'settings-manager health');
    const stations = await getJson(`${base}/api/hull/stations`);
    const sm = stations.find((s) => s.name === 'settings-manager');
    assert(sm?.tab?.id === 'settings' && sm.tab.title === 'Settings', 'settings-manager owns the Settings Deck tab');

    console.log('--- Phase 2: THE SPEC QUESTION (read-only, proven) ---');
    const claudeDirFiles = ['settings.json', 'settings.local.json'].map((n) => join(projectDir, '.claude', n));
    const snapshot = () =>
      [...claudeDirFiles, join(home, '.claude', 'settings.json')].map((f) => ({
        f,
        bytes: readFileSync(f, 'utf8'),
        mtime: statSync(f).mtimeMs,
      }));
    const before = JSON.stringify(snapshot());

    const verdict = (
      await postJson(`${base}/api/settings-manager/simulate`, {
        project: projectDir,
        tool: 'Bash',
        command: 'rm -rf ./dist',
      }, {})
    ).body;
    assert(verdict.behavior === 'deny', `simulate Bash(rm -rf ./dist) -> DENY (got ${verdict.behavior})`);
    assert(
      verdict.decidingRule?.rule === 'Bash(rm *)' &&
        verdict.decidingRule.scope === 'project' &&
        verdict.decidingRule.file === join(projectDir, '.claude', 'settings.json'),
      `deciding rule named with its file: '${verdict.decidingRule?.rule}' in ${verdict.decidingRule?.file}`,
    );
    assert(
      Array.isArray(verdict.caveats) && verdict.caveats.some((c) => c.includes('CLI-argument scope')),
      'verdict carries honest caveats (CLI scope not simulatable)',
    );

    const effective = await getJson(`${base}/api/settings-manager/effective?project=${encodeURIComponent(projectDir)}`);
    assert(
      effective.permissions.allow.some((r) => r.rule === 'Bash(rm -rf ./dist)' && r.scope === 'user') &&
        effective.permissions.deny.some((r) => r.rule === 'Bash(rm *)' && r.scope === 'project'),
      'effective view attributes every rule to its scope + file',
    );

    const compound = (
      await postJson(`${base}/api/settings-manager/simulate`, {
        project: projectDir,
        tool: 'Bash',
        command: 'git status && rm -rf ./dist',
      }, {})
    ).body;
    assert(
      compound.behavior === 'deny' && compound.decidingRule?.subcommand === 'rm -rf ./dist',
      'compound command: the denied subcommand is named',
    );
    assert(JSON.stringify(snapshot()) === before, 'READ-ONLY PROOF: simulator Q&A changed no byte and no mtime');

    console.log('--- Phase 3: the editor rails ---');
    const newContent = `${JSON.stringify({ permissions: { deny: ['Bash(rm *)'], allow: ['Bash(ls *)'] } }, null, 2)}\n`;
    const preview = (
      await postJson(`${base}/api/settings-manager/preview`, { scope: 'project', project: projectDir, newContent }, {})
    ).body;
    assert(preview.unifiedDiff.includes('+') && preview.baseHash.length === 64, 'preview returns a diff + baseHash ticket');

    const noHeader = await fetch(`${base}/api/settings-manager/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'project', project: projectDir, newContent, baseHash: preview.baseHash }),
    });
    assert(noHeader.status === 403, 'apply without x-ship-deck -> 403 (nothing written)');

    const applied = await postJson(`${base}/api/settings-manager/apply`, {
      scope: 'project',
      project: projectDir,
      newContent,
      baseHash: preview.baseHash,
    });
    assert(applied.status === 200 && applied.body.changed === true, 'apply with the ticket succeeds');
    assert(readFileSync(join(projectDir, '.claude', 'settings.json'), 'utf8') === newContent, 'target has exactly the new bytes');
    assert(
      applied.body.backupPath?.includes(join(home, '.suite', 'settings-backups')) &&
        readFileSync(applied.body.backupPath, 'utf8') === projectSettings,
      'timestamped backup under ~/.suite/settings-backups/ holds the ORIGINAL bytes',
    );

    const drift = await postJson(`${base}/api/settings-manager/apply`, {
      scope: 'project',
      project: projectDir,
      newContent: projectSettings,
      baseHash: preview.baseHash, // stale on purpose
    });
    assert(drift.status === 409 && drift.body.code === 'base-drift', 'stale ticket -> 409 base-drift');
    assert(readFileSync(join(projectDir, '.claude', 'settings.json'), 'utf8') === newContent, 'refusal left the file byte-identical');

    const malformedBytes = '{"permissions": {broken';
    writeFileSync(join(projectDir, '.claude', 'settings.local.json'), malformedBytes, 'utf8');
    const mPreview = (
      await postJson(`${base}/api/settings-manager/preview`, { scope: 'local', project: projectDir, newContent: '{}' }, {})
    ).body;
    assert(mPreview.baseMalformed === true, 'preview reports the malformed base');
    const mApply = await postJson(`${base}/api/settings-manager/apply`, {
      scope: 'local',
      project: projectDir,
      newContent: '{}',
      baseHash: mPreview.baseHash,
    });
    assert(mApply.status === 409 && mApply.body.code === 'malformed-target', 'malformed target -> 409 typed refusal');
    assert(readFileSync(join(projectDir, '.claude', 'settings.local.json'), 'utf8') === malformedBytes, 'malformed file untouched, byte-identical');
    // restore the seeded local settings for phase 4 (through the rails, with the recovery opt-in)
    const seedBytes = `${JSON.stringify(localSeed, null, 2)}\n`;
    const rPreview = (
      await postJson(`${base}/api/settings-manager/preview`, { scope: 'local', project: projectDir, newContent: seedBytes }, {})
    ).body;
    const rApply = await postJson(`${base}/api/settings-manager/apply`, {
      scope: 'local',
      project: projectDir,
      newContent: seedBytes,
      baseHash: rPreview.baseHash,
      overwriteMalformedBase: true,
    });
    assert(rApply.status === 200, 'explicit recovery opt-in replaces the corrupt file (corrupt bytes backed up)');

    console.log('--- Phase 4: template pack (additive) + revoke (subtractive), same rails ---');
    const tPreview = (
      await postJson(`${base}/api/settings-manager/templates/preview`, { id: 'read-only-audit', scope: 'local', project: projectDir }, {})
    ).body;
    const tApply = await postJson(`${base}/api/settings-manager/apply`, {
      scope: 'local',
      project: projectDir,
      newContent: tPreview.newContent,
      baseHash: tPreview.preview.baseHash,
    });
    const afterPack = JSON.parse(readFileSync(join(projectDir, '.claude', 'settings.local.json'), 'utf8'));
    assert(tApply.status === 200 && afterPack.permissions.deny.includes('Edit'), 'template pack applied with diff');
    assert(
      JSON.stringify(afterPack.someUnknownKey) === JSON.stringify(localSeed.someUnknownKey) &&
        afterPack.permissions.allow.slice(0, 2).join(',') === localSeed.permissions.allow.join(','),
      'additive: seeded rules + unknown keys survive verbatim',
    );

    const revPreview = (
      await postJson(`${base}/api/settings-manager/revoke/preview`, { project: projectDir, rule: 'WebFetch(domain:example.com)' }, {})
    ).body;
    const revApply = await postJson(`${base}/api/settings-manager/apply`, {
      scope: 'local',
      project: projectDir,
      newContent: revPreview.newContent,
      baseHash: revPreview.preview.baseHash,
    });
    const afterRevoke = JSON.parse(readFileSync(join(projectDir, '.claude', 'settings.local.json'), 'utf8'));
    assert(
      revApply.status === 200 &&
        !afterRevoke.permissions.allow.includes('WebFetch(domain:example.com)') &&
        afterRevoke.permissions.allow.includes('Read'),
      'revoke removed exactly the one rule',
    );

    const backups = await getJson(`${base}/api/settings-manager/backups`);
    assert(backups.length >= 4, `every replacing write left a backup (${backups.length} accumulated, none deleted)`);

    console.log('--- Phase 6 (package 14): the add-modal API chain, one batched write ---');
    const catalog = await getJson(`${base}/api/settings-manager/catalog`);
    assert(
      catalog.settings.length > 60 &&
        catalog.settings.some((e) => e.key === 'cleanupPeriodDays' && e.kind === 'number') &&
        catalog.ruleTemplates.some((t) => t.id === 'webfetch-domain') &&
        Array.isArray(catalog.modes),
      'GET /catalog serves the searchable catalog (settings + rule templates + modes)',
    );

    const addPreview = await postJson(`${base}/api/settings-manager/add/preview`, {
      scope: 'local',
      project: projectDir,
      additions: {
        values: { cleanupPeriodDays: 20, alwaysThinkingEnabled: true },
        defaultMode: 'acceptEdits',
        permissions: { deny: ['Bash(curl *)'] },
      },
    }, {});
    assert(
      addPreview.status === 200 &&
        addPreview.body.addedKeys.join(',') === 'cleanupPeriodDays,alwaysThinkingEnabled,permissions.defaultMode' &&
        addPreview.body.addedRules === 1 &&
        addPreview.body.preview.validation.ok === true,
      'add/preview batches 2 keys + defaultMode + 1 rule into one newContent with a diff',
    );
    const addApply = await postJson(`${base}/api/settings-manager/apply`, {
      scope: 'local',
      project: projectDir,
      newContent: addPreview.body.newContent,
      baseHash: addPreview.body.preview.baseHash,
    });
    const afterAdd = JSON.parse(readFileSync(join(projectDir, '.claude', 'settings.local.json'), 'utf8'));
    assert(
      addApply.status === 200 &&
        afterAdd.cleanupPeriodDays === 20 &&
        afterAdd.alwaysThinkingEnabled === true &&
        afterAdd.permissions.defaultMode === 'acceptEdits' &&
        afterAdd.permissions.deny.includes('Bash(curl *)') &&
        afterAdd.permissions.allow.includes('Read'),
      'ONE apply landed all additions; pre-existing rules survived',
    );
    const effectiveAfterAdd = await getJson(`${base}/api/settings-manager/effective?project=${encodeURIComponent(projectDir)}`);
    assert(
      effectiveAfterAdd.values.cleanupPeriodDays?.scope === 'local' &&
        effectiveAfterAdd.permissions.defaultMode?.value === 'acceptEdits',
      'effective view reflects the additions with local-scope attribution',
    );
    const overwritePreview = await postJson(`${base}/api/settings-manager/add/preview`, {
      scope: 'local',
      project: projectDir,
      additions: { values: { cleanupPeriodDays: 45 } },
    }, {});
    assert(
      overwritePreview.status === 200 &&
        overwritePreview.body.overwrittenKeys.join(',') === 'cleanupPeriodDays' &&
        overwritePreview.body.addedKeys.length === 0,
      'overwriting an existing key is reported as overwritten, visible before apply',
    );

    console.log('--- Phase 5: standalone read-only CLI answers the spec question ---');
    const cli = spawnSync(
      process.execPath,
      [SM_CLI, 'simulate', 'Bash', '--command', 'rm -rf ./dist', '--project', projectDir],
      { env, encoding: 'utf8' },
    );
    const cliVerdict = JSON.parse(cli.stdout);
    assert(
      cli.status === 1 && cliVerdict.behavior === 'deny' && cliVerdict.decidingRule.rule === 'Bash(rm *)',
      'CLI: deny verdict, deciding rule named, exit code 1',
    );
  } finally {
    ship.kill();
  }

  console.log(failures === 0 ? '\nACCEPTANCE PASS' : `\nACCEPTANCE FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`acceptance crashed: ${err.stack ?? err}`);
  process.exit(1);
});
