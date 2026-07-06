/**
 * Destructive-command classifier for voice approvals (VoiceBridge_Spec §6): destructive-class
 * commands require an explicit confirm phrase ("confirm publish"), never a bare "yes".
 *
 * NOTE (seam, parked as a DECISIONS-NEEDED FYI): the spec says these are "the same classifier
 * patterns the settings manager will use". The settings-manager package is being built in a
 * parallel wave -- importing it from here now would create a cross-package collision, so this
 * module carries its own minimal pattern list; unifying the two behind one shared module in
 * suite-conventions is a post-merge cleanup.
 */

export interface Classification {
  destructive: boolean;
  /** The confirm-phrase verb, e.g. 'publish' -> the caller must say "confirm publish". */
  verb?: string;
}

interface Rule {
  pattern: RegExp;
  verb: string;
}

/** Spec-named classes (§6): rm / force-push / publish / migrations, plus the obvious
 * neighbours (drop, hard reset, recursive remove variants on both shells). */
const RULES: Rule[] = [
  { pattern: /\bgit\s+push\b[^\n]*(--force\b|--force-with-lease\b|\s-f\b)/i, verb: 'force push' },
  { pattern: /\b(npm|pnpm|yarn)\s+publish\b/i, verb: 'publish' },
  { pattern: /\b(rm|rmdir|del|erase)\b|\bremove-item\b|\bunlink\b/i, verb: 'delete' },
  { pattern: /\bmigrat(e|ion|ions)\b/i, verb: 'migrate' },
  { pattern: /\bdrop\s+(table|database|schema|index)\b/i, verb: 'drop' },
  { pattern: /\bgit\s+reset\s+--hard\b|\bgit\s+clean\b/i, verb: 'hard reset' },
];

/** Extract the §3-allowed command metadata from a permission request's tool input -- shell
 * tools carry `command`; anything else is spoken as "use <ToolName>" (never inputs, which may
 * embed file contents). */
export function commandClipOf(toolName: string, toolInput: unknown): string {
  const input = toolInput as Record<string, unknown> | undefined;
  const command = typeof input?.command === 'string' ? input.command : undefined;
  if (command) {
    const firstLine = command.split('\n')[0].trim();
    return `\`${firstLine.length > 90 ? `${firstLine.slice(0, 90)}…` : firstLine}\``;
  }
  return `the ${toolName} tool`;
}

export function classifyPermission(toolName: string, toolInput: unknown): Classification {
  const input = toolInput as Record<string, unknown> | undefined;
  const command = typeof input?.command === 'string' ? input.command : '';
  const haystack = command || toolName;
  for (const rule of RULES) {
    if (rule.pattern.test(haystack)) return { destructive: true, verb: rule.verb };
  }
  return { destructive: false };
}

export function requiredConfirmPhrase(verb: string): string {
  return `confirm ${verb}`;
}

/** Case/whitespace-tolerant confirm-phrase check -- spoken input arrives transcribed. */
export function confirmPhraseMatches(given: string | undefined, verb: string): boolean {
  if (!given) return false;
  return given.trim().toLowerCase().replace(/\s+/g, ' ') === requiredConfirmPhrase(verb);
}
