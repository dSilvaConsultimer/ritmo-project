/**
 * Provider-neutral AI abstraction. NOTHING in this file (or anywhere
 * outside `openai-provider.ts`) may import from the `openai` SDK — see
 * NON-NEGOTIABLE (Sprint 4): "the app/financial-engine never depends on
 * OpenAI SDK types directly." A future `AnthropicProvider` implements the
 * same `AIProvider` interface with zero changes to callers.
 */

/** Strict tool definition the orchestrator offers the model. `parameters` is a JSON Schema object (e.g. from `z.toJSONSchema()`), not a vendor-specific shape. */
export interface AIToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

/**
 * The neutral, provider-agnostic representation of one item in a
 * conversation turn — messages, the model's tool calls, and the
 * application's tool results. `AIProvider` implementations translate this
 * to/from their own vendor wire format internally; nothing outside a
 * provider implementation ever sees a vendor-specific type.
 */
export type AITurnItem =
  | { readonly type: "message"; readonly role: "user" | "assistant" | "system"; readonly content: string }
  | { readonly type: "tool_call"; readonly id: string; readonly name: string; readonly argumentsJson: string }
  | { readonly type: "tool_result"; readonly toolCallId: string; readonly name: string; readonly resultJson: string };

export interface AIGenerateOptions {
  readonly model: string;
  readonly instructions: string;
  readonly input: readonly AITurnItem[];
  readonly tools: readonly AIToolDefinition[];
}

export interface AIToolCallRequest {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
}

export type AIGenerateOutcome =
  | { readonly kind: "message"; readonly text: string }
  | { readonly kind: "tool_calls"; readonly toolCalls: readonly AIToolCallRequest[] };

export interface AIGenerateResult {
  readonly outcome: AIGenerateOutcome;
  /** The provider's own response identifier, if any — for debugging only, never the source of truth for history (see docs/AI-COPILOT.md). */
  readonly providerResponseId?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface AIProvider {
  readonly name: string;
  generate(options: AIGenerateOptions): Promise<AIGenerateResult>;
}

export type AIErrorCode =
  | "AI_CONFIGURATION_ERROR"
  | "AI_AUTHENTICATION_ERROR"
  | "AI_RATE_LIMITED"
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_TIMEOUT"
  | "AI_INVALID_TOOL_ARGUMENTS"
  | "AI_TOOL_EXECUTION_FAILED"
  | "AI_GROUNDING_FAILED"
  | "AI_UNKNOWN_ERROR";

/**
 * Normalized AI failure. Never carries an API key or raw request headers —
 * see NON-NEGOTIABLE (Sprint 4) "AI observability."
 */
export class AIError extends Error {
  readonly code: AIErrorCode;

  constructor(code: AIErrorCode, message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "AIError";
    this.code = code;
  }
}
