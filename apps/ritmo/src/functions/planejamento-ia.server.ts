import { z } from "zod";
import { AIError, OpenAIProvider, resolveOpenAIModel, type AIProvider } from "@money-copilot/ai";
import { getDb, createCategory, getCategoriesForProfile } from "@money-copilot/app-services";
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
 *
 * DEC-138: category identity for an AI-produced draft works exactly like
 * every other category-aware surface in the product — `categoryId` is the
 * only thing that can ever be persisted as identity, and creating a NEW
 * personal category requires an EXPLICIT user action. For manual creation
 * that's the CategoryPicker's own "+ Criar nova categoria"; for the AI
 * flow it is the user's own message explicitly asking to create one (e.g.
 * "crie uma categoria chamada Trabalho") — never merely because the model
 * couldn't match an existing category to an ordinary request like "pago
 * consulta médica todo mês". See `resolveDraftCategory`'s own doc comment
 * for the actual safety mechanism (the model's raw output is NEVER trusted
 * blindly), and `planejamento-ia.tsx` for how an unresolved category
 * blocks confirmation until the user picks one via the same CategoryPicker
 * used everywhere else.
 */

const planningDraftSchema = z.object({
  kind: z.enum(["event", "fixed_expense"]),
  label: z.string().min(1).max(120),
  /** Reais, never cents. `null` when the user didn't state a number — never guessed. */
  amountReais: z.number().positive().nullable().default(null),
  /**
   * DEC-138: an id from the categories ALREADY visible to this profile —
   * never a free-text name. Only meaningful for `kind: "fixed_expense"`.
   * Sanitized against the real visible-category list by
   * `resolveDraftCategory` before this ever leaves `requestPlanningDraftHandler`
   * — the model's raw claim is never trusted as-is.
   */
  categoryId: z.string().min(1).nullable().default(null),
  /**
   * DEC-138: set ONLY when the user's own message explicitly asked to
   * create a brand-new category with this exact name (e.g. "crie uma
   * categoria chamada Trabalho") — never merely because no existing
   * category matched an ordinary request. Mutually exclusive with
   * `categoryId` — `resolveDraftCategory` enforces this regardless of what
   * the model returns.
   */
  newCategoryName: z.string().min(1).max(60).nullable().default(null),
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

export interface DraftCategoryResolution {
  readonly categoryId: string | null;
  readonly newCategoryName: string | null;
}

/**
 * DEC-138: the actual safety mechanism — the model's raw `categoryId`/
 * `newCategoryName` output is NEVER trusted as-is, regardless of how
 * confident the prompt asked it to be. A `categoryId` is kept ONLY when it
 * matches a category genuinely visible to this profile right now (base or
 * personal); anything else (a hallucinated id, a category name used where
 * an id was expected, an id from a different profile) is discarded — never
 * silently converted into a category-creation request. A valid
 * `categoryId` always wins over `newCategoryName`: this product never
 * creates a new category and reuses an existing one in the same draft, and
 * "the model filled both fields" is exactly the kind of confused output
 * this function exists to make safe. `newCategoryName` survives ONLY when
 * `categoryId` did not resolve — the caller (`confirmPlanningDraftHandler`)
 * is the only place that may ever act on it, and only because it can only
 * ever have been set from the user's own explicit creation request in the
 * first place (see `buildInstructions`).
 */
export function resolveDraftCategory(
  rawCategoryId: string | null,
  rawNewCategoryName: string | null,
  visibleCategories: readonly { readonly id: string }[],
): DraftCategoryResolution {
  const resolvedCategoryId =
    rawCategoryId !== null && visibleCategories.some((c) => c.id === rawCategoryId)
      ? rawCategoryId
      : null;
  return resolvedCategoryId !== null
    ? { categoryId: resolvedCategoryId, newCategoryName: null }
    : { categoryId: null, newCategoryName: rawNewCategoryName };
}

/**
 * Built fresh per request (never a module-level constant) so "Hoje é..."
 * always reflects the real clock (`resolveAsOfDate`, DEC-127) rather than
 * freezing whatever date happened to be current when the server process
 * started, and so the category list always reflects this profile's
 * CURRENT visible categories (DEC-138) — never a stale/cached snapshot.
 */
function buildInstructions(
  asOfDate: string,
  visibleCategories: readonly { readonly id: string; readonly name: string }[],
): string {
  const categoryList = visibleCategories
    .map((c) => `- id: "${c.id}" — nome: "${c.name}"`)
    .join("\n");
  return `Você ajuda a interpretar a intenção de planejamento financeiro de um usuário do Ritmo em português (pt-BR).

Hoje é ${asOfDate} (data de referência do produto — use-a para resolver datas relativas como "em dezembro").

Categorias JÁ EXISTENTES e visíveis para este usuário (use exatamente um destes ids ao preencher "categoryId" — NUNCA invente um id que não esteja nesta lista):
${categoryList}

Sua única tarefa é chamar a ferramenta "${TOOL_NAME}" UMA vez, preenchendo:
- kind: "event" para algo pontual (uma viagem, uma compra, juntar dinheiro até uma data); "fixed_expense" para um gasto que se repete todo mês.
- label: um nome curto e claro para o item.
- amountReais: o valor em reais mencionado pelo usuário, ou null se ele não disse um valor — NUNCA invente um número.
- categoryId: só quando kind for "fixed_expense". O id EXATO de uma categoria da lista acima, escolhido SOMENTE quando você tiver confiança razoável de que ela corresponde ao pedido (ex.: "pago consulta médica todo mês" → o id da categoria "Saúde", se ela existir na lista). Se nenhuma categoria da lista corresponder com confiança, deixe null — é sempre preferível deixar null a escolher uma categoria errada. NUNCA use um id que não esteja na lista acima, e nunca use um nome de categoria neste campo.
- newCategoryName: preencha isso APENAS quando o usuário pedir EXPLICITAMENTE para criar uma categoria nova (frases como "crie uma categoria chamada X", "cria uma categoria nova X"). NUNCA preencha isso só porque nenhuma categoria da lista correspondeu ao pedido — nesse caso deixe categoryId e newCategoryName como null; o usuário escolherá uma categoria manualmente na tela de revisão. NUNCA preencha categoryId e newCategoryName ao mesmo tempo.
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

/**
 * `aiProviderOverride` mirrors `runCopilotTurn`'s own `aiProvider`
 * injection point (`orchestrator.ts`) — lets tests supply a
 * `MockAIProvider` and exercise the REAL category-sanitization pipeline
 * (`resolveDraftCategory`, fed with the real visible-category list) without
 * any network call. Never set in production — `getDb`/`getCurrentProfileContext`
 * still always resolve for real.
 */
export async function requestPlanningDraftHandler(
  data: RequestPlanningDraftInput,
  aiProviderOverride?: AIProvider,
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
  if (!aiProviderOverride && !apiKey) {
    return {
      ok: false,
      error: {
        code: "AI_CONFIGURATION_ERROR",
        message: "A criação com IA ainda não está configurada neste ambiente.",
      },
    };
  }

  const model = resolveOpenAIModel();
  const aiProvider = aiProviderOverride ?? new OpenAIProvider({ apiKey: apiKey!, model });

  try {
    const db = await getDb();
    // DEC-138: fetched fresh on every request — the AI must only ever be
    // offered categories that genuinely exist right now for THIS profile
    // (base + its own personal ones), never a stale list and never another
    // profile's categories.
    const visibleCategories = await getCategoriesForProfile(db, financialProfileId);

    const result = await aiProvider.generate({
      model,
      instructions: buildInstructions(resolveAsOfDate(), visibleCategories),
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

    // DEC-138: NEVER trust the model's raw categoryId/newCategoryName —
    // sanitize against the real visible-category list before this draft
    // ever reaches the client.
    const { categoryId, newCategoryName } = resolveDraftCategory(
      parsed.data.categoryId,
      parsed.data.newCategoryName,
      visibleCategories,
    );
    const draft: PlanningDraft = { ...parsed.data, categoryId, newCategoryName };

    logger.audit("planning_draft_requested", { financialProfileId, kind: draft.kind });
    return { ok: true, draft };
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
 * DEC-138: a `fixed_expense` draft must arrive with EITHER a resolved
 * `categoryId` (an existing category the AI matched, or one the user
 * picked/created via CategoryPicker on the review card) OR a
 * `newCategoryName` (the user's own explicit "create a category" request)
 * — never neither. `createCategory` is called here ONLY for
 * `newCategoryName`, and that field can only ever have been populated from
 * an explicit user creation request in the first place (see
 * `buildInstructions`/`resolveDraftCategory`) — this is never reached
 * merely because the AI couldn't match an existing category.
 */
export const confirmPlanningDraftInput = planningDraftSchema;
export type ConfirmPlanningDraftInput = PlanningDraft;

export async function confirmPlanningDraftHandler(
  data: ConfirmPlanningDraftInput,
): Promise<
  { readonly ok: true; readonly id: string } | { readonly ok: false; readonly error: string }
> {
  if (data.kind === "fixed_expense") {
    if (data.amountReais === null) {
      return { ok: false, error: "Um compromisso recorrente precisa de um valor." };
    }
    if (data.categoryId === null && data.newCategoryName === null) {
      return { ok: false, error: "Selecione uma categoria antes de confirmar." };
    }
  }
  if (data.kind === "event" && data.startDate === null) {
    return { ok: false, error: "Um evento precisa de uma data." };
  }

  let categoryId: string | undefined;
  if (data.kind === "fixed_expense") {
    if (data.categoryId !== null) {
      categoryId = data.categoryId;
    } else {
      const { financialProfileId } = await getCurrentProfileContext();
      const db = await getDb();
      const category = await createCategory(db, financialProfileId, {
        name: data.newCategoryName!,
      });
      categoryId = category.id;
    }
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
