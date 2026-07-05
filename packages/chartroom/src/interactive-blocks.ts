// Shared extraction/classification/splice module for phase 4's three interactive constructs
// (plan §3.3): `:::ask-me` questions (reusing the ask-human skill's real schema vocabulary,
// SCHEMA.md), `:::actions` human-action items, and bare/nested GFM checklist checkboxes anywhere
// in a doc. Mirrors `segmentBlocks.ts`'s role from phase 3 (the single most correctness-critical
// new file in its own phase) but scans-and-splices rather than full-document segmentation.
//
// Exported for real, as executable code, via this package's own `"./interactive-blocks"` exports
// subpath (plan §2.1, approved in DECISIONS-NEEDED.md "Package 4") -- `chartroom-ui` imports this
// directly (not `import type`) so both the daemon and the browser bundle agree byte-for-byte on
// what counts as an ask-me/actions directive, how a `type="choice"` alias normalizes, how
// choices/checkbox ordinals are numbered, and how an answer is formatted. Its only dependencies
// (`unified`/`remark-parse`/`remark-gfm`/`remark-directive`) are the exact same packages
// `chartroom-ui` already bundles itself today, with zero Node-builtin usage anywhere in the chain.
//
// Every write helper here follows the same "re-parse fresh from the current raw string, locate the
// exact node by a stable address, splice narrowly against the original bytes" discipline as
// `fix-links.ts::computeLinkFixes`/`computeImageFixes` -- never a whole-tree re-render.

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import { nodeText, type AstNode, type OffsetRange } from './markdown.js';

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkDirective);

/** `remark-directive`'s own additions to the mdast node shape, not carried by the local `AstNode`
 * contract (plan §1.2) -- kept as a narrow local extension rather than widening `AstNode` itself,
 * since no other consumer of `AstNode` needs `name`/`attributes`. */
interface DirectiveAstNode extends AstNode {
  name?: string;
  attributes?: Record<string, string | null | undefined> | null;
}

/** The real ask-human schema's enforced type vocabulary (SCHEMA.md, `bin/server.mjs`'s own
 * `KNOWN_TYPES` set) -- the canonical, documented vocabulary going forward (plan §1.1 item 2). */
export type AskMeRealType = 'single-select' | 'multi-select' | 'text' | 'yesno' | 'rating' | 'ranking' | 'compare';

/** Backward-compatible aliases for the spec's own loose §4.1 prose/example (plan §1.1 item 1) --
 * `type="choice"` (the spec's own literal example) keeps working forever without modification. */
export const TYPE_ALIASES: Record<string, AskMeRealType> = {
  choice: 'single-select',
  'free-text': 'text',
  comparison: 'compare',
};

export const KNOWN_TYPES: ReadonlySet<string> = new Set<AskMeRealType>([
  'single-select',
  'multi-select',
  'text',
  'yesno',
  'rating',
  'ranking',
  'compare',
]);

/** Resolves a raw, as-authored `type=` attribute value to its canonical form -- an alias if one
 * matches, otherwise the value verbatim (an unrecognized type degrades gracefully elsewhere, it is
 * never rejected/thrown here, plan §1.1 item 4). */
export function normalizeType(rawType: string): string {
  return TYPE_ALIASES[rawType] ?? rawType;
}

export function isKnownType(type: string): type is AskMeRealType {
  return KNOWN_TYPES.has(type);
}

export interface Choice {
  value: string;
  label: string;
  /** `compare` only -- nested markdown source text (kept as real, re-renderable markdown, not a
   * hand-rolled mini-markdown regex, plan §4.1's `compare` row). */
  context?: string;
}

export interface AskMeQuestion {
  directiveId: string;
  /** normalized (alias-resolved) type -- may still be an unrecognized value if the doc's own
   * `type=` isn't in `KNOWN_TYPES`; callers must handle that gracefully (plan §1.1 item 4). */
  type: string;
  prompt: string;
  choices?: Choice[];
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  placeholder?: string;
  allowOther?: boolean;
  /** `text` type only -- an optional second paragraph read as a pre-fill suggestion (plan §4.1). */
  suggestedText?: string;
  answered: boolean;
  /** only present when `answered` -- the already-recorded `> **Answer** ...` line's own text. */
  answerText?: string;
  /** offset range of this directive's *entire* block (opening fence through closing fence),
   * against which `applyAskMeAnswer` splices -- nothing outside this range is ever touched. */
  blockRange: OffsetRange;
}

