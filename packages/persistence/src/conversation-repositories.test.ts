import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import type { AIToolExecution, Conversation, ConversationMessage } from "@money-copilot/ai";
import { createDatabase } from "./db";
import { runMigrations } from "./migrate";
import * as repo from "./repositories";

async function freshDb() {
  const db = await createDatabase();
  await runMigrations(db);
  return db;
}

async function seedProfile(db: Awaited<ReturnType<typeof freshDb>>) {
  const profileId = createId("financial-profile");
  await repo.upsertProfile(db, { id: profileId, label: "Test", createdAt: "2026-09-05" });
  return profileId;
}

describe("conversation persistence", () => {
  it("persists a conversation and reads it back with all fields intact", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);

    const conversation: Conversation = {
      id: createId("conversation"),
      financialProfileId: profileId,
      title: "Date night budget",
      status: "ACTIVE",
      createdAt: "2026-09-05T10:00:00.000Z",
      updatedAt: "2026-09-05T10:00:00.000Z",
    };

    await repo.upsertConversation(db, conversation);

    const found = await repo.getConversationById(db, conversation.id);
    expect(found).toEqual(conversation);
  });

  it("lists conversations for a profile, most recently updated first", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);

    const older: Conversation = {
      id: createId("conversation"),
      financialProfileId: profileId,
      status: "ACTIVE",
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    };
    const newer: Conversation = {
      id: createId("conversation"),
      financialProfileId: profileId,
      status: "ACTIVE",
      createdAt: "2026-09-05T10:00:00.000Z",
      updatedAt: "2026-09-05T10:00:00.000Z",
    };
    await repo.upsertConversation(db, older);
    await repo.upsertConversation(db, newer);

    const list = await repo.listConversationsForProfile(db, profileId);
    expect(list.map((c) => c.id)).toEqual([newer.id, older.id]);
  });

  it("omits title when unset rather than storing an empty string", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);

    const conversation: Conversation = {
      id: createId("conversation"),
      financialProfileId: profileId,
      status: "ACTIVE",
      createdAt: "2026-09-05T10:00:00.000Z",
      updatedAt: "2026-09-05T10:00:00.000Z",
    };
    await repo.upsertConversation(db, conversation);

    const found = await repo.getConversationById(db, conversation.id);
    expect(found?.title).toBeUndefined();
  });
});

describe("conversation message persistence", () => {
  it("persists messages in creation order — the exact history the tool loop reconstructs", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);
    const conversation: Conversation = {
      id: createId("conversation"),
      financialProfileId: profileId,
      status: "ACTIVE",
      createdAt: "2026-09-05T10:00:00.000Z",
      updatedAt: "2026-09-05T10:00:00.000Z",
    };
    await repo.upsertConversation(db, conversation);

    const userMessage: ConversationMessage = {
      id: createId("conversation-message"),
      conversationId: conversation.id,
      role: "USER",
      content: "How much can I spend today?",
      createdAt: "2026-09-05T10:00:01.000Z",
    };
    const assistantMessage: ConversationMessage = {
      id: createId("conversation-message"),
      conversationId: conversation.id,
      role: "ASSISTANT",
      content: "You can safely spend R$ 217.11 today.",
      createdAt: "2026-09-05T10:00:02.000Z",
    };

    await repo.insertConversationMessage(db, userMessage);
    await repo.insertConversationMessage(db, assistantMessage);

    const history = await repo.listConversationMessages(db, conversation.id);
    expect(history.map((m) => m.id)).toEqual([userMessage.id, assistantMessage.id]);
    expect(history.map((m) => m.role)).toEqual(["USER", "ASSISTANT"]);
  });
});

