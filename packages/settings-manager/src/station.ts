import { homedir } from 'node:os';
import { resolve as resolvePath } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DECK_CLIENT_HEADER, type HostContext, type StationDescriptor } from 'suite-conventions';
import { getCatalog } from './catalog.js';
import {
  applyEdit,
  computeAddSettings,
  computeAdditiveRules,
  computeRemoveAllowRule,
  hashContent,
  listBackups,
  previewEdit,
  readBackup,
  SettingsEditError,
} from './editor.js';
import { computeEffectiveSettings } from './merge.js';
import { loadScopes, readScopeFile, scopePath, WRITABLE_SCOPES, type ScopeName, type WritableScopeName } from './scopes.js';
import { structuralSchema } from './schema.js';
import { simulate } from './simulator.js';
import { loadTemplatePacks } from './templates.js';

export interface SettingsManagerStationOptions {
  /** Home-directory override (user scope + backups root) -- tests never touch the real home. */
  homeDir?: string;
  /** Managed-settings path override (tests). */
  managedPath?: string;
  /** Project directories that may be read/written WITHOUT a chartroom station present
   * (standalone bin + tests). Under the hull, chartroom's `listRepoDirs` contract is the
   * authority and these are additive. */
  allowedProjectDirs?: string[];
  templatesDir?: string;
  now?: () => Date;
}

/** Chartroom's repo-list contract shape (typed loosely on purpose -- Ship_Spec §2 discipline:
 * stations never depend on each other's internals). */
type RepoDir = { id: string; name: string; absPath: string };

/** ship-inbox's always-allow origin contract shape (plan 07 §3 "Ship integration"). */
type AlwaysAllowedEntry = {
  rule: string;
  cwd: string;
  project: string | null;
  decidedAt: string | null;
  backupPath: string | null;
};

const scopeEnum = z.enum(['managed', 'local', 'project', 'user']);
const writableScopeEnum = z.enum(WRITABLE_SCOPES);

const simulateBodySchema = z.object({
  project: z.string().optional(),
  tool: z.string().min(1),
  command: z.string().optional(),
  path: z.string().optional(),
  url: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
});

const previewBodySchema = z.object({
  scope: writableScopeEnum,
  project: z.string().optional(),
  newContent: z.string().max(1_000_000),
});

const applyBodySchema = previewBodySchema.extend({
  baseHash: z.string().length(64),
  overwriteMalformedBase: z.boolean().optional(),
});

const templatePreviewBodySchema = z.object({
  id: z.string().min(1),
  scope: writableScopeEnum,
  project: z.string().optional(),
});

const addPreviewBodySchema = z.object({
  scope: writableScopeEnum,
  project: z.string().optional(),
  additions: z.object({
    values: z.record(z.string(), z.unknown()).optional(),
    defaultMode: z.string().optional(),
    permissions: z
      .object({
        allow: z.array(z.string().min(1).max(1000)).optional(),
        deny: z.array(z.string().min(1).max(1000)).optional(),
        ask: z.array(z.string().min(1).max(1000)).optional(),
      })
      .optional(),
  }),
});

const revokePreviewBodySchema = z.object({
  project: z.string().min(1),
  rule: z.string().min(1),
});

function editErrorStatus(code: SettingsEditError['code']): number {
  switch (code) {
    case 'base-drift':
    case 'malformed-target':
      return 409;
    case 'invalid-content':
    case 'schema-violation':
    case 'rule-not-found':
      return 400;
    default:
      return 500;
  }
}

/**
 * Settings manager as a mounted Deck station (Trio_Specs §B; plan 07 §3). Owns the Settings tab.
 * Routes under `/api/settings-manager/*`; mutations require the `x-ship-deck` header (hull CSRF
 * posture) AND pass the write-target guard: user scope always; project/local scopes only for
 * chartroom-registered repos (or the standalone allowlist) -- a local browser page must never be
 * able to write an arbitrary filesystem path. Managed + CLI scopes are never writable.
 */
