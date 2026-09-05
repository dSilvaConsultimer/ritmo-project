import { createId, type Id } from "@money-copilot/shared";
import type { Conversation, ConversationMessage, MessageRole } from "@money-copilot/ai";
import * as repo from "@money-copilot/persistence";
import type { Database } from "@money-copilot/persistence";

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Finds an existing conversation by id, or starts a new one for this
 * profile. The application (not any AI provider) owns this row — see
 * docs/AI-COPILOT.md, "No provider-locked conversation memory."
 */
export async function getOrCreateConversation(
  db: Database,
  financialProfileId: string,
  conversationId?: string,
): Promise<Conversation> {
  if (conversationId) {
    const existing = await repo.getConversationById(db, conversationId);
    if (existing) return existing;
  }

  const timestamp = nowIso();
  const conversation: Conversation = {
    id: createId("conversation"),
    financialProfileId: financialProfileId as Id<"financial-profile">,
    status: "ACTIVE",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await repo.upsertConversation(db, conversation);
  return conversation;
}

/** Appends a message and bumps the conversation's `updatedAt` — the full, app-owned history the tool loop reconstructs every turn from. */
export async function appendMessage(
  db: Database,
  conversationId: string,
  role: MessageRole,
  content: string,
): Promise<ConversationMessage> {
  const timestamp = nowIso();
  const message: ConversationMessage = {
    id: createId("conversation-message"),
    conversationId: conversationId as Id<"conversation">,
    role,
    content,
    createdAt: timestamp,
  };
  await repo.insertConversationMessage(db, message);

  const conversation = await repo.getConversationById(db, conversationId);
  if (conversation) {
    await repo.upsertConversation(db, { ...conversation, updatedAt: timestamp });
  }

  return message;
}

/** Conversations for a profile, most recently updated first — powers a conversation list in the UI. */
export async function listConversationsForProfile(
  db: Database,
  financialProfileId: string,
): Promise<Conversation[]> {
  return repo.listConversationsForProfile(db, financialProfileId);
}

/** Full message history for a conversation, oldest first — powers reloading the chat UI. */
export async function listMessagesForConversation(
  db: Database,
  conversationId: string,
): Promise<ConversationMessage[]> {
  return repo.listConversationMessages(db, conversationId);
}
