import { z } from "zod";
import {
  getDb,
  createFixedExpense,
  createPlannedFinancialEvent,
  requireVisibleCategory,
} from "@money-copilot/app-services";
import { fromReais } from "@money-copilot/financial-engine";
import { getCurrentProfileContext } from "./profile.server";
import { logger } from "./logger.server";

/**
 * Server-only manual planning-item creation (Planejamento → "Criar
 * manualmente"). Reuses the exact same mutation primitives the AI-assisted
 * flow and the copilot's own tools use
 * (`createPlannedFinancialEvent`/`createFixedExpense` in
 * `@money-copilot/app-services`'s `mutations.ts`) — no parallel planning
 * subsystem. The `.server.ts` suffix signals this file is server-only to
 * Vite's import protection (it imports database/mutation code).
 *
 * DEC-137: a recurring commitment's category is a `categoryId` chosen from
 * the canonical CategoryPicker, never free text — this was the ONE
 * remaining surface in the product that still let a user type an arbitrary
 * category string (`FixedExpense.category`) without ever creating a real
 * `Category` row, which is exactly why a category typed here could
 * disappear from every other category-aware screen. `requireVisibleCategory`
 * (the same canonical resolver `createCategoryRule`/`categorizeTransaction`
 * use) resolves it before `createFixedExpense` is ever called; that
 * mutation's own `category: string` field is UNCHANGED (still what
 * `snapshot.ts`'s `TAX_CATEGORY` comparison and every other existing
 * consumer reads) — this only changes WHERE that string comes from, always
 * the resolved canonical `Category.name`, never independently typed.
 */

export const createManualPlanningItemInput = z
  .object({
    kind: z.enum(["event", "fixed_expense"]),
    label: z.string().min(1).max(120),
    /** Reais (not cents) — e.g. 1200.5. Required for a recurring commitment; optional for an event (an honest UNKNOWN budget is created when omitted). */
    amountReais: z.number().positive().optional(),
    /** DEC-137: the canonical category chosen from the CategoryPicker — required for a recurring commitment, ignored for an event. Never free text. */
    categoryId: z.string().min(1).optional(),
    /** ISO 8601 date — required for an event, ignored for a recurring commitment (implicitly "every month"). */
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    /** Day of month (1-31) — optional, recurring commitments only, display-only. */
    dueDayOfMonth: z.number().int().min(1).max(31).optional(),
  })
  .refine((v) => v.kind !== "fixed_expense" || v.amountReais !== undefined, {
    message: "Um compromisso recorrente precisa de um valor.",
    path: ["amountReais"],
  })
  .refine((v) => v.kind !== "fixed_expense" || v.categoryId !== undefined, {
    message: "Um compromisso recorrente precisa de uma categoria.",
    path: ["categoryId"],
  })
  .refine((v) => v.kind !== "event" || v.startDate !== undefined, {
    message: "Um evento precisa de uma data.",
    path: ["startDate"],
  });
export type CreateManualPlanningItemInput = z.infer<typeof createManualPlanningItemInput>;

export async function createManualPlanningItemHandler(
  data: CreateManualPlanningItemInput,
): Promise<
  { readonly ok: true; readonly id: string } | { readonly ok: false; readonly error: string }
> {
  const { financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();

  try {
    if (data.kind === "fixed_expense") {
      const category = await requireVisibleCategory(db, financialProfileId, data.categoryId!);
      const expense = await createFixedExpense(db, financialProfileId, {
        label: data.label,
        category: category.name,
        amount: fromReais(data.amountReais!),
        certainty: "CONFIRMED",
        ...(data.dueDayOfMonth !== undefined ? { dueDayOfMonth: data.dueDayOfMonth } : {}),
      });
      logger.audit("planning_item_created_manual", {
        financialProfileId,
        kind: "fixed_expense",
        id: expense.id,
      });
      return { ok: true, id: expense.id };
    }

    const event = await createPlannedFinancialEvent(db, financialProfileId, {
      label: data.label,
      startDate: data.startDate!,
      endDate: data.endDate ?? data.startDate!,
      ...(data.amountReais !== undefined
        ? { budgetAmount: fromReais(data.amountReais), budgetCertainty: "CONFIRMED" as const }
        : {}),
    });
    logger.audit("planning_item_created_manual", {
      financialProfileId,
      kind: "event",
      id: event.id,
    });
    return { ok: true, id: event.id };
  } catch {
    return { ok: false, error: "Não foi possível criar o item de planejamento agora." };
  }
}
