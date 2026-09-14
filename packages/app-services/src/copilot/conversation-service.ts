import { createId, type Id } from "@money-copilot/shared";
import type { Conversation, ConversationMessage, MessageRole } from "@money-copilot/ai";
import * as repo from "@money-copilot/persistence";
import type { Database } from "@money-copilot/persistence";
import { assertOwnedByProfile, ResourceNotFoundError } from "../ownership";

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Finds an existing conversation by id, or starts a new one for this
 * profile. The application (not any AI provider) owns this row — see
 * docs/AI-COPILOT.md, "No provider-locked conversation memory."
 *
 * Sprint 9: an explicitly-passed `conversationId` belonging to a DIFFERENT
 * profile throws `ResourceNotFoundError` rather than silently starting a
 * new conversation in its place — this was the most serious pre-Sprint-9
 * gap in the whole codebase (read+write access to another profile's entire
 * chat history via nothing more than a leaked/guessed conversation id).
 */
export async function getOrCreateConversation(
  db: Database,
  financialProfileId: string,
  conversationId?: string,
): Promise<Conversation> {
  if (conversationId) {
    const existing = await repo.getConversationById(db, conversationId);
    return assertOwnedByProfile(existing, financialProfileId, `conversation ${conversationId}`);
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

/**
 * Appends a message and bumps the conversation's `updatedAt` — the full,
 * app-owned history the tool loop reconstructs every turn from. Takes the
 * caller's own `financialProfileId` and verifies the conversation belongs
 * to it — never trusts that an upstream caller already checked (Sprint 9:
 * every function that touches a conversation by id verifies independently).
 */
export async function appendMessage(
  db: Database,
  financialProfileId: string,
  conversationId: string,
  role: MessageRole,
  content: string,
): Promise<ConversationMessage> {
  const conversation = assertOwnedByProfile(
    await repo.getConversationById(db, conversationId),
    financialProfileId,
    `conversation ${conversationId}`,
  );

  const timestamp = nowIso();
  const message: ConversationMessage = {
    id: createId("conversation-message"),
    conversationId: conversationId as Id<"conversation">,
    role,
    content,
    createdAt: timestamp,
  };
  await repo.insertConversationMessage(db, message);
  await repo.upsertConversation(db, { ...conversation, updatedAt: timestamp });

  return message;
}

/** Conversations for a profile, most recently updated first — powers a conversation list in the UI. */
export async function listConversationsForProfile(
  db: Database,
  financialProfileId: string,
): Promise<Conversation[]> {
  return repo.listConversationsForProfile(db, financialProfileId);
}

/**
 * Full message history for a conversation, oldest first — powers reloading
 * the chat UI and reconstructing the LLM's context every turn. Sprint 9:
 * takes the caller's own `financialProfileId` and verifies the conversation
 * belongs to it first — this is the exact function that would otherwise
 * hand one user's entire financial conversation history to another user's
 * browser/AI turn given nothing more than a guessed id.
 */
export async function listMessagesForConversation(
  db: Database,
  financialProfileId: string,
  conversationId: string,
): Promise<ConversationMessage[]> {
  const conversation = await repo.getConversationById(db, conversationId);
  if (!conversation || conversation.financialProfileId !== financialProfileId) {
    throw new ResourceNotFoundError(`conversation ${conversationId}`);
  }
  return repo.listConversationMessages(db, conversationId);
}
