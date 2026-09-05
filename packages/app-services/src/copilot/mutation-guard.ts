/**
 * Deterministic, defense-in-depth guard for the explicit mutation policy —
 * see docs/AI-COPILOT.md, "Explicit mutation policy." Independent of LLM
 * judgment on purpose: the model choosing to call a mutation tool is not
 * by itself sufficient evidence of user intent, so the ORIGINAL triggering
 * user message text is re-checked here before any state-changing tool
 * actually runs. This is a heuristic, not full NLU — see NON-NEGOTIABLE
 * (Sprint 4): "do not over-engineer general NL verification."
 *
 * Biased toward the safe failure mode: when intent is ambiguous, this
 * returns `false` (do not mutate) rather than guessing yes.
 */

const HYPOTHETICAL_PATTERNS: readonly RegExp[] = [
  /\bwhat if\b/i,
  /\bcould i\b/i,
  /\bshould i\b/i,
  /\bwould i\b/i,
  /\bmight i\b/i,
  /\bhow much should\b/i,
  /\bwhat would happen\b/i,
  /\bis it ok(ay)? if i\b/i,
];

const EXPLICIT_ACTION_PATTERNS: readonly RegExp[] = [
  /\bi (just |already )?spent\b/i,
  /\bi paid\b/i,
  /\bi bought\b/i,
  /\brecord\b/i,
  /\breserve\b/i,
  /\badd it\b/i,
  /\bconfirm(ed)?\b/i,
  /\bi'?m (definitely )?going\b/i,
  /\bset (the |a )?budget\b/i,
];

/** True when the text contains a hypothetical/exploratory marker — a strong signal the message is NOT reporting a completed or decided action. */
export function containsHypotheticalLanguage(text: string): boolean {
  return HYPOTHETICAL_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * True only when the text contains an explicit-action marker AND no
 * hypothetical marker. Used to gate every MUTATION tool — see
 * `docs/AI-COPILOT.md`. Examples that must return true: "I spent BRL
 * 250.", "Record BRL 250 at Restaurant X.", "Reserve BRL 1,000 for the
 * beach.", "I'm definitely going to the beach September 25-27; add it."
 * Examples that must return false: "What if I spend BRL 250?", "Could I
 * reserve BRL 1,000?", "How much should I reserve for the beach?"
 */
export function hasExplicitMutationIntent(text: string): boolean {
  if (containsHypotheticalLanguage(text)) return false;
  return EXPLICIT_ACTION_PATTERNS.some((pattern) => pattern.test(text));
}
