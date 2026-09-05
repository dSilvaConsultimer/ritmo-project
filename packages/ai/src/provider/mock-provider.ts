import type { AIGenerateOptions, AIGenerateResult, AIProvider } from "./types";
import { AIError } from "./types";

export type MockAIProviderScript =
  | readonly AIGenerateResult[]
  | ((options: AIGenerateOptions, callIndex: number) => AIGenerateResult | Promise<AIGenerateResult>);

/**
 * A fully deterministic `AIProvider` for automated tests and the default
 * dev environment when no `OPENAI_API_KEY` is configured. Never calls any
 * network API. See NON-NEGOTIABLE (Sprint 4): "no secret required for
 * deterministic automated tests."
 *
 * Accepts either a fixed array of canned results (one per call, in order —
 * useful for scripting a multi-turn tool-calling loop) or a function for
 * dynamic scripting based on the actual input the orchestrator sent.
 */
export class MockAIProvider implements AIProvider {
  readonly name = "mock";
  private callIndex = 0;
  readonly calls: AIGenerateOptions[] = [];

  constructor(private readonly script: MockAIProviderScript) {}

  async generate(options: AIGenerateOptions): Promise<AIGenerateResult> {
    const index = this.callIndex;
    this.callIndex += 1;
    this.calls.push(options);

    if (Array.isArray(this.script)) {
      const result = this.script[index];
      if (!result) {
        throw new AIError(
          "AI_UNKNOWN_ERROR",
          `MockAIProvider script exhausted: no scripted result for call index ${index}`,
        );
      }
      return result;
    }

    return (this.script as Exclude<MockAIProviderScript, readonly AIGenerateResult[]>)(options, index);
  }
}

/** Convenience builder for a single final-text response, the most common script shape in tests. */
export function mockTextResult(text: string): AIGenerateResult {
  return { outcome: { kind: "message", text } };
}

/** Convenience builder for a tool-call response. */
export function mockToolCallResult(
  toolCalls: readonly { id: string; name: string; argumentsJson: string }[],
): AIGenerateResult {
  return { outcome: { kind: "tool_calls", toolCalls } };
}
