import { z } from "zod";
import { createId, type Id } from "@money-copilot/shared";
import type { AIProvider, AITurnItem, MessageRole, ToolExecutionStatus } from "@money-copilot/ai";
import { AIError } from "@money-copilot/ai";
import * as repo from "@money-copilot/persistence";
import type { Database } from "@money-copilot/persistence";
import { findTool, TOOL_REGISTRY, type ToolContext } from "./tools";
import { hasExplicitMutationIntent } from "./mutation-guard";
import { extractFinancialFacts, type FinancialFact } from "./facts";
import { buildFallbackResponseText, groundResponseText, type GroundingResult } from "./grounding";
import { CURRENT_SYSTEM_INSTRUCTIONS } from "./system-instructions";
import { appendMessage, getOrCreateConversation } from "./conversation-service";

/** Hard cap on tool-calling round-trips per turn — never loop forever. See docs/AI-COPILOT.md, "Conversation tool loop." */
export const MAX_TOOL_ITERATIONS = 6;

export interface ToolExecutionSummary {
  readonly name: string;
  readonly status: ToolExecutionStatus;
}

/** The structured assistant response — see docs/AI-COPILOT.md, "Structured assistant response." */
export interface CopilotResponse {
  readonly conversationId: string;
  readonly text: string;
  readonly financialFacts: readonly FinancialFact[];
  readonly warnings: readonly string[];
  readonly toolExecutions: readonly ToolExecutionSummary[];
  readonly groundingStatus: GroundingResult["status"];
}

export interface RunCopilotTurnInput {
  readonly db: Database;
  readonly financialProfileId: string;
  /** The date the deterministic tools should treat as "today." */
  readonly asOfDate: string;
  /** Omit to start a new conversation. */
  readonly conversationId?: string;
  readonly userMessageText: string;
  readonly aiProvider: AIProvider;
  readonly model: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function roleToLower(role: MessageRole): "user" | "assistant" | "system" {
  return role.toLowerCase() as "user" | "assistant" | "system";
}

const TOOL_DEFINITIONS = TOOL_REGISTRY.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: z.toJSONSchema(t.schema as z.ZodType) as Record<string, unknown>,
}));

interface RecordExecutionArgs {
  readonly db: Database;
  readonly conversationId: string;
  readonly requestMessageId: string;
  readonly toolName: string;
  readonly argumentsJson: string;
  readonly status: ToolExecutionStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly errorCategory?: string;
  readonly resultSummaryJson?: string;
}

async function recordToolExecution(args: RecordExecutionArgs): Promise<void> {
  await repo.insertAIToolExecution(args.db, {
    id: createId("ai-tool-execution"),
    conversationId: args.conversationId as Id<"conversation">,
    requestMessageId: args.requestMessageId as Id<"conversation-message">,
    toolName: args.toolName,
    argumentsJson: args.argumentsJson,
    status: args.status,
    startedAt: args.startedAt,
    ...(args.finishedAt ? { finishedAt: args.finishedAt } : {}),
    ...(args.errorCategory ? { errorCategory: args.errorCategory } : {}),
    ...(args.resultSummaryJson ? { resultSummaryJson: args.resultSummaryJson } : {}),
  });
}

/** Truncates a large tool result to a small structured audit reference — never stores a massive raw payload. */
function summarizeForAudit(result: unknown): string {
  const json = JSON.stringify(result) ?? "null";
  return json.length > 4000 ? `${json.slice(0, 4000)}…(truncated)` : json;
}

/**
 * The bounded AI tool-calling loop: load context, call the model, execute
 * any requested tools through the allowlist, feed results back, and repeat
 * until a final message or `MAX_TOOL_ITERATIONS` is reached. See
 * docs/AI-COPILOT.md, "Conversation tool loop."
 */
