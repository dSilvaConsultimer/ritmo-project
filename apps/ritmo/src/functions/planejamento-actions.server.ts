import { z } from "zod";
import {
  acceptRecommendation,
  categorizeTransaction,
  confirmRecurringFixedExpenseCandidate,
  confirmRecurringIncomeCandidate,
  createCategoryRule,
  deleteCategoryRule,
  getDb,
  rejectRecommendation,
  rejectRecurringCandidate,
} from "@money-copilot/app-services";
import { getCurrentProfileContext } from "./profile.server";

/**
 * Server-only DEC-132 Planning actions: resolving pending confirmations
 * (uncategorized transactions, recurring income/expense candidates) and
 * managing category rules. Every mutation reuses the exact
 * `@money-copilot/app-services` canonical mutations the AI copilot's
 * equivalent tools call — no second mutation path. Every function resolves
 * `financialProfileId` itself via `getCurrentProfileContext()`, matching
 * `connections.server.ts`'s own established convention (see
 * docs/DECISIONS.md DEC-101).
 */

type ActionError = { readonly code: string; readonly message: string };

function normalizeActionError(error: unknown): ActionError {
  if (error instanceof Error) return { code: "ACTION_FAILED", message: error.message };
  return { code: "ACTION_FAILED", message: "Não foi possível concluir a ação." };
}

export const categorizeTransactionInput = z.object({
  transactionId: z.string().min(1),
  category: z.string().min(1),
  subcategory: z.string().min(1).optional(),
  alwaysForMerchant: z.boolean().optional(),
});
export type CategorizeTransactionInput = z.infer<typeof categorizeTransactionInput>;

export async function categorizeTransactionHandler(
  data: CategorizeTransactionInput,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: ActionError }> {
  const { financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();
  try {
    await categorizeTransaction(db, financialProfileId, {
      transactionId: data.transactionId,
      category: data.category,
      ...(data.subcategory !== undefined ? { subcategory: data.subcategory } : {}),
      ...(data.alwaysForMerchant !== undefined
        ? { alwaysForMerchant: data.alwaysForMerchant }
        : {}),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: normalizeActionError(error) };
  }
}

export const confirmRecurringIncomeInput = z.object({
  candidateId: z.string().min(1),
  label: z.string().min(1),
  expectedDayOfMonth: z.number().int().min(1).max(31).optional(),
});
export type ConfirmRecurringIncomeInput = z.infer<typeof confirmRecurringIncomeInput>;

export async function confirmRecurringIncomeHandler(
  data: ConfirmRecurringIncomeInput,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: ActionError }> {
  const { financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();
  try {
    await confirmRecurringIncomeCandidate(db, financialProfileId, {
      candidateId: data.candidateId,
      label: data.label,
      ...(data.expectedDayOfMonth !== undefined
        ? { expectedDayOfMonth: data.expectedDayOfMonth }
        : {}),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: normalizeActionError(error) };
  }
}

export const confirmRecurringExpenseInput = z.object({
  candidateId: z.string().min(1),
  label: z.string().min(1),
  category: z.string().min(1),
  dueDayOfMonth: z.number().int().min(1).max(31).optional(),
});
export type ConfirmRecurringExpenseInput = z.infer<typeof confirmRecurringExpenseInput>;

export async function confirmRecurringExpenseHandler(
  data: ConfirmRecurringExpenseInput,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: ActionError }> {
  const { financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();
  try {
    await confirmRecurringFixedExpenseCandidate(db, financialProfileId, {
      candidateId: data.candidateId,
      label: data.label,
      category: data.category,
      ...(data.dueDayOfMonth !== undefined ? { dueDayOfMonth: data.dueDayOfMonth } : {}),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: normalizeActionError(error) };
  }
}

export const rejectCandidateInput = z.object({
  candidateId: z.string().min(1),
  kind: z.enum(["INCOME", "FIXED_EXPENSE"]),
});
export type RejectCandidateInput = z.infer<typeof rejectCandidateInput>;

export async function rejectCandidateHandler(
  data: RejectCandidateInput,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: ActionError }> {
  const { financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();
  try {
    await rejectRecurringCandidate(db, financialProfileId, data.candidateId, data.kind);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: normalizeActionError(error) };
  }
}

export const createCategoryRuleInput = z.object({
  matchType: z.enum([
    "EXACT_MERCHANT",
    "CONTAINS_MERCHANT",
    "CONTAINS_DESCRIPTION",
    "REGEX_DESCRIPTION",
  ]),
  pattern: z.string().min(1),
  category: z.string().min(1),
  subcategory: z.string().min(1).optional(),
});
export type CreateCategoryRuleInput = z.infer<typeof createCategoryRuleInput>;

export async function createCategoryRuleHandler(
  data: CreateCategoryRuleInput,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: ActionError }> {
  await getCurrentProfileContext();
  const db = await getDb();
  try {
    await createCategoryRule(db, {
      matchType: data.matchType,
      pattern: data.pattern,
      category: data.category,
      ...(data.subcategory !== undefined ? { subcategory: data.subcategory } : {}),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: normalizeActionError(error) };
  }
}

export const deleteCategoryRuleInput = z.object({ ruleId: z.string().min(1) });
export type DeleteCategoryRuleInput = z.infer<typeof deleteCategoryRuleInput>;

export async function deleteCategoryRuleHandler(
  data: DeleteCategoryRuleInput,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: ActionError }> {
  await getCurrentProfileContext();
  const db = await getDb();
  try {
    await deleteCategoryRule(db, data.ruleId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: normalizeActionError(error) };
  }
}

export const acceptRecommendationInput = z.object({ recommendationId: z.string().min(1) });
export type AcceptRecommendationInput = z.infer<typeof acceptRecommendationInput>;

/** Reuses the exact `acceptRecommendation` service `apps/web`'s own `/api/recommendations` route calls — no second recommendation-decision path. */
export async function acceptRecommendationHandler(
  data: AcceptRecommendationInput,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: ActionError }> {
  const { financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();
  try {
    await acceptRecommendation(db, { financialProfileId, recommendationId: data.recommendationId });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: normalizeActionError(error) };
  }
}

export const rejectRecommendationInput = z.object({ recommendationId: z.string().min(1) });
export type RejectRecommendationInput = z.infer<typeof rejectRecommendationInput>;

export async function rejectRecommendationHandler(
  data: RejectRecommendationInput,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: ActionError }> {
  const { financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();
  try {
    await rejectRecommendation(db, financialProfileId, data.recommendationId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: normalizeActionError(error) };
  }
}
