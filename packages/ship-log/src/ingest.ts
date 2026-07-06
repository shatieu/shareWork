import { hookEventEnvelopeSchema } from 'suite-conventions';
import type { CaptureContext, CaptureEnvelope } from './capture.js';
import { onSessionEnd, onSessionStart, onStop } from './capture.js';
import { appendToUnknownSidecar } from './spool.js';

/** Hook event names this package actually understands (plan §1.1: SessionStart/Stop/SessionEnd
 * for phase 1; Notification/PermissionRequest/TaskCreated/TaskCompleted are registered as
 * forward-events by the plugin but ship-log only stores them generically for now -- packages 5-6
 * are the real consumers). */
const KNOWN_EVENTS = new Set(['SessionStart', 'Stop', 'SessionEnd']);

export class UnknownEnvelopeError extends Error {}

/**
 * Validate + route one raw wire envelope (plan §3.5/§3.8) -- the single ingest path shared by
 * the HTTP route and the spool drain. Unknown event names are stored verbatim in the
 * `events_unknown` sidecar (forward-compat, nothing dropped) rather than rejected; a genuinely
 * malformed envelope throws so the caller (route -> 400, drain -> unknown sidecar) can react.
 */
export async function ingestEnvelope(
  ctx: CaptureContext,
  raw: unknown,
  homeDir?: string,
): Promise<{ stored: 'captured' | 'unknown' }> {
  const parsed = hookEventEnvelopeSchema.parse(raw);

  if (!KNOWN_EVENTS.has(parsed.hook_event_name)) {
    appendToUnknownSidecar(parsed, homeDir);
    return { stored: 'unknown' };
  }

  const envelope: CaptureEnvelope = {
    hook_event_name: parsed.hook_event_name,
    session_id: parsed.session_id,
    cwd: parsed.cwd,
    transcript_path: parsed.transcript_path,
    emitted_at: parsed.emitted_at,
    payload: parsed.payload as Record<string, unknown>,
  };

  switch (envelope.hook_event_name) {
    case 'SessionStart':
      onSessionStart(ctx, envelope);
      break;
    case 'Stop':
      onStop(ctx, envelope);
      break;
    case 'SessionEnd':
      await onSessionEnd(ctx, envelope);
      break;
    default:
      // Unreachable given the KNOWN_EVENTS guard above.
      break;
  }

  return { stored: 'captured' };
}
