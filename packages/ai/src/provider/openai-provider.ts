import OpenAI from "openai";
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
} from "openai";
import type { ResponseInputItem, Tool } from "openai/resources/responses/responses";
import { DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_OPENAI_MODEL } from "../model-config";
import type { AIGenerateOptions, AIGenerateResult, AIProvider, AITurnItem } from "./types";
import { AIError } from "./types";

/**
 * The ONLY file in this repository allowed to import from the `openai`
 * SDK — see NON-NEGOTIABLE (Sprint 4): "the app/financial-engine never
 * depends on OpenAI SDK types directly." Everything this class exposes
 * (`AIGenerateOptions`/`AIGenerateResult`) is a plain, provider-neutral
 * shape defined in `./types`.
 *
 * Uses the Responses API exclusively (not Chat Completions) — see
 * `docs/AI-COPILOT.md`. Conversation state is reconstructed locally from
 * `AITurnItem[]` on every call (never `previous_response_id`) so the
 * application, not OpenAI, remains the source of truth for history — see
 * NON-NEGOTIABLE (Sprint 4): "no provider-locked conversation memory."
 */
export interface OpenAIProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  /** Sprint 9 Phase 5 (DEC-109) — ceiling on a single call's output tokens; see model-config.ts. */
  readonly maxOutputTokens?: number;
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly maxOutputTokens: number;

  constructor(options: OpenAIProviderOptions) {
    if (!options.apiKey) {
      throw new AIError("AI_CONFIGURATION_ERROR", "OpenAIProvider requires an apiKey.");
    }
    this.client = new OpenAI({ apiKey: options.apiKey });
    this.model = options.model ?? DEFAULT_OPENAI_MODEL;
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  }

  async generate(options: AIGenerateOptions): Promise<AIGenerateResult> {
    try {
      const response = await this.client.responses.create({
        model: options.model || this.model,
        instructions: options.instructions,
        input: options.input.map(toResponseInputItem),
        tools: options.tools.map(toOpenAITool),
        max_output_tokens: this.maxOutputTokens,
      });

      const toolCalls = response.output.filter(
        (item): item is Extract<(typeof response.output)[number], { type: "function_call" }> =>
          item.type === "function_call",
      );

      const usage = {
        ...(response.usage?.input_tokens !== undefined ? { inputTokens: response.usage.input_tokens } : {}),
        ...(response.usage?.output_tokens !== undefined ? { outputTokens: response.usage.output_tokens } : {}),
      };

      if (toolCalls.length > 0) {
        return {
          outcome: {
            kind: "tool_calls",
            toolCalls: toolCalls.map((call) => ({
              id: call.call_id,
              name: call.name,
              argumentsJson: call.arguments,
            })),
          },
          providerResponseId: response.id,
          ...usage,
        };
      }

      return {
        outcome: { kind: "message", text: response.output_text },
        providerResponseId: response.id,
        ...usage,
      };
    } catch (error) {
      throw normalizeOpenAIError(error);
    }
  }
}

function toResponseInputItem(item: AITurnItem): ResponseInputItem {
  switch (item.type) {
    case "message":
      return { type: "message", role: item.role, content: item.content };
    case "tool_call":
      return {
        type: "function_call",
        call_id: item.id,
        name: item.name,
        arguments: item.argumentsJson,
      };
    case "tool_result":
      return {
        type: "function_call_output",
        call_id: item.toolCallId,
        output: item.resultJson,
      };
  }
}

function toOpenAITool(tool: AIGenerateOptions["tools"][number]): Tool {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: true,
  };
}

/**
 * Maps SDK error classes to the application's normalized `AIErrorCode`
 * taxonomy. Never includes the API key or raw request headers in the
 * resulting message — see NON-NEGOTIABLE (Sprint 4) "AI observability."
 */
function normalizeOpenAIError(error: unknown): AIError {
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new AIError("AI_AUTHENTICATION_ERROR", "OpenAI authentication failed.", { cause: error });
  }
  if (error instanceof RateLimitError) {
    return new AIError("AI_RATE_LIMITED", "OpenAI rate limit exceeded.", { cause: error });
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new AIError("AI_TIMEOUT", "OpenAI request timed out.", { cause: error });
  }
  if (error instanceof APIConnectionError) {
    return new AIError("AI_PROVIDER_UNAVAILABLE", "Could not reach OpenAI.", { cause: error });
  }
  if (error instanceof BadRequestError) {
    return new AIError("AI_INVALID_TOOL_ARGUMENTS", "OpenAI rejected the request as malformed.", {
      cause: error,
    });
  }
  if (error instanceof InternalServerError) {
    return new AIError("AI_PROVIDER_UNAVAILABLE", "OpenAI reported an internal server error.", {
      cause: error,
    });
  }
  if (error instanceof AIError) {
    return error;
  }
  return new AIError("AI_UNKNOWN_ERROR", "Unexpected error calling OpenAI.", { cause: error });
}