describe("AI tool execution audit persistence", () => {
  it("persists a tool execution with validated arguments and a structured result summary", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);
    const conversation: Conversation = {
      id: createId("conversation"),
      financialProfileId: profileId,
      status: "ACTIVE",
      createdAt: "2026-09-05T10:00:00.000Z",
      updatedAt: "2026-09-05T10:00:00.000Z",
    };
    await repo.upsertConversation(db, conversation);
    const message: ConversationMessage = {
      id: createId("conversation-message"),
      conversationId: conversation.id,
      role: "USER",
      content: "How much can I spend today?",
      createdAt: "2026-09-05T10:00:01.000Z",
    };
    await repo.insertConversationMessage(db, message);

    const execution: AIToolExecution = {
      id: createId("ai-tool-execution"),
      conversationId: conversation.id,
      requestMessageId: message.id,
      toolName: "getSafeToSpend",
      argumentsJson: JSON.stringify({}),
      status: "SUCCESS",
      resultSummaryJson: JSON.stringify({ safeToSpendCents: 217_111 }),
      startedAt: "2026-09-05T10:00:01.500Z",
      finishedAt: "2026-09-05T10:00:01.700Z",
    };

    await repo.insertAIToolExecution(db, execution);

    const executions = await repo.listAIToolExecutionsForConversation(db, conversation.id);
    expect(executions).toEqual([execution]);
  });

  it("never requires a resultSummaryJson — a failed execution can omit it", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);
    const conversation: Conversation = {
      id: createId("conversation"),
      financialProfileId: profileId,
      status: "ACTIVE",
      createdAt: "2026-09-05T10:00:00.000Z",
      updatedAt: "2026-09-05T10:00:00.000Z",
    };
    await repo.upsertConversation(db, conversation);
    const message: ConversationMessage = {
      id: createId("conversation-message"),
      conversationId: conversation.id,
      role: "USER",
      content: "Reserve R$ 1200 for the beach",
      createdAt: "2026-09-05T10:00:01.000Z",
    };
    await repo.insertConversationMessage(db, message);

    const failedExecution: AIToolExecution = {
      id: createId("ai-tool-execution"),
      conversationId: conversation.id,
      requestMessageId: message.id,
      toolName: "updatePlannedFinancialEvent",
      argumentsJson: JSON.stringify({ eventId: "does-not-exist" }),
      status: "FAILED",
      errorCategory: "AI_TOOL_EXECUTION_FAILED",
      startedAt: "2026-09-05T10:00:01.500Z",
    };

    await repo.insertAIToolExecution(db, failedExecution);

    const [found] = await repo.listAIToolExecutionsForConversation(db, conversation.id);
    expect(found?.resultSummaryJson).toBeUndefined();
    expect(found?.finishedAt).toBeUndefined();
    expect(found?.errorCategory).toBe("AI_TOOL_EXECUTION_FAILED");
  });
});

describe("AI request observability log persistence", () => {
  it("persists call metadata without ever storing a secret", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);
    const conversation: Conversation = {
      id: createId("conversation"),
      financialProfileId: profileId,
      status: "ACTIVE",
      createdAt: "2026-09-05T10:00:00.000Z",
      updatedAt: "2026-09-05T10:00:00.000Z",
    };
    await repo.upsertConversation(db, conversation);

    await repo.insertAIRequestLog(db, {
      id: createId("ai-request"),
      conversationId: conversation.id,
      provider: "openai",
      model: "gpt-5.6-terra",
      startedAt: "2026-09-05T10:00:00.000Z",
      finishedAt: "2026-09-05T10:00:01.200Z",
      latencyMs: 1200,
      toolCallCount: 1,
      toolNames: ["getSafeToSpend"],
      success: true,
      inputTokens: 512,
      outputTokens: 128,
      groundingStatus: "PASSED",
    });

    const [log] = await repo.listAIRequestLogsForConversation(db, conversation.id);
    expect(log?.provider).toBe("openai");
    expect(log?.toolNames).toEqual(["getSafeToSpend"]);
    expect(JSON.stringify(log)).not.toContain("sk-");
  });
});
