"use client";

import { useRef, useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";
import { answerClarification } from "@/app/actions/tasks";
import type {
  ClarificationAnswer,
  ClarificationAttachment,
  ClarificationQuestion,
} from "@/lib/clarification";
import { Loader2, Paperclip, X, ChevronUp, ChevronDown } from "lucide-react";

/**
 * Renders a `request_clarification` MCP call as an inline form on the task page — the hosted
 * counterpart of the standalone `ask-human` skill's local HTML page. Same question schema, same
 * answers.json shape, so an agent can reuse identical question objects in either mode.
 */

type AnswerValue = string | number | string[] | null;

export function ClarificationForm({
  taskId,
  requestId,
  questions,
  definerName,
  askedBy,
}: {
  taskId: string;
  requestId: string;
  questions: ClarificationQuestion[];
  /** The task's definer — the person these questions are addressed to. */
  definerName: string | null;
  /** Whoever's agent posted the request (usually the assignee), shown as context, not the target. */
  askedBy: string | null;
}) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(() => {
    const initial: Record<string, AnswerValue> = {};
    questions.forEach((q) => {
      if (q.type === "ranking") {
        initial[q.id] =
          Array.isArray(q.suggested) && q.suggested.length
            ? q.suggested
            : (q.choices ?? []).map((c) => c.value);
      } else if (q.suggested !== undefined) {
        initial[q.id] = q.suggested;
      } else {
        initial[q.id] = q.type === "multi-select" ? [] : null;
      }
    });
    return initial;
  });
  const [attachments, setAttachments] = useState<Record<string, ClarificationAttachment[]>>({});
  const [pending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setAnswer(id: string, value: AnswerValue) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function addFiles(qid: string, files: FileList | File[]) {
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments((prev) => ({
          ...prev,
          [qid]: [
            ...(prev[qid] ?? []),
            { filename: file.name || "pasted.png", dataUrl: String(reader.result) },
          ],
        }));
      };
      reader.readAsDataURL(file);
    });
  }

  function removeAttachment(qid: string, idx: number) {
    setAttachments((prev) => ({
      ...prev,
      [qid]: (prev[qid] ?? []).filter((_, i) => i !== idx),
    }));
  }

  function handleSubmit() {
    setError(null);
    const payload: ClarificationAnswer[] = questions.map((q) => ({
      id: q.id,
      type: q.type,
      value: answers[q.id] ?? null,
      attachments: attachments[q.id] ?? [],
    }));
    startTransition(async () => {
      const result = await answerClarification(taskId, requestId, payload);
      if (result?.error) setError(result.error);
      else setSubmitted(true);
    });
  }

  if (submitted) {
    return (
      <Card className="border-primary/40">
        <CardContent className="p-4 text-sm text-muted-foreground">
          ✓ Answers sent — thanks!
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="text-base">
          {definerName ? `${definerName}'s input needed` : "Definer's input needed"}
        </CardTitle>
        {askedBy && (
          <p className="text-xs text-muted-foreground">Asked by {askedBy}&apos;s agent</p>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {questions.map((q) => (
          <div key={q.id} className="space-y-2 border-b pb-4 last:border-0 last:pb-0">
            <p className="text-sm font-medium">{q.prompt}</p>
            {q.context && <Markdown className="text-muted-foreground">{q.context}</Markdown>}
            <QuestionInput question={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />
            {q.allowAttachment !== false && (
              <AttachZone
                files={attachments[q.id] ?? []}
                onAdd={(files) => addFiles(q.id, files)}
                onRemove={(idx) => removeAttachment(q.id, idx)}
              />
            )}
          </div>
        ))}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button size="sm" disabled={pending} onClick={handleSubmit}>
          {pending && <Loader2 className="animate-spin" />}
          Submit answers
        </Button>
      </CardContent>
    </Card>
  );
}

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: ClarificationQuestion;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
}) {
  switch (question.type) {
    case "single-select":
      return (
        <SingleSelect question={question} value={value as string | null} onChange={onChange} />
      );
    case "multi-select":
      return (
        <MultiSelect
          question={question}
          value={(value as string[]) ?? []}
          onChange={onChange}
        />
      );
    case "text":
      return (
        <Textarea
          rows={2}
          placeholder={question.placeholder}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "yesno":
      return <YesNo value={value as string | null} onChange={onChange} />;
    case "rating":
      return <Rating question={question} value={value as number} onChange={onChange} />;
    case "ranking":
      return (
        <Ranking question={question} value={(value as string[]) ?? []} onChange={onChange} />
      );
    case "compare":
      return <Compare question={question} value={value as string | null} onChange={onChange} />;
    default:
      return null;
  }
}

function SingleSelect({
  question,
  value,
  onChange,
}: {
  question: ClarificationQuestion;
  value: string | null;
  onChange: (v: string) => void;
}) {
  const choices = question.choices ?? [];
  const isKnown = choices.some((c) => c.value === value);
  const isOther = !!question.allowOther && value != null && !isKnown;
  const [otherText, setOtherText] = useState(isOther ? String(value) : "");

  return (
    <div className="space-y-1.5">
      {choices.map((c) => (
        <label key={c.value} className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            name={`q-${question.id}`}
            checked={value === c.value}
            onChange={() => onChange(c.value)}
            className="size-4"
          />
          {c.label}
        </label>
      ))}
      {question.allowOther && (
        <div className="space-y-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name={`q-${question.id}`}
              checked={isOther}
              onChange={() => onChange(otherText)}
              className="size-4"
            />
            Other
          </label>
          {isOther && (
            <input
              type="text"
              className="ml-6 w-[calc(100%-1.5rem)] rounded-md border border-input bg-background px-2 py-1 text-sm"
              value={otherText}
              onChange={(e) => {
                setOtherText(e.target.value);
                onChange(e.target.value);
              }}
              placeholder="Write your own..."
            />
          )}
        </div>
      )}
    </div>
  );
}

function MultiSelect({
  question,
  value,
  onChange,
}: {
  question: ClarificationQuestion;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const choices = question.choices ?? [];
  const knownValues = new Set(choices.map((c) => c.value));
  const [selected, setSelected] = useState<Set<string>>(
    new Set(value.filter((v) => knownValues.has(v)))
  );
  const unknownInitial = value.find((v) => !knownValues.has(v));
  const [otherChecked, setOtherChecked] = useState(!!unknownInitial);
  const [otherText, setOtherText] = useState(unknownInitial ?? "");

  function emit(nextSelected: Set<string>, nextOtherChecked: boolean, nextOtherText: string) {
    const arr = Array.from(nextSelected);
    if (nextOtherChecked && nextOtherText.trim()) arr.push(nextOtherText.trim());
    onChange(arr);
  }

  function toggle(v: string) {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setSelected(next);
    emit(next, otherChecked, otherText);
  }

  return (
    <div className="space-y-1.5">
      {choices.map((c) => (
        <label key={c.value} className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={selected.has(c.value)}
            onChange={() => toggle(c.value)}
            className="size-4"
          />
          {c.label}
        </label>
      ))}
      {question.allowOther && (
        <div className="space-y-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={otherChecked}
              onChange={(e) => {
                setOtherChecked(e.target.checked);
                emit(selected, e.target.checked, otherText);
              }}
              className="size-4"
            />
            Other
          </label>
          {otherChecked && (
            <input
              type="text"
              className="ml-6 w-[calc(100%-1.5rem)] rounded-md border border-input bg-background px-2 py-1 text-sm"
              value={otherText}
              onChange={(e) => {
                setOtherText(e.target.value);
                emit(selected, otherChecked, e.target.value);
              }}
              placeholder="Write your own..."
            />
          )}
        </div>
      )}
    </div>
  );
}

function YesNo({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  const options = [
    { key: "yes", label: "Yes" },
    { key: "no", label: "No" },
    { key: "unsure", label: "Unsure" },
  ];
  return (
    <div className="flex gap-2">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "flex-1 rounded-md border px-3 py-1.5 text-sm",
            value === o.key
              ? "border-primary bg-primary text-primary-foreground"
              : "border-input bg-background hover:bg-accent"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Rating({
  question,
  value,
  onChange,
}: {
  question: ClarificationQuestion;
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  const min = question.min ?? 1;
  const max = question.max ?? 10;
  const current = value ?? Math.round((min + max) / 2);
  return (
    <div className="space-y-1">
      <div className="text-center text-sm font-semibold">{current}</div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={current}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{question.minLabel ?? min}</span>
        <span>{question.maxLabel ?? max}</span>
      </div>
    </div>
  );
}

function Ranking({
  question,
  value,
  onChange,
}: {
  question: ClarificationQuestion;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const byValue = new Map((question.choices ?? []).map((c) => [c.value, c.label]));
  const order = value.length ? value : (question.choices ?? []).map((c) => c.value);

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <ol className="space-y-1.5">
      {order.map((v, i) => (
        <li
          key={v}
          className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        >
          <span className="text-muted-foreground">{i + 1}.</span>
          <span className="flex-1">{byValue.get(v) ?? v}</span>
          <button
            type="button"
            onClick={() => move(i, -1)}
            disabled={i === 0}
            className="rounded p-1 hover:bg-accent disabled:opacity-30"
          >
            <ChevronUp className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => move(i, 1)}
            disabled={i === order.length - 1}
            className="rounded p-1 hover:bg-accent disabled:opacity-30"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </li>
      ))}
    </ol>
  );
}

function Compare({
  question,
  value,
  onChange,
}: {
  question: ClarificationQuestion;
  value: string | null;
  onChange: (v: string) => void;
}) {
  const choices = question.choices ?? [];
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {choices.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => onChange(c.value)}
          className={cn(
            "rounded-md border p-3 text-left text-sm transition-colors",
            value === c.value ? "border-primary ring-1 ring-primary" : "border-input hover:bg-accent"
          )}
        >
          <div className="mb-1 font-medium">{c.label}</div>
          {c.context && <Markdown className="text-xs text-muted-foreground">{c.context}</Markdown>}
        </button>
      ))}
    </div>
  );
}

function AttachZone({
  files,
  onAdd,
  onRemove,
}: {
  files: ClarificationAttachment[];
  onAdd: (files: FileList | File[]) => void;
  onRemove: (idx: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onPaste={(e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const dropped: File[] = [];
        for (let i = 0; i < items.length; i++) {
          if (items[i].kind === "file") {
            const f = items[i].getAsFile();
            if (f) dropped.push(f);
          }
        }
        if (dropped.length) onAdd(dropped);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) onAdd(e.dataTransfer.files);
      }}
      className="cursor-pointer rounded-md border border-dashed border-input px-3 py-2 text-xs text-muted-foreground"
    >
      <Paperclip className="mr-1 inline size-3" /> Paste an image (Ctrl+V) or click to add a file
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) {
            onAdd(e.target.files);
            e.target.value = "";
          }
        }}
      />
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs"
            >
              {f.filename}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(i);
                }}
                className="text-destructive"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