export async function runCopilotTurn(input: RunCopilotTurnInput): Promise<CopilotResponse> {
  const { db, financialProfileId, asOfDate, userMessageText, aiProvider, model } = input;

  const conversation = await getOrCreateConversation(db, financialProfileId, input.conversationId);
  const userMessage = await appendMessage(db, conversation.id, "USER", userMessageText);

  const history = await repo.listConversationMessages(db, conversation.id);
  let turnItems: AITurnItem[] = history.map((m) => ({
    type: "message",
    role: roleToLower(m.role),
    content: m.content,
  }));

  const toolContext: ToolContext = { db, financialProfileId, asOfDate };
  const facts: FinancialFact[] = [];
  const toolExecutions: ToolExecutionSummary[] = [];
  const warnings: string[] = [];

  let finalText: string | undefined;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const requestStartedAt = nowIso();
    let result;
    try {
      result = await aiProvider.generate({
        model,
        instructions: CURRENT_SYSTEM_INSTRUCTIONS,
        input: turnItems,
        tools: TOOL_DEFINITIONS,
      });
    } catch (error) {
      const aiError = error instanceof AIError ? error : new AIError("AI_UNKNOWN_ERROR", "Unexpected AI provider error.", { cause: error });
      await repo.insertAIRequestLog(db, {
        id: createId("ai-request"),
        conversationId: conversation.id,
        provider: aiProvider.name,
        model,
        startedAt: requestStartedAt,
        finishedAt: nowIso(),
        toolCallCount: 0,
        toolNames: [],
        success: false,
        errorCode: aiError.code,
      });
      throw aiError;
    }
    const requestFinishedAt = nowIso();

    if (result.outcome.kind === "message") {
      await repo.insertAIRequestLog(db, {
        id: createId("ai-request"),
        conversationId: conversation.id,
        provider: aiProvider.name,
        model,
        startedAt: requestStartedAt,
        finishedAt: requestFinishedAt,
        latencyMs: Date.parse(requestFinishedAt) - Date.parse(requestStartedAt),
        toolCallCount: 0,
        toolNames: [],
        success: true,
        ...(result.inputTokens !== undefined ? { inputTokens: result.inputTokens } : {}),
        ...(result.outputTokens !== undefined ? { outputTokens: result.outputTokens } : {}),
        ...(result.providerResponseId ? { providerResponseId: result.providerResponseId } : {}),
      });
      finalText = result.outcome.text;
      break;
    }

    const toolCalls = result.outcome.toolCalls;
    await repo.insertAIRequestLog(db, {
      id: createId("ai-request"),
      conversationId: conversation.id,
      provider: aiProvider.name,
      model,
      startedAt: requestStartedAt,
      finishedAt: requestFinishedAt,
      latencyMs: Date.parse(requestFinishedAt) - Date.parse(requestStartedAt),
      toolCallCount: toolCalls.length,
      toolNames: toolCalls.map((c) => c.name),
      success: true,
      ...(result.providerResponseId ? { providerResponseId: result.providerResponseId } : {}),
    });

    turnItems = [
      ...turnItems,
      ...toolCalls.map(
        (call): AITurnItem => ({ type: "tool_call", id: call.id, name: call.name, argumentsJson: call.argumentsJson }),
      ),
    ];

    for (const call of toolCalls) {
      const executionStartedAt = nowIso();
      const toolDef = findTool(call.name);

      if (!toolDef) {
        await recordToolExecution({
          db,
          conversationId: conversation.id,
          requestMessageId: userMessage.id,
          toolName: call.name,
          argumentsJson: call.argumentsJson,
          status: "INVALID_ARGUMENTS",
          startedAt: executionStartedAt,
          finishedAt: nowIso(),
          errorCategory: "AI_INVALID_TOOL_ARGUMENTS",
        });
        toolExecutions.push({ name: call.name, status: "INVALID_ARGUMENTS" });
        turnItems = [
          ...turnItems,
          { type: "tool_result", toolCallId: call.id, name: call.name, resultJson: JSON.stringify({ error: "Unknown tool." }) },
        ];
        continue;
      }

      let parsedArgs: unknown;
      try {
        const rawArgs: unknown = call.argumentsJson ? JSON.parse(call.argumentsJson) : {};
        parsedArgs = toolDef.schema.parse(rawArgs);
      } catch {
        await recordToolExecution({
          db,
          conversationId: conversation.id,
          requestMessageId: userMessage.id,
          toolName: call.name,
          argumentsJson: call.argumentsJson,
          status: "INVALID_ARGUMENTS",
          startedAt: executionStartedAt,
          finishedAt: nowIso(),
          errorCategory: "AI_INVALID_TOOL_ARGUMENTS",
        });
        toolExecutions.push({ name: call.name, status: "INVALID_ARGUMENTS" });
        turnItems = [
          ...turnItems,
          {
            type: "tool_result",
            toolCallId: call.id,
            name: call.name,
            resultJson: JSON.stringify({ error: "Arguments failed validation." }),
          },
        ];
        continue;
      }

      if (toolDef.kind === "MUTATION" && !hasExplicitMutationIntent(userMessageText)) {
        await recordToolExecution({
          db,
          conversationId: conversation.id,
          requestMessageId: userMessage.id,
          toolName: call.name,
          argumentsJson: JSON.stringify(parsedArgs),
          status: "FAILED",
          startedAt: executionStartedAt,
          finishedAt: nowIso(),
          errorCategory: "MUTATION_NOT_EXPLICIT",
        });
        toolExecutions.push({ name: call.name, status: "FAILED" });
        turnItems = [
          ...turnItems,
          {
            type: "tool_result",
            toolCallId: call.id,
            name: call.name,
            resultJson: JSON.stringify({
              error: "Not executed: the user's message did not contain an explicit, decided action.",
            }),
          },
        ];
        continue;
      }

      try {
        const toolResult = await toolDef.execute(toolContext, parsedArgs);
        await recordToolExecution({
          db,
          conversationId: conversation.id,
          requestMessageId: userMessage.id,
          toolName: call.name,
          argumentsJson: JSON.stringify(parsedArgs),
          status: "SUCCESS",
          startedAt: executionStartedAt,
          finishedAt: nowIso(),
          resultSummaryJson: summarizeForAudit(toolResult),
        });
        toolExecutions.push({ name: call.name, status: "SUCCESS" });
        facts.push(...extractFinancialFacts(call.name, toolResult));
        turnItems = [
          ...turnItems,
          { type: "tool_result", toolCallId: call.id, name: call.name, resultJson: JSON.stringify(toolResult) },
        ];
      } catch {
        await recordToolExecution({
          db,
          conversationId: conversation.id,
          requestMessageId: userMessage.id,
          toolName: call.name,
          argumentsJson: JSON.stringify(parsedArgs),
          status: "FAILED",
          startedAt: executionStartedAt,
          finishedAt: nowIso(),
          errorCategory: "AI_TOOL_EXECUTION_FAILED",
        });
        toolExecutions.push({ name: call.name, status: "FAILED" });
        turnItems = [
          ...turnItems,
          { type: "tool_result", toolCallId: call.id, name: call.name, resultJson: JSON.stringify({ error: "Tool execution failed." }) },
        ];
      }
    }
  }

  if (finalText === undefined) {
    finalText = buildFallbackResponseText(facts);
    warnings.push("Reached the maximum number of tool steps for this turn — showing the deterministic facts gathered so far.");
  }

  const grounding = groundResponseText(finalText, facts, userMessageText);
  let responseText = finalText;
  if (grounding.status === "FAILED") {
    responseText = buildFallbackResponseText(facts);
    warnings.push("The assistant's draft response contained unverified monetary figures and was replaced with a deterministic summary.");
  }

  await appendMessage(db, conversation.id, "ASSISTANT", responseText);

  return {
    conversationId: conversation.id,
    text: responseText,
    financialFacts: facts,
    warnings,
    toolExecutions,
    groundingStatus: grounding.status,
  };
}
