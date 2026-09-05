import type { Id } from "@money-copilot/shared";

/**
 * Conversation/message/tool-audit entities the application owns.
 *
 * NON-NEGOTIABLE (Sprint 4): Money Copilot owns conversation history —
 * no AI provider's hosted state is the source of truth. These types have
 * no dependency on the OpenAI SDK or any other vendor wire format, so a
 * future `AnthropicProvider` (or anything else) can be dropped in without
 * touching persistence or the tool-execution audit trail.
 */

export type ConversationStatus = "ACTIVE" | "ARCHIVED";

export interface Conversation {
  readonly id: Id<"conversation">;
  readonly financialProfileId: Id<"financial-profile">;
  readonly title?: string;
  readonly status: ConversationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type MessageRole = "USER" | "ASSISTANT" | "SYSTEM";

export interface ConversationMessage {
  readonly id: Id<"conversation-message">;
  readonly conversationId: Id<"conversation">;
  readonly role: MessageRole;
  readonly content: string;
  readonly createdAt: string;
}

export type ToolExecutionStatus = "SUCCESS" | "FAILED" | "INVALID_ARGUMENTS" | "TIMEOUT";

/**
 * Audit record of one tool invocation. `argumentsJson` holds the
 * ALREADY-VALIDATED arguments (never trust model-generated arguments
 * without independent validation — see `docs/AI-COPILOT.md`).
 * `resultSummaryJson` is a small structured reference, never a full raw
 * provider/DB payload — see NON-NEGOTIABLE (Sprint 4): "avoid storing
 * massive raw tool responses where a structured audit reference suffices."
 * Never stores provider secrets.
 */
export interface AIToolExecution {
  readonly id: Id<"ai-tool-execution">;
  readonly conversationId: Id<"conversation">;
  readonly requestMessageId: Id<"conversation-message">;
  readonly toolName: string;
  readonly argumentsJson: string;
  readonly status: ToolExecutionStatus;
  readonly resultSummaryJson?: string;
  readonly errorCategory?: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
}

/**
 * One AI provider call's observability record — see NON-NEGOTIABLE
 * (Sprint 4) "AI observability": never logs the API key, full banking
 * payloads, or unnecessary financial history, only call metadata.
 */
export interface AIRequestLog {
  readonly id: Id<"ai-request">;
  readonly conversationId: Id<"conversation">;
  readonly provider: string;
  readonly model: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly latencyMs?: number;
  readonly toolCallCount: number;
  readonly toolNames: readonly string[];
  readonly success: boolean;
  readonly errorCode?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly groundingStatus?: "PASSED" | "FAILED" | "NOT_APPLICABLE";
  /** The provider's own response id, if useful for debugging — never relied on as the source of truth. */
  readonly providerResponseId?: string;
}
