import { z } from "zod";
import { AIError, OpenAIProvider, resolveOpenAIModel } from "@money-copilot/ai";
import { getDb, createCategory } from "@money-copilot/app-services";
import { getCurrentProfileContext } from "./profile.server";
import { resolveAsOfDate } from "./config";
import { checkRateLimit, RATE_LIMIT_POLICIES } from "./rate-limit.server";
import { logger } from "./logger.server";
import { createManualPlanningItemHandler } from "./planejamento-criar.server";

/**
 * Server-only AI-assisted planning creation (Planejamento → "Criar com
 * IA"). Deliberately a single-shot structured-interpretation call, not the
 * multi-turn conversational copilot (`runCopilotTurn`) — the UX here is
 * "interpret once, show a review card, save only on explicit confirm,"
 * which the chat orchestrator has no concept of. Reuses the SAME
 * provider-neutral `AIProvider`/`OpenAIProvider` abstraction the copilot
 * uses (`@money-copilot/ai`) and, critically, the exact same persistence
 * path manual creation uses (`createManualPlanningItemHandler`) for the
 * actual save — the AI only ever produces a DRAFT the user must confirm;
 * it never persists anything itself. The `.server.ts` suffix signals this
 * file is server-only to Vite's import protection.
 */

const planningDraftSchema = z.object({
  kind: z.enum(["event", "fixed_expense"]),
  label: z.string().min(1).max(120),
  /** Reais, never cents. `null` when the user didn't state a number — never guessed. */
  amountReais: z.number().positive().nullable().default(null),
  /** Only meaningful for a recurring commitment. */
  category: z.string().min(1).max(60).nullable().default(null),
  /** ISO "YYYY-MM-DD". Only meaningful for a one-off event. */
  startDate: z.string().nullable().default(null),
  endDate: z.string().nullable().default(null),
  /** 1-31. Optional, recurring commitments only. */
  dueDayOfMonth: z.number().int().min(1).max(31).nullable().default(null),
  /** A short, human, PT-BR sentence explaining the interpretation — shown on the review card, never invented financial advice. */
  rationale: z.string().min(1).max(300),
});
export type PlanningDraft = z.infer<typeof planningDraftSchema>;

const TOOL_NAME = "proposePlanningDraft";

/**
 * Built fresh per request (never a module-level constant) so "Hoje é..."
 * always reflects the real clock (`resolveAsOfDate`, DEC-127) rather than
 * freezing whatever date happened to be current when the server process
 * started.
 */
function buildInstructions(asOfDate: string): string {
  return `Você ajuda a interpretar a intenção de planejamento financeiro de um usuário do Ritmo em português (pt-BR).

Hoje é ${asOfDate} (data de referência do produto — use-a para resolver datas relativas como "em dezembro").

Sua única tarefa é chamar a ferramenta "${TOOL_NAME}" UMA vez, preenchendo:
- kind: "event" para algo pontual (uma viagem, uma compra, juntar dinheiro até uma data); "fixed_expense" para um gasto que se repete todo mês.
- label: um nome curto e claro para o item.
- amountReais: o valor em reais mencionado pelo usuário, ou null se ele não disse um valor — NUNCA invente um número.
- category: uma categoria curta (ex.: "Moradia", "Lazer"), só quando kind for "fixed_expense" — caso contrário null.
- startDate/endDate: datas no formato "YYYY-MM-DD", só quando kind for "event" — caso contrário null.
- dueDayOfMonth: dia do mês (1-31), só se o usuário mencionar um vencimento para um "fixed_expense" — caso contrário null.
- rationale: uma frase curta e honesta explicando como você interpretou o pedido.

Nunca invente valores, categorias ou datas que o usuário não mencionou — use null.`;
}

export const requestPlanningDraftInput = z.object({ message: z.string().min(1).max(500) });
export type RequestPlanningDraftInput = z.infer<typeof requestPlanningDraftInput>;

export type RequestPlanningDraftResult =
  | { readonly ok: true; readonly draft: PlanningDraft }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