export interface ActionsItem {
  directiveId: string;
  label: string;
  checked: boolean;
  blockRange: OffsetRange;
}

export interface CheckboxScope {
  /** `null` for a bare (non-directive) checklist item; an `:::actions` directive's own `id`
   * attribute for a checkbox living inside one. */
  directiveId: string | null;
  /** 0-based ordinal -- whole-document order among bare items, or within-directive order among an
   * `:::actions` directive's own checkboxes (plan §3.2). */
  index: number;
}

export interface CheckboxRef {
  scope: CheckboxScope;
  checked: boolean;
  /** offset range of just the checkbox's own middle bracket character (`' '` &harr; `'x'`/`'X'`)
   * -- the narrowest possible single-character splice target (plan §1.4/§3.3). */
  bracketRange: OffsetRange;
}

export interface InteractiveBlocks {
  askMe: AskMeQuestion[];
  actions: ActionsItem[];
  checkboxes: CheckboxRef[];
}

function attr(node: DirectiveAstNode, name: string): string | undefined {
  const value = node.attributes?.[name];
  return value === null || value === undefined ? undefined : value;
}

function findRange(node: AstNode): OffsetRange | undefined {
  if (!node.position) return undefined;
  return { start: node.position.start.offset, end: node.position.end.offset };
}

/** `prompt` (every ask-me type, plan §4.1's final row): the first non-list top-level content
 * inside the directive body; a defensive placeholder if none is found, never a thrown error. */
function extractPrompt(children: AstNode[]): string {
  for (const child of children) {
    if (child.type === 'list') continue;
    const text = nodeText(child).trim();
    if (text.length > 0) return text;
  }
  return '(untitled question)';
}

function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'option';
}

function dedupeSlug(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  const slug = `${base}-${n}`;
  used.add(slug);
  return slug;
}

/** Extracts `Choice[]` from a directive body's own GFM list (plan §4.1's `choices` column).
 * `withContext` (compare only): any of a list item's own nested content beyond its first inline
 * child is kept as a raw markdown source slice (`context`), never re-parsed through a mini-markdown
 * regex the way `page.html.tmpl` has to. */
function extractChoicesFromList(raw: string, listNode: DirectiveAstNode, withContext: boolean): Choice[] {
  const used = new Set<string>();
  const choices: Choice[] = [];
  for (const itemNode of listNode.children ?? []) {
    const item = itemNode as DirectiveAstNode;
    const itemChildren = item.children ?? [];
    const firstChild = itemChildren[0];
    const labelText = (firstChild ? nodeText(firstChild) : nodeText(item)).trim();
    const value = dedupeSlug(slugify(labelText), used);
    const choice: Choice = { value, label: labelText };
    if (withContext && itemChildren.length > 1) {
      const rest = itemChildren.slice(1);
      const first = rest[0];
      const last = rest[rest.length - 1];
      if (first?.position && last?.position) {
        choice.context = raw.slice(first.position.start.offset, last.position.end.offset);
      }
    }
    choices.push(choice);
  }
  return choices;
}

/** Locates a `- [ ]`/`- [x]`/`- [X]` checkbox's own middle bracket character within a `listItem`
 * node's own already-known source slice (plan §1.4) -- the literal bracket substring is consumed
 * during GFM parsing and not retained as its own node, so this locates it the same "bounded regex
 * over the node's own known slice" way `fix-links.ts::findUrlOffset` locates an unretained href
 * sub-offset. Bounded to the first 20 characters after the item's own start (generous enough for
 * any realistic list-marker width -- "- ", "1. ", "999. ", ...) so a checkbox-shaped bracket
 * appearing later in the item's own prose text is never mistaken for the real one. */
