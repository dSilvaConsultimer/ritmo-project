/**
 * Model configuration is centralized here — never spread model-name
 * literals through business logic. See NON-NEGOTIABLE (Sprint 4): "no
 * auto-escalation to another model yet."
 */
export const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";

export function resolveOpenAIModel(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env["OPENAI_MODEL"]?.trim() || DEFAULT_OPENAI_MODEL;
}
