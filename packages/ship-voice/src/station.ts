import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DECK_CLIENT_HEADER, type HostContext, type StationDescriptor } from 'suite-conventions';
import {
  defaultFleetControl,
  defaultFleetSource,
  resolveSessionName,
  type FleetControl,
  type FleetSource,
} from './fleet.js';
import {
  classifyPermission,
  commandClipOf,
  confirmPhraseMatches,
  requiredConfirmPhrase,
} from './classify.js';
import {
  renderAmbiguousSession,
  renderFleetStatus,
  renderLedgerAdded,
  renderLedgerStatus,
  renderNoSuchSession,
  renderReadBack,
  renderSessionStatus,
  renderWhatsNew,
  sentenceClip,
  speakableSessionName,
  stripForSpeech,
} from './speech.js';
import { defaultSpeechSummarizer, speakable, type SpeechSummarizer } from './speech-summarizer.js';

export interface ShipVoiceStationOptions {
  fleetSource?: FleetSource;
  fleetControl?: FleetControl;
  speechSummarizer?: SpeechSummarizer;
  now?: () => Date;
}

const sendBodySchema = z.object({
  name: z.string().min(1),
  text: z.string().min(1).max(20_000),
});

const dispatchBodySchema = z.object({
  repo: z.string().min(1),
  task: z.string().min(1).max(20_000),
});

/** §6: NO alwaysAllowRule key exists here at all -- "no 'always allow' by voice" is enforced by
 * schema (strict: unknown keys rejected), not by convention. */
const approveBodySchema = z
  .object({
    requestId: z.string().min(1),
    confirm: z.boolean().optional(),
    confirmPhrase: z.string().max(100).optional(),
  })
  .strict();

const denyBodySchema = z
  .object({
    requestId: z.string().min(1),
    message: z.string().max(2000).optional(),
  })
  .strict();

const ledgerAddBodySchema = z.object({
  title: z.string().min(1).max(500),
  project: z.string().max(200).optional(),
});

/** Pending permission shape as served by ship-inbox's own route (typed loosely on purpose --
 * ship-voice consumes the HTTP contract, never ship-inbox internals). */
interface PendingPermission {
  id: string;
  sessionId: string;
  cwd: string;
  toolName: string;
  toolInput?: unknown;
  status: string;
}

interface LogEntry {
  sessionId: string;
  project: string | null;
  summary: string;
  files: string[];
  createdAt: string;
}

function isoToday(now: () => Date): string {
  return now().toISOString().slice(0, 10);
}

/**
 * ship-voice as a mounted, headless Deck station (VoiceBridge_Spec §9.1 phase 1): the §3 voice
 * toolset over local HTTP under `/api/ship-voice/<tool_name>` (route names match the §3 tool
 * names 1:1 -- phase 2 registers them as ElevenLabs client tools verbatim). Every response
 * carries a `spoken` string; extras are §3-minimized metadata (names, counts, ids for
 * follow-up calls -- never file contents, paths, or diffs).
 *
 * Cross-station access: in-process contracts where the sibling offers one (`pendingCounts`,
 * `listItems`, `getRollup`); the sibling's own HTTP route via `app.inject` otherwise -- the §3
 * tools are specified as "mapped 1:1 onto Ship endpoints", and inject reuses the sibling's full
 * validation and side-effects (decision waiters, settings rails) with zero edits to sibling
 * stations. Inject calls set `host: '127.0.0.1'` (the hull's Host-allowlist rejects
 * light-my-request's default `localhost:80` once a real port is bound) and the `x-ship-deck`
 * header on mutations.
 */