export function createSettingsManagerStation(options: SettingsManagerStationOptions = {}): StationDescriptor {
  const homeDir = options.homeDir ?? homedir();
  const staticAllowed = (options.allowedProjectDirs ?? []).map((dir) => resolvePath(dir));

  /** Normalized-path equality; Windows paths are case-insensitive. */
  const samePath = (a: string, b: string): boolean =>
    process.platform === 'win32' ? resolvePath(a).toLowerCase() === resolvePath(b).toLowerCase() : resolvePath(a) === resolvePath(b);

  return {
    name: 'settings-manager',
    tab: { id: 'settings', title: 'Settings' },

    registerRoutes(app: FastifyInstance, ctx: HostContext) {
      const knownProjects = (): RepoDir[] => {
        const listRepoDirs = ctx.getContract<() => RepoDir[]>('chartroom', 'listRepoDirs');
        const fromChartroom = listRepoDirs ? listRepoDirs() : [];
        const extras = staticAllowed
          .filter((dir) => !fromChartroom.some((repo) => samePath(repo.absPath, dir)))
          .map((dir) => ({ id: dir, name: dir, absPath: dir }));
        return [...fromChartroom, ...extras];
      };

      /** The guard every project-scoped read AND write goes through. */
      const resolveProjectDir = (project: string | undefined, reply: FastifyReply): string | undefined | null => {
        if (project === undefined) return undefined;
        const match = knownProjects().find((repo) => samePath(repo.absPath, project) || repo.id === project);
        if (!match) {
          void reply.code(403).send({ error: `project is not a registered repo: ${project}` });
          return null;
        }
        return match.absPath;
      };

      const requireDeckHeader = (request: { headers: Record<string, unknown> }, reply: FastifyReply): boolean => {
        if (request.headers[DECK_CLIENT_HEADER] === undefined) {
          void reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
          return false;
        }
        return true;
      };

      const resolveTargetPath = (
        scope: WritableScopeName,
        project: string | undefined,
        reply: FastifyReply,
      ): string | null => {
        if (scope === 'user') {
          return scopePath('user', { homeDir })!;
        }
        if (project === undefined) {
          void reply.code(400).send({ error: `scope '${scope}' requires a project` });
          return null;
        }
        const projectDir = resolveProjectDir(project, reply);
        if (projectDir === null || projectDir === undefined) {
          if (projectDir === undefined) void reply.code(400).send({ error: 'project could not be resolved' });
          return null;
        }
        return scopePath(scope, { projectDir, homeDir })!;
      };

      const loadFor = (projectDir?: string) =>
        loadScopes({ projectDir, homeDir, managedPath: options.managedPath });

      /* ── read-only: scopes, effective view, simulator ── */

      app.get<{ Querystring: { project?: string } }>('/api/settings-manager/scopes', async (request, reply) => {
        const projectDir = resolveProjectDir(request.query.project, reply);
        if (projectDir === null) return reply;
        const scopes = loadFor(projectDir).map((scopeFile) => ({
          scope: scopeFile.scope,
          path: scopeFile.path,
          exists: scopeFile.exists,
          error: scopeFile.error,
          writable: (WRITABLE_SCOPES as readonly string[]).includes(scopeFile.scope),
          validation: scopeFile.settings ? structuralSchema.validate(scopeFile.settings) : undefined,
        }));
        return { scopes, projects: knownProjects(), schemaSource: structuralSchema.source };
      });

      app.get<{ Querystring: { project?: string } }>('/api/settings-manager/effective', async (request, reply) => {
        const projectDir = resolveProjectDir(request.query.project, reply);
        if (projectDir === null) return reply;
        return computeEffectiveSettings(loadFor(projectDir));
      });

      // POST because the hypothetical call is a structured body; still strictly read-only
      // (the simulator's read-only property is proven by dedicated tests).
      app.post('/api/settings-manager/simulate', async (request, reply) => {
        const parsed = simulateBodySchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
        const projectDir = resolveProjectDir(parsed.data.project, reply);
        if (projectDir === null) return reply;
        const scopes = loadFor(projectDir);
        const verdict = simulate(
          computeEffectiveSettings(scopes),
          {
            tool: parsed.data.tool,
            command: parsed.data.command,
            path: parsed.data.path,
            url: parsed.data.url,
            input: parsed.data.input,
          },
          { cwd: projectDir ?? process.cwd(), homeDir, projectDir },
        );
        return verdict;
      });

      /* ── editor: file → preview → apply, all through the rails ── */

      app.get<{ Querystring: { scope?: string; project?: string } }>(
        '/api/settings-manager/file',
        async (request, reply) => {
          const scopeParsed = scopeEnum.safeParse(request.query.scope);
          if (!scopeParsed.success) return reply.code(400).send({ error: `invalid scope '${request.query.scope}'` });
          const scope = scopeParsed.data as ScopeName;
          let path: string | undefined;
          if (scope === 'managed') {
            path = scopePath('managed', { managedPath: options.managedPath });
          } else if (scope === 'user') {
            path = scopePath('user', { homeDir });
          } else {
            const projectDir = resolveProjectDir(request.query.project, reply);
            if (projectDir === null) return reply;
            if (projectDir === undefined) return reply.code(400).send({ error: `scope '${scope}' requires a project` });
            path = scopePath(scope, { projectDir, homeDir });
          }
          const loaded = readScopeFile(scope, path!);
          return {
            scope,
            path: loaded.path,
            exists: loaded.exists,
            content: loaded.raw ?? '',
            error: loaded.error,
            baseHash: hashContent(loaded.raw),
            writable: (WRITABLE_SCOPES as readonly string[]).includes(scope),
          };
        },
      );

      app.post('/api/settings-manager/preview', async (request, reply) => {
        const parsed = previewBodySchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
        const targetPath = resolveTargetPath(parsed.data.scope, parsed.data.project, reply);
        if (targetPath === null) return reply;
        return previewEdit({ targetPath, newContent: parsed.data.newContent }, { homeDir });
      });

      app.post('/api/settings-manager/apply', async (request, reply) => {
        if (!requireDeckHeader(request, reply)) return reply;
        const parsed = applyBodySchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
        const targetPath = resolveTargetPath(parsed.data.scope, parsed.data.project, reply);
        if (targetPath === null) return reply;
        try {
          const result = applyEdit(
            {
              targetPath,
              newContent: parsed.data.newContent,
              baseHash: parsed.data.baseHash,
              overwriteMalformedBase: parsed.data.overwriteMalformedBase,
            },
            { homeDir, now: options.now },
          );
          ctx.log(
            `settings-manager: applied edit to ${result.targetPath} (changed=${result.changed}` +
              `${result.backupPath ? `, backup=${result.backupPath}` : ''})`,
          );
          return result;
        } catch (err) {
          if (err instanceof SettingsEditError) {
            return reply.code(editErrorStatus(err.code)).send({ error: err.message, code: err.code, details: err.details });
          }
          throw err;
        }
      });

      /* ── backups ── */

      app.get('/api/settings-manager/backups', async () => listBackups(homeDir));

      // Query-string id, not a path param: backup ids embed the sanitized origin path and can
      // exceed Fastify's default 100-char param ceiling (414 otherwise).
      app.get<{ Querystring: { id?: string } }>('/api/settings-manager/backup', async (request, reply) => {
        if (!request.query.id) return reply.code(400).send({ error: 'id is required' });
        const backup = readBackup(request.query.id, homeDir);
        if (!backup) return reply.code(404).send({ error: 'no such backup' });
        return backup;
      });

      /* ── add-modal: catalog + batched add preview (plan 14) ── */

      app.get('/api/settings-manager/catalog', async () => getCatalog());

      app.post('/api/settings-manager/add/preview', async (request, reply) => {
        const parsed = addPreviewBodySchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
        const targetPath = resolveTargetPath(parsed.data.scope, parsed.data.project, reply);
        if (targetPath === null) return reply;
        const current = readScopeFile(parsed.data.scope, targetPath);
        if (current.error) {
          return reply.code(409).send({ error: `target is malformed: ${current.error}`, code: 'malformed-target' });
        }
        try {
          const result = computeAddSettings(current.raw, parsed.data.additions);
          const preview = previewEdit({ targetPath, newContent: result.newContent }, { homeDir });
          return { ...result, preview };
        } catch (err) {
          if (err instanceof SettingsEditError) {
            return reply.code(editErrorStatus(err.code)).send({ error: err.message, code: err.code });
          }
          throw err;
        }
      });

      /* ── template packs ── */

      app.get('/api/settings-manager/templates', async () => loadTemplatePacks(options.templatesDir));

      app.post('/api/settings-manager/templates/preview', async (request, reply) => {
        const parsed = templatePreviewBodySchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
        const pack = loadTemplatePacks(options.templatesDir).find((candidate) => candidate.id === parsed.data.id);
        if (!pack) return reply.code(404).send({ error: `no such template pack: ${parsed.data.id}` });
        const targetPath = resolveTargetPath(parsed.data.scope, parsed.data.project, reply);
        if (targetPath === null) return reply;
        const current = readScopeFile(parsed.data.scope, targetPath);
        if (current.error) {
          return reply.code(409).send({ error: `target is malformed: ${current.error}`, code: 'malformed-target' });
        }
        try {
          const { newContent, addedRules } = computeAdditiveRules(current.raw, pack.permissions);
          const preview = previewEdit({ targetPath, newContent }, { homeDir });
          return { pack: { id: pack.id, name: pack.name, version: pack.version }, addedRules, newContent, preview };
        } catch (err) {
          if (err instanceof SettingsEditError) {
            return reply.code(editErrorStatus(err.code)).send({ error: err.message, code: err.code });
          }
          throw err;
        }
      });

      /* ── Ship integration: inbox-written always-allow rules, revocable ── */

      app.get('/api/settings-manager/always-allowed', async () => {
        const list = ctx.getContract<() => AlwaysAllowedEntry[]>('ship-inbox', 'alwaysAllowedRules');
        // Feature unavailable = empty, never an error (HostContext contract rule).
        return { entries: list ? list() : [], available: list !== undefined };
      });

      app.post('/api/settings-manager/revoke/preview', async (request, reply) => {
        const parsed = revokePreviewBodySchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
        const targetPath = resolveTargetPath('local', parsed.data.project, reply);
        if (targetPath === null) return reply;
        const current = readScopeFile('local', targetPath);
        if (!current.exists || current.raw === undefined) {
          return reply.code(404).send({ error: `no settings.local.json in ${parsed.data.project}` });
        }
        try {
          const newContent = computeRemoveAllowRule(current.raw, parsed.data.rule);
          const preview = previewEdit({ targetPath, newContent }, { homeDir });
          return { newContent, preview };
        } catch (err) {
          if (err instanceof SettingsEditError) {
            return reply.code(editErrorStatus(err.code)).send({ error: err.message, code: err.code });
          }
          throw err;
        }
      });

      app.get('/api/settings-manager/health', async () => ({
        ok: true,
        schemaSource: structuralSchema.source,
        backups: listBackups(homeDir).length,
        templates: loadTemplatePacks(options.templatesDir).length,
      }));
    },
  };
}
