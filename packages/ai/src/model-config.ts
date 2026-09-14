/**
 * Model configuration is centralized here — never spread model-name
 * literals through business logic. See NON-NEGOTIABLE (Sprint 4): "no
 * auto-escalation to another model yet."
 */
export const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";

export function resolveOpenAIModel(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env["OPENAI_MODEL"]?.trim() || DEFAULT_OPENAI_MODEL;
}

/**
 * Sprint 9 Phase 5 (docs/DECISIONS.md DEC-109): a real, unbounded-output-
 * tokens gap found in `OpenAIProvider.generate` — `responses.create()` was
 * called with no `max_output_tokens` at all, so a single copilot turn had
 * no ceiling on OpenAI-side cost/latency. Generous enough for a real
 * financial-assistant answer (docs/AI-COPILOT.md's own scope — a few
 * paragraphs plus tool calls), centrally defined here rather than a magic
 * number inline, so it's one place to tune.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 2000;