function findCheckboxBracket(raw: string, item: AstNode): OffsetRange | undefined {
  if (!item.position) return undefined;
  const start = item.position.start.offset;
  const end = item.position.end.offset;
  const probeEnd = Math.min(end, start + 20);
  const slice = raw.slice(start, probeEnd);
  const match = /\[([ xX])\]/.exec(slice);
  if (!match) return undefined;
  const bracketCharOffset = start + match.index + 1;
  return { start: bracketCharOffset, end: bracketCharOffset + 1 };
}

function findFirstListItemText(node: AstNode): string | undefined {
  if (node.type === 'listItem') {
    return nodeText(node).trim();
  }
  for (const child of node.children ?? []) {
    const found = findFirstListItemText(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

function collectCheckboxesWithin(
  node: AstNode,
  raw: string,
  directiveId: string,
  counter: { n: number },
  out: CheckboxRef[],
): void {
  if (node.type === 'listItem' && node.checked !== null && node.checked !== undefined) {
    const bracket = findCheckboxBracket(raw, node);
    if (bracket) {
      out.push({ scope: { directiveId, index: counter.n }, checked: node.checked, bracketRange: bracket });
      counter.n += 1;
    }
  }
  for (const child of node.children ?? []) {
    collectCheckboxesWithin(child, raw, directiveId, counter, out);
  }
}

/**
 * Single-pass extraction over a raw doc's parsed tree (plan §3.3). Never throws on unusual/
 * unrecognized directive shapes -- an unknown `type=` value degrades to a question object with no
 * `choices`/bounds rather than an exception (plan §1.1 item 4).
 */
export function extractInteractiveBlocks(raw: string): InteractiveBlocks {
  const tree = processor.parse(raw) as unknown as DirectiveAstNode;
  const askMe: AskMeQuestion[] = [];
  const actions: ActionsItem[] = [];
  const checkboxes: CheckboxRef[] = [];
  let bareCounter = 0;

  function handleAskMe(node: DirectiveAstNode): void {
    const directiveId = attr(node, 'id') ?? '';
    const rawType = attr(node, 'type') ?? '';
    const type = normalizeType(rawType);
    const answered = attr(node, 'answered') === 'true';
    const children = node.children ?? [];
    const prompt = extractPrompt(children);
    const listNode = children.find((c) => c.type === 'list') as DirectiveAstNode | undefined;

    const question: AskMeQuestion = {
      directiveId,
      type,
      prompt,
      answered,
      blockRange: findRange(node) ?? { start: 0, end: 0 },
    };

    if (type === 'single-select' || type === 'multi-select') {
      if (listNode) question.choices = extractChoicesFromList(raw, listNode, false);
      const allowOtherAttr = attr(node, 'allowOther');
      if (allowOtherAttr !== undefined) question.allowOther = allowOtherAttr === 'true';
    } else if (type === 'ranking') {
      if (listNode) question.choices = extractChoicesFromList(raw, listNode, false);
    } else if (type === 'compare') {
      if (listNode) question.choices = extractChoicesFromList(raw, listNode, true);
    } else if (type === 'rating') {
      const minAttr = attr(node, 'min');
      const maxAttr = attr(node, 'max');
      question.min = minAttr !== undefined ? Number(minAttr) : 1;
      question.max = maxAttr !== undefined ? Number(maxAttr) : 10;
      const minLabel = attr(node, 'minLabel');
      const maxLabel = attr(node, 'maxLabel');
      if (minLabel !== undefined) question.minLabel = minLabel;
      if (maxLabel !== undefined) question.maxLabel = maxLabel;
    } else if (type === 'text') {
      const placeholder = attr(node, 'placeholder');
      if (placeholder !== undefined) question.placeholder = placeholder;
      const nonListChildren = children.filter((c) => c.type !== 'list');
      if (nonListChildren.length > 1) {
        const suggested = nodeText(nonListChildren[1]).trim();
        if (suggested) question.suggestedText = suggested;
      }
    }
    // yesno: nothing beyond the prompt is needed.

    if (answered) {
      const blockquote = children.find((c) => c.type === 'blockquote');
      if (blockquote) question.answerText = nodeText(blockquote).trim();
    }

    askMe.push(question);
  }

  function handleActions(node: DirectiveAstNode): void {
    const directiveId = attr(node, 'id') ?? '';
    const counter = { n: 0 };
    const localCheckboxes: CheckboxRef[] = [];
    for (const child of node.children ?? []) {
      collectCheckboxesWithin(child, raw, directiveId, counter, localCheckboxes);
    }
    checkboxes.push(...localCheckboxes);
    const label = findFirstListItemText(node) ?? '(untitled action)';
    actions.push({
      directiveId,
      label,
      checked: localCheckboxes[0]?.checked ?? false,
      blockRange: findRange(node) ?? { start: 0, end: 0 },
    });
  }

  function walk(node: DirectiveAstNode): void {
    if (node.type === 'containerDirective' && node.name === 'ask-me') {
      handleAskMe(node);
      return; // never descend into an ask-me body for bare-checkbox purposes (plan §4.2 item 2)
    }
    if (node.type === 'containerDirective' && node.name === 'actions') {
      handleActions(node);
      return; // its own checkboxes are already collected above, with their own directive-scoped counter
    }
    if (node.type === 'listItem' && node.checked !== null && node.checked !== undefined) {
      const bracket = findCheckboxBracket(raw, node);
      if (bracket) {
        checkboxes.push({ scope: { directiveId: null, index: bareCounter }, checked: node.checked, bracketRange: bracket });
        bareCounter += 1;
      }
    }
    for (const child of node.children ?? []) {
      walk(child as DirectiveAstNode);
    }
  }

  for (const child of tree.children ?? []) {
    walk(child);
  }

  return { askMe, actions, checkboxes };
}

function findCheckboxRef(checkboxes: CheckboxRef[], scope: CheckboxScope): CheckboxRef | undefined {
  return checkboxes.find((c) => c.scope.directiveId === scope.directiveId && c.scope.index === scope.index);
}

/**
 * Sets a single checkbox (bare or `:::actions`-scoped) to `checked`, re-parsing `raw` fresh and
 * locating the exact target by its stable `scope` address (plan §3.2/§3.3). Returns `undefined` if
 * no such scope/index exists in this document (route layer maps this to `404`) -- never a partial
 * or corrupt write. `before` reports the checkbox's state prior to this call, for the caller's own
 * optimistic-concurrency comparison against `expectedCurrent` (a route-layer concern, not this
 * function's own -- this function unconditionally sets the requested value).
 */
export function applyCheckboxToggle(
  raw: string,
  scope: CheckboxScope,
  checked: boolean,
): { newText: string; before: boolean } | undefined {
  const { checkboxes } = extractInteractiveBlocks(raw);
  const ref = findCheckboxRef(checkboxes, scope);
  if (!ref) return undefined;
  const { start, end } = ref.bracketRange;
  const char = checked ? 'x' : ' ';
  const newText = raw.slice(0, start) + char + raw.slice(end);
  return { newText, before: ref.checked };
}

function insertAnsweredAttr(fenceLine: string): string {
  const idx = fenceLine.lastIndexOf('}');
  if (idx === -1) {
    // Defensive: no attribute block on the opening fence at all (shouldn't happen for a directive
    // that was already located by its own `id` attribute) -- leave the fence line unchanged rather
    // than risk producing invalid directive syntax.
    return fenceLine;
  }
  return `${fenceLine.slice(0, idx)} answered="true"${fenceLine.slice(idx)}`;
}

/**
 * Splices a fully-formatted answer line (`formatAnswerLine`'s own output) into an `:::ask-me`
 * block, entirely within that block's own `{start, end}` span -- nothing outside it is ever
 * touched (plan §3.3/§3.5). Adds ` answered="true"` to the opening fence's attribute list and
 * appends the answer line as its own paragraph immediately before the closing fence, inserting a
 * blank line first only if the preceding line isn't already blank. Returns `undefined` if
 * `directiveId` doesn't resolve to any `:::ask-me` block in this document (route layer -> `404`).
 */
export function applyAskMeAnswer(raw: string, directiveId: string, answerLine: string): { newText: string } | undefined {
  const { askMe } = extractInteractiveBlocks(raw);
  const question = askMe.find((q) => q.directiveId === directiveId);
  if (!question) return undefined;

  const { start, end } = question.blockRange;
  const blockText = raw.slice(start, end);
  const lines = blockText.split('\n');
  if (lines.length < 2) return undefined; // defensive: every real directive block has >=2 fence lines

  const fenceLine = lines[0];
  const closeIdx = lines.length - 1;
  const closingLine = lines[closeIdx];
  const newFenceLine = insertAnsweredAttr(fenceLine);
  const bodyLines = lines.slice(1, closeIdx);
  const lastBodyLine = bodyLines.length > 0 ? bodyLines[bodyLines.length - 1] : '';
  const needsBlank = lastBodyLine.trim() !== '';

  const newBodyLines = [...bodyLines];
  if (needsBlank) newBodyLines.push('');
  newBodyLines.push(answerLine);

  const newBlockText = [newFenceLine, ...newBodyLines, closingLine].join('\n');
  const newText = raw.slice(0, start) + newBlockText + raw.slice(end);
  return { newText };
}

export type AskMeAnswerValue = string | string[] | number;

function choiceLabel(question: AskMeQuestion, value: string): string {
  const found = question.choices?.find((c) => c.value === value);
  return found ? found.label : value;
}

const YES_NO_LABELS: Record<string, string> = { yes: 'Yes', no: 'No', unsure: 'Unsure' };

/**
 * Turns a type-shaped answer value into the spec's human-readable blockquote text (plan §3.6) --
 * a pure, independently unit-tested function so the in-doc record stays "self-documenting" (an
 * agent reading the raw answer line gets prose, not a JSON blob to cross-reference).
 */
export function formatAnswerText(question: AskMeQuestion, value: AskMeAnswerValue): string {
  switch (question.type) {
    case 'single-select':
    case 'compare':
      return choiceLabel(question, String(value));
    case 'yesno':
      return YES_NO_LABELS[String(value)] ?? String(value);
    case 'multi-select': {
      const arr = Array.isArray(value) ? value : [value];
      return arr.map((v) => choiceLabel(question, String(v))).join(', ');
    }
    case 'rating': {
      const max = question.max ?? 10;
      return `${Number(value)}/${max}`;
    }
    case 'ranking': {
      const arr = Array.isArray(value) ? value : [value];
      return arr.map((v, i) => `${i + 1}. ${choiceLabel(question, String(v))}`).join(' ');
    }
    case 'text':
    default:
      return String(value);
  }
}

/** Full `> **Answer** (date, author): text` line (plan §3.5's literal example format). `date` is
 * expected pre-formatted `YYYY-MM-DD` by the caller (the daemon route, using its own current date
 * -- a small, deliberate readability choice over an ISO timestamp). */
export function formatAnswerLine(question: AskMeQuestion, value: AskMeAnswerValue, date: string, author: string): string {
  return `> **Answer** (${date}, ${author}): ${formatAnswerText(question, value)}`;
}

/**
 * Type-shape validation for a submitted ask-me answer value (plan §8.2's "reject a malformed body
 * rather than crash" posture) -- an unrecognized question type never validates (there is no known
 * shape to check an answer against), matching the graceful-fallback rendering rule (plan §1.1 item 4).
 */
export function validateAnswerValue(question: AskMeQuestion, value: unknown): boolean {
  switch (question.type) {
    case 'single-select':
    case 'compare':
    case 'text':
      return typeof value === 'string' && value.length > 0;
    case 'yesno':
      return value === 'yes' || value === 'no' || value === 'unsure';
    case 'multi-select':
    case 'ranking':
      return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string');
    case 'rating': {
      if (typeof value !== 'number' || Number.isNaN(value)) return false;
      const min = question.min ?? 1;
      const max = question.max ?? 10;
      return value >= min && value <= max;
    }
    default:
      return false;
  }
}
