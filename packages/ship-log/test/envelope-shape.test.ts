import { describe, expect, it } from 'vitest';
import { hookEventEnvelopeSchema, type HookEventEnvelope } from 'suite-conventions';

/**
 * Compile-time + runtime check that emit.mjs's literal envelope object shape (it can't import
 * `suite-conventions` at runtime -- stdlib-only rule, plan §3.2) actually satisfies
 * `HookEventEnvelope` (plan §1.4: "a unit test asserts the emitter's literal envelope object
 * satisfies the type"). If a future edit to `hookEventEnvelopeSchema` breaks compatibility with
 * what `emit.mjs` constructs, this file fails to typecheck/build -- not just at runtime.
 */
describe('HookEventEnvelope <-> emit.mjs literal shape', () => {
  it('a literal object built the same way emit.mjs builds it type-satisfies HookEventEnvelope and the zod schema', () => {
    const hookPayload = {
      hook_event_name: 'SessionStart',
      session_id: 'sess-shape-1',
      cwd: 'C:\\scratch\\repo',
      transcript_path: 'C:\\scratch\\repo\\transcript.jsonl',
      source: 'startup',
    };

    // Mirrors emit.mjs's `envelope` object construction verbatim.
    const envelope: HookEventEnvelope = {
      v: 1,
      hook_event_name: hookPayload.hook_event_name,
      session_id: hookPayload.session_id,
      transcript_path: hookPayload.transcript_path,
      cwd: hookPayload.cwd,
      emitted_at: new Date().toISOString(),
      payload: hookPayload,
    };

    const parsed = hookEventEnvelopeSchema.parse(envelope);
    expect(parsed.hook_event_name).toBe('SessionStart');
  });
});