export function createShipVoiceStation(options: ShipVoiceStationOptions = {}): StationDescriptor {
  const fleetSource = options.fleetSource ?? defaultFleetSource;
  const fleetControl = options.fleetControl ?? defaultFleetControl;
  const summarizer = options.speechSummarizer ?? defaultSpeechSummarizer;
  const now = options.now ?? (() => new Date());

  let appRef: FastifyInstance | undefined;

  const injectJson = async (
    method: 'GET' | 'POST',
    url: string,
    payload?: unknown,
  ): Promise<{ status: number; body: any }> => {
    if (!appRef) throw new Error('ship-voice: station not registered');
    const res = await appRef.inject({
      method,
      url,
      headers: { host: '127.0.0.1', [DECK_CLIENT_HEADER]: '1' },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    let body: any;
    try {
      body = res.json();
    } catch {
      body = undefined;
    }
    return { status: res.statusCode, body };
  };

  const pendingPermissions = async (): Promise<PendingPermission[]> => {
    const res = await injectJson('GET', '/api/ship-inbox/permissions?status=pending');
    return res.status === 200 && Array.isArray(res.body) ? (res.body as PendingPermission[]) : [];
  };

  const todayEntries = async (): Promise<LogEntry[]> => {
    const res = await injectJson('GET', `/api/ship-log/entries?date=${isoToday(now)}`);
    return res.status === 200 && Array.isArray(res.body) ? (res.body as LogEntry[]) : [];
  };

  return {
    name: 'ship-voice',
    // Headless: no Deck tab in phase 1 (the Comm's UI is the phone, phases 2-4).

    /** Fleet seam for the console (Ship_Spec §6, package 9): the exact fleet reader this station
     * itself uses (injected in tests, `claude agents --json` in production), offered as an
     * in-process contract -- siblings consume it via `getContract('ship-voice', 'fleetSource')`,
     * never by importing this package (suite-conventions' station discipline). */
    contracts: { fleetSource },

    registerRoutes(app: FastifyInstance, ctx: HostContext) {
      appRef = app;

      /* ── fleet_status (§3, the §9.1 acceptance tool) ── */
      app.get('/api/ship-voice/fleet_status', async () => {
        const sessions = await fleetSource.list();

        const pendingCounts = ctx.getContract<() => { permissionsPending: number; questionsOpen: number }>(
          'ship-inbox',
          'pendingCounts',
        );
        const pending = pendingCounts ? pendingCounts() : undefined;

        const getRollup = ctx.getContract<(date: string) => { digest_md: string } | undefined>(
          'ship-log',
          'getRollup',
        );
        const rollup = getRollup ? getRollup(isoToday(now)) : undefined;
        const todayLine = rollup
          ? await speakable(rollup.digest_md, "today's fleet changelog digest", summarizer)
          : undefined;

        const spoken = renderFleetStatus({ sessions, pending, todayLine });

        // §3 metadata extras: names/states + pending ids so the voice agent can follow up with
        // approve/deny without another lookup. Never payload contents.
        const pendingList = pending && pending.permissionsPending > 0 ? await pendingPermissions() : [];
        return {
          spoken,
          sessions: (sessions ?? []).map((s) => ({
            name: speakableSessionName(s),
            state: s.state ?? s.status ?? 'running',
          })),
          pending: pending ?? { permissionsPending: 0, questionsOpen: 0 },
          pendingRequests: pendingList.map((p) => ({
            requestId: p.id,
            command: commandClipOf(p.toolName, p.toolInput),
          })),
        };
      });

      /* ── session_status(name) ── */
      app.get<{ Querystring: { name?: string } }>(
        '/api/ship-voice/session_status',
        async (request, reply) => {
          const query = request.query.name?.trim();
          if (!query) {
            return reply.code(400).send({ spoken: 'Which session do you mean?', error: 'name required' });
          }
          const sessions = await fleetSource.list();
          if (sessions === null) {
            return { spoken: 'I can’t see the fleet right now. Try again in a moment.', resolved: false };
          }
          const { match, candidates } = resolveSessionName(query, sessions);
          if (!match) {
            if (candidates.length > 1) {
              return {
                spoken: renderAmbiguousSession(query, candidates),
                resolved: false,
                candidates: candidates.map((s) => speakableSessionName(s)),
              };
            }
            return { spoken: renderNoSuchSession(query), resolved: false };
          }

          // Latest ship-log entry for this session, if any: summary + file COUNT only (§3
          // minimization -- the paths themselves never reach the speech layer).
          const entries = await todayEntries();
          const latest = entries
            .filter((e) => e.sessionId === match.sessionId)
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
          const latestSummary = latest
            ? await speakable(latest.summary, 'this session’s latest changelog summary', summarizer)
            : undefined;

          return {
            spoken: renderSessionStatus({
              session: match,
              latestSummary,
              filesTouched: latest?.files.length,
            }),
            resolved: true,
            name: speakableSessionName(match),
          };
        },
      );

      /* ── send_to_session(name, text) ── */
      app.post('/api/ship-voice/send_to_session', async (request, reply) => {
        const parsed = sendBodySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ spoken: 'I didn’t catch that instruction.', error: parsed.error.message });
        }
        const sessions = await fleetSource.list();
        if (sessions === null) {
          return reply.code(502).send({ spoken: 'I can’t reach the fleet right now, so nothing was sent.', sent: false });
        }
        const { match, candidates } = resolveSessionName(parsed.data.name, sessions);
        if (!match) {
          if (candidates.length > 1) {
            return reply.code(409).send({
              spoken: renderAmbiguousSession(parsed.data.name, candidates),
              sent: false,
              candidates: candidates.map((s) => speakableSessionName(s)),
            });
          }
          return reply.code(404).send({ spoken: renderNoSuchSession(parsed.data.name), sent: false });
        }
        const ok = await fleetControl.send(match.sessionId, parsed.data.text);
        const name = speakableSessionName(match);
        if (!ok) {
          return reply.code(502).send({ spoken: `I couldn’t get through to ${name}.`, sent: false });
        }
        return { spoken: `Sent to ${name}.`, sent: true, name };
      });

      /* ── dispatch(repo, task) ── */
      app.post('/api/ship-voice/dispatch', async (request, reply) => {
        const parsed = dispatchBodySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ spoken: 'I need a repo and a task to dispatch.', error: parsed.error.message });
        }
        const { repo, task } = parsed.data;
        const repoName = repo.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? repo;
        const ok = await fleetControl.dispatch(repo, task);
        if (!ok) {
          return reply
            .code(502)
            .send({ spoken: `I couldn’t start a session on ${repoName} — is that repo path right?`, dispatched: false });
        }
        return {
          spoken: `Dispatched a new session on ${repoName}: ${sentenceClip(stripForSpeech(task), 120)}`,
          dispatched: true,
        };
      });

      /* ── approve(request_id) -- §6 read-back + confirm-phrase rails ── */
      app.post('/api/ship-voice/approve', async (request, reply) => {
        const parsed = approveBodySchema.safeParse(request.body);
        if (!parsed.success) {
          // Includes any attempt to smuggle an alwaysAllowRule-like key: strict schema (§6 "no
          // 'always allow' by voice").
          return reply.code(400).send({ spoken: 'I couldn’t take that approval.', error: parsed.error.message });
        }
        const { requestId, confirm, confirmPhrase } = parsed.data;

        const pending = await pendingPermissions();
        const item = pending.find((p) => p.id === requestId);
        if (!item) {
          return reply
            .code(404)
            .send({ spoken: 'I don’t see that permission request anymore — it may have been decided or expired.' });
        }

        const sessions = await fleetSource.list();
        const owner = sessions?.find((s) => s.sessionId === item.sessionId);
        const sessionName = owner
          ? speakableSessionName(owner)
          : speakableSessionName({ cwd: item.cwd });
        const clip = commandClipOf(item.toolName, item.toolInput);
        const classification = classifyPermission(item.toolName, item.toolInput);

        // Step 1 -- no confirm yet: read back, never execute (§6 "read back before executing").
        if (!confirm) {
          return {
            spoken: renderReadBack(sessionName, clip, classification),
            requestId,
            needsConfirmation: true,
            destructive: classification.destructive,
            ...(classification.destructive && classification.verb
              ? { confirmPhrase: requiredConfirmPhrase(classification.verb) }
              : {}),
          };
        }

        // Step 2 -- confirmed. Destructive class additionally demands the exact phrase.
        if (classification.destructive && classification.verb) {
          if (!confirmPhraseMatches(confirmPhrase, classification.verb)) {
            return reply.code(403).send({
              spoken: `For safety, say “${requiredConfirmPhrase(classification.verb)}” to approve that.`,
              requestId,
              needsConfirmation: true,
              destructive: true,
              confirmPhrase: requiredConfirmPhrase(classification.verb),
            });
          }
        }

        const decided = await injectJson('POST', `/api/ship-inbox/permissions/${requestId}/decision`, {
          behavior: 'allow',
        });
        if (decided.status === 409) {
          return reply.code(409).send({ spoken: 'That request was already decided.' });
        }
        if (decided.status !== 200) {
          return reply.code(502).send({ spoken: 'The approval didn’t go through. It’s still pending.' });
        }
        return { spoken: `Approved. ${sessionName} is cleared to run ${clip}.`, requestId, decided: 'allowed' };
      });

      /* ── deny(request_id) ── */
      app.post('/api/ship-voice/deny', async (request, reply) => {
        const parsed = denyBodySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ spoken: 'I couldn’t take that denial.', error: parsed.error.message });
        }
        const { requestId, message } = parsed.data;
        const decided = await injectJson('POST', `/api/ship-inbox/permissions/${requestId}/decision`, {
          behavior: 'deny',
          ...(message ? { message } : {}),
        });
        if (decided.status === 404) {
          return reply.code(404).send({ spoken: 'I don’t see that permission request anymore.' });
        }
        if (decided.status === 409) {
          return reply.code(409).send({ spoken: 'That request was already decided.' });
        }
        if (decided.status !== 200) {
          return reply.code(502).send({ spoken: 'The denial didn’t go through. It’s still pending.' });
        }
        return { spoken: 'Denied. The session will not run it.', requestId, decided: 'denied' };
      });

      /* ── ledger_add(title, project?) ── */
      app.post('/api/ship-voice/ledger_add', async (request, reply) => {
        const parsed = ledgerAddBodySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ spoken: 'I couldn’t make a ledger item out of that.', error: parsed.error.message });
        }
        const created = await injectJson('POST', '/api/ship-ledger/items', {
          title: parsed.data.title,
          ...(parsed.data.project ? { project: parsed.data.project } : {}),
          source: 'human',
        });
        if (created.status !== 201) {
          return reply.code(502).send({ spoken: 'The ledger didn’t take that item.', added: false });
        }
        return { spoken: renderLedgerAdded(parsed.data.title), added: true, id: created.body.id };
      });

      /* ── ledger_status(query?) ── */
      app.get<{ Querystring: { query?: string } }>('/api/ship-voice/ledger_status', async (request) => {
        const listItems = ctx.getContract<
          (filter?: { project?: string; status?: string }) => Array<{
            id: string;
            title: string;
            status: string;
            project: string | null;
          }>
        >('ship-ledger', 'listItems');
        if (!listItems) {
          return { spoken: 'The ledger isn’t aboard right now.', items: [] };
        }
        const query = request.query.query?.trim();
        let items = listItems();
        if (query) {
          const q = query.toLowerCase();
          const tokens = q.split(/\s+/).filter(Boolean);
          items = items.filter((i) => {
            const hay = `${i.title} ${i.project ?? ''}`.toLowerCase();
            return tokens.some((t) => hay.includes(t));
          });
        } else {
          items = items.filter((i) => i.status !== 'done');
        }
        return {
          spoken: renderLedgerStatus(items, query),
          items: items.slice(0, 10).map((i) => ({ id: i.id, title: i.title, status: i.status })),
        };
      });

      /* ── whats_new() ── */
      app.get('/api/ship-voice/whats_new', async () => {
        const getRollup = ctx.getContract<(date: string) => { digest_md: string } | undefined>(
          'ship-log',
          'getRollup',
        );
        const rollup = getRollup ? getRollup(isoToday(now)) : undefined;
        const digestLine = rollup
          ? await speakable(rollup.digest_md, "today's fleet changelog digest", summarizer)
          : undefined;
        const entries = digestLine ? [] : await todayEntries();
        return {
          spoken: renderWhatsNew(
            digestLine,
            entries.map((e) => ({ project: e.project, summary: e.summary })),
          ),
          entryCount: rollup ? undefined : entries.length,
        };
      });

      /* ── health ── */
      app.get('/api/ship-voice/health', async () => ({
        ok: true,
        station: 'ship-voice',
        textMode: true,
      }));
    },
  };
}