export async function requestPlanningDraftHandler(
  data: RequestPlanningDraftInput,
): Promise<RequestPlanningDraftResult> {
  const { financialProfileId } = await getCurrentProfileContext();

  // Same AI cost-abuse guardrails the chat assistant uses — this is a real
  // OpenAI call, not a free local computation.
  const burst = checkRateLimit(
    `ai:burst:${financialProfileId}`,
    RATE_LIMIT_POLICIES.aiCopilotBurst,
  );
  if (!burst.allowed) {
    return {
      ok: false,
      error: {
        code: "AI_RATE_LIMITED",
        message:
          "Você está enviando pedidos rápido demais. Aguarde alguns segundos e tente de novo.",
      },
    };
  }
  const sustained = checkRateLimit(
    `ai:sustained:${financialProfileId}`,
    RATE_LIMIT_POLICIES.aiCopilotSustained,
  );
  if (!sustained.allowed) {
    return {
      ok: false,
      error: {
        code: "AI_RATE_LIMITED",
        message: "Você atingiu o limite de uso da IA por agora. Tente novamente mais tarde.",
      },
    };
  }

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    return {
      ok: false,
      error: {
        code: "AI_CONFIGURATION_ERROR",
        message: "A criação com IA ainda não está configurada neste ambiente.",
      },
    };
  }

  const model = resolveOpenAIModel();
  const aiProvider = new OpenAIProvider({ apiKey, model });

  try {
    const result = await aiProvider.generate({
      model,
      instructions: buildInstructions(resolveAsOfDate()),
      input: [{ type: "message", role: "user", content: data.message }],
      tools: [
        {
          name: TOOL_NAME,
          description: "Registra a interpretação estruturada do pedido de planejamento do usuário.",
          parameters: z.toJSONSchema(planningDraftSchema) as Record<string, unknown>,
        },
      ],
    });

    if (result.outcome.kind !== "tool_calls" || result.outcome.toolCalls.length === 0) {
      // Honest degradation — never fabricates a draft from a plain text reply.
      return {
        ok: false,
        error: {
          code: "AI_INTERPRETATION_FAILED",
          message:
            "Não consegui entender esse pedido de planejamento. Tente descrever de outro jeito.",
        },
      };
    }

    const call = result.outcome.toolCalls[0]!;
    const parsed = planningDraftSchema.safeParse(JSON.parse(call.argumentsJson));
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "AI_INTERPRETATION_FAILED",
          message:
            "Não consegui entender esse pedido de planejamento. Tente descrever de outro jeito.",
        },
      };
    }

    logger.audit("planning_draft_requested", { financialProfileId, kind: parsed.data.kind });
    return { ok: true, draft: parsed.data };
  } catch (error) {
    if (error instanceof AIError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: "Não foi possível usar a IA agora. Tente novamente em instantes.",
        },
      };
    }
    return {
      ok: false,
      error: { code: "AI_UNKNOWN_ERROR", message: "Ocorreu um erro inesperado." },
    };
  }
}

/**
 * Confirms a previously-shown draft and persists it — ALWAYS an explicit,
 * separate step from `requestPlanningDraftHandler` (brief: "no silent
 * mutation"). Reuses `createManualPlanningItemHandler` verbatim: the exact
 * same validation and persistence path manual creation uses, so an
 * AI-confirmed item is indistinguishable in the database from a manually
 * created one.
 *
 * DEC-137: the AI can only ever produce a free-text category guess (it has
 * no concept of a `categoryId`) — this was the SECOND hidden path (besides
 * the manual-creation form) that could write a category string with no
 * backing canonical `Category` row. Resolved here through the exact same
 * `createCategory` mutation the CategoryPicker's own "+ Criar nova
 * categoria" uses — it returns the existing visible category on a
 * normalized-name match (e.g. the AI says "moradia," a base "Moradia"
 * already exists) or creates a real personal one, never a second/parallel
 * category concept.
 */
export const confirmPlanningDraftInput = planningDraftSchema;
export type ConfirmPlanningDraftInput = PlanningDraft;

export async function confirmPlanningDraftHandler(
  data: ConfirmPlanningDraftInput,
): Promise<
  { readonly ok: true; readonly id: string } | { readonly ok: false; readonly error: string }
> {
  if (data.kind === "fixed_expense" && (data.amountReais === null || data.category === null)) {
    return { ok: false, error: "Um compromisso recorrente precisa de valor e categoria." };
  }
  if (data.kind === "event" && data.startDate === null) {
    return { ok: false, error: "Um evento precisa de uma data." };
  }

  let categoryId: string | undefined;
  if (data.kind === "fixed_expense") {
    const { financialProfileId } = await getCurrentProfileContext();
    const db = await getDb();
    const category = await createCategory(db, financialProfileId, { name: data.category! });
    categoryId = category.id;
  }

  return createManualPlanningItemHandler({
    kind: data.kind,
    label: data.label,
    ...(data.amountReais !== null ? { amountReais: data.amountReais } : {}),
    ...(categoryId !== undefined ? { categoryId } : {}),
    ...(data.kind === "event"
      ? { startDate: data.startDate!, endDate: data.endDate ?? data.startDate! }
      : {}),
    ...(data.dueDayOfMonth !== null ? { dueDayOfMonth: data.dueDayOfMonth } : {}),
  });
}
