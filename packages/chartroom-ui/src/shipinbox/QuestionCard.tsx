import { useState, type ReactElement } from 'react';
import type { ShipAgentQuestion } from '../api/client.js';
import { askHumanHash, type SessionDeliveryInfo } from '../api/inboxClient.js';

/** The /items question shape after wave2-E: open questions carry the pending ask-human form
 * session ids found under their cwd. */
export type InboxQuestion = ShipAgentQuestion & { askHumanPending?: string[] };

export interface QuestionCardProps {
  question: InboxQuestion;
  onAck: (id: string) => void;
  /** Resolves once the respond POST settles; the delivery info is what the server really did. */
  onRespond: (id: string, text: string) => Promise<SessionDeliveryInfo>;
}

/**
 * One agent question (defect D1 fixed): dismiss stays, but the card is now answerable -- a reply
 * box stores the response on the queue row and sends it to the asking session. The delivery
 * label is honest: the emitting Notification hook is long gone, so the reply lands on the
 * session's TRANSCRIPT (picked up on resume), never injected mid-task. When the question's repo
 * has pending ask-human forms, the card links to the Deck's ask-questions page.
 */
export function QuestionCard({ question, onAck, onRespond }: QuestionCardProps): ReactElement {
  const [replyOpen, setReplyOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [delivery, setDelivery] = useState<SessionDeliveryInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSend(): Promise<void> {
    setSending(true);
    setError(null);
    try {
      setDelivery(await onRespond(question.id, reply.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const pendingForms = question.askHumanPending ?? [];

  return (
    <div className="ship-inbox__question-card">
      <div className="ship-inbox__question-body">
        <span className={`inbox-page__kind ship-inbox__kind--${question.kind}`}>{question.kind}</span>
        <span className="inbox-page__label">{question.message || '(no message)'}</span>
        <span className="inbox-page__doc-path">
          {question.project ?? question.cwd} · session {question.sessionId.slice(0, 8)}
        </span>
        {pendingForms.map((formId) => (
          <a key={formId} className="ship-inbox__askhuman-link" href={askHumanHash(question.cwd, formId)}>
            answer questions: {formId}
          </a>
        ))}
      </div>
      {delivery === null ? (
        <div className="ship-inbox__actions">
          <button
            type="button"
            className="ship-inbox__btn"
            aria-expanded={replyOpen}
            onClick={() => setReplyOpen((open) => !open)}
          >
            reply…
          </button>
          <button
            type="button"
            className="ship-inbox__btn"
            onClick={() => onAck(question.id)}
            aria-label={`Dismiss question ${question.message}`}
          >
            dismiss
          </button>
        </div>
      ) : (
        <p className="ship-inbox__always-note" role="status">
          {delivery.delivered
            ? 'Reply saved and sent to the session’s transcript — it is read when the session next resumes, not mid-task.'
            : `Reply saved, but delivery failed${delivery.detail ? `: ${delivery.detail}` : ''}. It stays on the record here.`}
        </p>
      )}
      {delivery === null && replyOpen && (
        <div className="ship-inbox__always">
          <label className="ship-inbox__always-label">
            reply to session {question.sessionId.slice(0, 8)}
            <textarea
              className="ship-inbox__rule-input"
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              aria-label={`Reply to question ${question.message}`}
              rows={3}
            />
          </label>
          <button
            type="button"
            className="ship-inbox__btn ship-inbox__btn--allow"
            disabled={reply.trim().length === 0 || sending}
            onClick={() => void handleSend()}
          >
            {sending ? 'sending…' : 'send reply'}
          </button>
          <p className="ship-inbox__always-note">
            Delivered to the session&#8217;s transcript (picked up on its next resume) — not injected into
            the running task.
          </p>
          {error && (
            <p className="app-shell__error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
