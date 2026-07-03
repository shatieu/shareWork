import { z } from "zod";

/**
 * Shared shape for "ask a structured clarification question" — mirrors the schema used by the
 * standalone `ask-human` Claude Code skill (.claude/skills/ask-human/SCHEMA.md) so an agent can
 * write the same question objects whether it's running against a local page or this hosted app.
 */

export type ClarificationQuestionType =
  | "single-select"
  | "multi-select"
  | "text"
  | "yesno"
  | "rating"
  | "ranking"
  | "compare";

export type ClarificationChoice = {
  value: string;
  label: string;
  context?: string;
};

export type ClarificationQuestion = {
  id: string;
  type: ClarificationQuestionType;
  prompt: string;
  context?: string;
  suggested?: string | number | string[];
  allowAttachment?: boolean;
  allowOther?: boolean;
  choices?: ClarificationChoice[];
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  placeholder?: string;
};

export type ClarificationAttachment = {
  filename: string;
  dataUrl: string;
};

export type ClarificationAnswer = {
  id: string;
  type: ClarificationQuestionType;
  value: string | number | string[] | null;
  attachments?: ClarificationAttachment[];
};

export type ClarificationRequestPayload = {
  kind: "clarification_request";
  questions: ClarificationQuestion[];
};

export type ClarificationAnswerPayload = {
  kind: "clarification_answer";
  request_event_id: string;
  answers: ClarificationAnswer[];
};

const CHOICE_TYPES = new Set<ClarificationQuestionType>([
  "single-select",
  "multi-select",
  "compare",
]);

export const clarificationChoiceSchema = z.object({
  value: z.string(),
  label: z.string(),
  context: z.string().optional(),
});

export const clarificationQuestionSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum([
      "single-select",
      "multi-select",
      "text",
      "yesno",
      "rating",
      "ranking",
      "compare",
    ]),
    prompt: z.string().min(1),
    context: z.string().optional(),
    suggested: z.union([z.string(), z.number(), z.array(z.string())]).optional(),
    allowAttachment: z.boolean().optional(),
    allowOther: z.boolean().optional(),
    choices: z.array(clarificationChoiceSchema).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    minLabel: z.string().optional(),
    maxLabel: z.string().optional(),
    placeholder: z.string().optional(),
  })
  .refine(
    (q) => !CHOICE_TYPES.has(q.type) && q.type !== "ranking" ? true : !!q.choices?.length,
    { message: "choice-based questions need a non-empty choices array" }
  );

/** Narrow an unknown task_events.payload down to a clarification payload, or null. */
export function asClarificationRequest(
  payload: unknown
): ClarificationRequestPayload | null {
  const p = payload as Partial<ClarificationRequestPayload> | null;
  if (p && p.kind === "clarification_request" && Array.isArray(p.questions)) {
    return p as ClarificationRequestPayload;
  }
  return null;
}

export function asClarificationAnswer(
  payload: unknown
): ClarificationAnswerPayload | null {
  const p = payload as Partial<ClarificationAnswerPayload> | null;
  if (p && p.kind === "clarification_answer" && typeof p.request_event_id === "string") {
    return p as ClarificationAnswerPayload;
  }
  return null;
}
