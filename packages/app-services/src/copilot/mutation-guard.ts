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

// Sprint 4.5: PT-BR patterns alongside the original English ones — the
// Founder and most real users write in Portuguese. Accents are matched as
// optional (`[áa]`, `[íi]`, etc.) since casual typing often drops them.
const HYPOTHETICAL_PATTERNS: readonly RegExp[] = [
  // English
  /\bwhat if\b/i,
  /\bcould i\b/i,
  /\bshould i\b/i,
  /\bwould i\b/i,
  /\bmight i\b/i,
  /\bhow much should\b/i,
  /\bwhat would happen\b/i,
  /\bis it ok(ay)? if i\b/i,
  // Português (PT-BR)
  /\be se eu\b/i,
  /\bser[áa] que\b/i,
  /\bposso\b/i,
  // Portuguese frequently drops the subject pronoun ("Poderia reservar...?"
  // means "Could [I] reserve...?" without needing "eu") — matched as a
  // single word rather than requiring "eu" alongside it.
  /\bpoderia\b/i,
  /\bdeveria\b/i,
  /\bseria poss[íi]vel\b/i,
  /\bquanto (eu )?deveria\b/i,
];

const EXPLICIT_ACTION_PATTERNS: readonly RegExp[] = [
  // English
  /\bi (just |already )?spent\b/i,
  /\bi paid\b/i,
  /\bi bought\b/i,
  /\brecord\b/i,
  /\breserve\b/i,
  /\badd it\b/i,
  /\bconfirm(ed)?\b/i,
  /\bi'?m (definitely )?going\b/i,
  /\bset (the |a )?budget\b/i,
  // Português (PT-BR)
  /\bgastei\b/i,
  /\bacabei de\b/i,
  /\bpaguei\b/i,
  /\bcomprei\b/i,
  /\bregistr(e|ar|o|ei)\b/i,
  /\breserv(e|ar|a|ado|ei)\b/i,
  /\badicion(e|ar|a|ei)\b/i,
  /\bconfirm(o|ado|a|ar|ei)\b/i,
  /\bdefinitivamente\b/i,
  /\bdefin(a|e|ir|i)\s+(o\s+)?or[çc]amento\b/i,
  // Sprint 5: recommendation decisions (accept/modify/reject) — English
  /\baccept it\b/i,
  /\bi accept\b/i,
  /\bgo ahead\b/i,
  /\bi (don'?t|do not) want (this|it)\b/i,
  /\breject (it|this)\b/i,
  /\bi reject\b/i,
  // Português (PT-BR)
  /\bpode aceitar\b/i,
  /\baceito\b/i,
  /\bquero aceitar\b/i,
  /\bquero cancelar\b/i,
  /\bquero reduzir\b/i,
  /\bn[ãa]o quero\b/i,
  /\brejeito\b/i,
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
 * beach.", "I'm definitely going to the beach September 25-27; add it.",
 * "Gastei R$ 250 no Restaurante X.", "Reserve R$ 1.000 para a praia."
 * Examples that must return false: "What if I spend BRL 250?", "Could I
 * reserve BRL 1,000?", "How much should I reserve for the beach?",
 * "E se eu gastasse R$ 250?", "Poderia reservar R$ 1.000?", "Quanto eu
 * deveria reservar para a praia?"
 */
export function hasExplicitMutationIntent(text: string): boolean {
  if (containsHypotheticalLanguage(text)) return false;
  return EXPLICIT_ACTION_PATTERNS.some((pattern) => pattern.test(text));
}
