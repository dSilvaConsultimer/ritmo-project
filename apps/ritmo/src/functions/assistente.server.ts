import { z } from "zod";
import { AIError, OpenAIProvider, resolveOpenAIModel } from "@money-copilot/ai";
import {
  getDb,
  listConversationsForProfile,
  listMessagesForConversation,
  runCopilotTurn,
} from "@money-copilot/app-services";
import { getCurrentProfileContext } from "./profile.server";
import { resolveAsOfDate } from "./config";
import { checkRateLimit, RATE_LIMIT_POLICIES } from "./rate-limit.server";
import { logger } from "./logger.server";

/**
 * Server-only Assistente implementation. This file imports server-only
 * packages (OpenAI SDK, etc.) and must never be imported from client-context
 * code. The `.server.ts` suffix signals this to Vite's import protection.
 */

/**
 * Loads the profile's most recently updated conversation (if any) so the
 * chat can resume across page loads.
 */
export async function getAssistenteDataHandler() {
  const { financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();

  const conversations = await listConversationsForProfile(db, financialProfileId);
  const latest = conversations.at(-1) ?? null;
  const messages = latest
    ? await listMessagesForConversation(db, financialProfileId, latest.id)
    : [];

  return {
    conversationId: latest?.id ?? null,
    messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content })),
  };
}

export type AssistenteData = Awaited<ReturnType<typeof getAssistenteDataHandler>>;

export const sendMessageInput = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1),
});

export type SendMessageInput = z.infer<typeof sendMessageInput>;

/**
 * Plain function holding the real logic. Sends one real message to the
 * OpenAI-backed copilot orchestrator. `OPENAI_API_KEY` is read from
 * `process.env` on the server only.
 *
 * Exported separately from the createServerFn wrapper so the permanent
 * adversarial test suite can call it directly (createServerFn relies on
 * a build-time code-splitting transform that doesn't run under Vitest).
 */
export async function sendAssistenteMessageHandler(data: SendMessageInput) {
  const { financialProfileId } = await getCurrentProfileContext();

  // Sprint 9 Phase 5 (DEC-105, brief §5): AI abuse/cost protection, keyed by
  // the server-resolved profile id — never anything client-supplied, never
  // an email/IP. Burst first (catches a runaway loop fast), then the
  // broader hourly cost guardrail. Both a real limiter, not a UI-only
  // debounce.
  const burst = checkRateLimit(
    `ai:burst:${financialProfileId}`,
    RATE_LIMIT_POLICIES.aiCopilotBurst,
  );
  if (!burst.allowed) {
    logger.warn("ai_rate_limited", { financialProfileId, kind: "burst" });
    return {
      ok: false as const,
      error: {
        code: "AI_RATE_LIMITED",
        message:
          "Você está enviando mensagens rápido demais. Aguarde alguns segundos e tente de novo.",
      },
    };
  }
  const sustained = checkRateLimit(
    `ai:sustained:${financialProfileId}`,
    RATE_LIMIT_POLICIES.aiCopilotSustained,
  );
  if (!sustained.allowed) {
    logger.warn("ai_rate_limited", { financialProfileId, kind: "sustained" });
    return {
      ok: false as const,
      error: {
        code: "AI_RATE_LIMITED",
        message:
          "Você atingiu o limite de uso do assistente por agora. Tente novamente mais tarde.",
      },
    };
  }

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
      asOfDate: resolveAsOfDate(),
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
}

export type SendAssistenteMessageResult = Awaited<ReturnType<typeof sendAssistenteMessageHandler>>;
