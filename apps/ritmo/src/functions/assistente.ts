import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AIError, OpenAIProvider, resolveOpenAIModel } from "@money-copilot/ai";
import {
  getDb,
  listConversationsForProfile,
  listMessagesForConversation,
  runCopilotTurn,
} from "@money-copilot/app-services";
import { getCurrentProfileContext } from "./profile-context";
import { ASOF_DATE } from "./config";

/**
 * Loads the profile's most recently updated conversation (if any) so the
 * chat can resume across page loads — same idea as apps/web's `/api/chat`
 * GET, via the same `@money-copilot/app-services` conversation service
 * (one source of truth, never a second conversation store).
 */
export const getAssistenteData = createServerFn({ method: "GET" }).handler(async () => {
  const { financialProfileId } = getCurrentProfileContext();
  const db = await getDb();

  const conversations = await listConversationsForProfile(db, financialProfileId);
  const latest = conversations.at(-1) ?? null;
  const messages = latest ? await listMessagesForConversation(db, latest.id) : [];

  return {
    conversationId: latest?.id ?? null,
    messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content })),
  };
});

export type AssistenteData = Awaited<ReturnType<typeof getAssistenteData>>;

const sendMessageInput = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1),
});

/**
 * Sends one real message to the same OpenAI-backed copilot orchestrator
 * apps/web's `/api/chat` uses (`runCopilotTurn`) — no AI orchestration is
 * re-implemented here, only invoked. `OPENAI_API_KEY` is read from
 * `process.env` on the server only; see `scripts/check-client-bundle.mjs`
 * for the automated check that it never reaches the browser bundle.
 */
export const sendAssistenteMessage = createServerFn({ method: "POST" })
  .validator(sendMessageInput)
  .handler(async ({ data }) => {
    const { financialProfileId } = getCurrentProfileContext();
    const db = await getDb();

    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) {
      return {
        ok: false as const,
        error: {
          code: "AI_CONFIGURATION_ERROR",
          message: "O assistente ainda não está configurado neste ambiente.",
        },
      };
    }

    const model = resolveOpenAIModel();
    const aiProvider = new OpenAIProvider({ apiKey, model });

    try {
      const response = await runCopilotTurn({
        db,
        financialProfileId,
        asOfDate: ASOF_DATE,
        ...(data.conversationId ? { conversationId: data.conversationId } : {}),
        userMessageText: data.message,
        aiProvider,
        model,
      });
      return {
        ok: true as const,
        conversationId: response.conversationId,
        text: response.text,
        financialFacts: response.financialFacts.map((f) => ({
          label: f.label,
          amountCents: f.amountCents,
          sourceTool: f.sourceTool,
          semanticType: f.semanticType,
        })),
      };
    } catch (error) {
      if (error instanceof AIError) {
        return { ok: false as const, error: { code: error.code, message: error.message } };
      }
      return {
        ok: false as const,
        error: { code: "AI_UNKNOWN_ERROR", message: "Ocorreu um erro inesperado." },
      };
    }
  });

export type SendAssistenteMessageResult = Awaited<ReturnType<typeof sendAssistenteMessage>>;
