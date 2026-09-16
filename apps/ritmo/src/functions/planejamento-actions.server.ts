import { z } from "zod";
import {
  acceptRecommendation,
  categorizeTransaction,
  confirmRecurringFixedExpenseCandidate,
  confirmRecurringIncomeCandidate,
  createCategory,
  createCategoryRule,
  deleteCategoryRule,
  getCategoriesForProfile,
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
  categoryId: z.string().min(1),
  subcategory: z.string().min(1).optional(),
  alwaysForMerchant: z.boolean().optional(),
});
export type CategorizeTransactionInput = z.infer<typeof categorizeTransactionInput>;

export async function categorizeTransactionHandler(
  data: CategorizeTransactionInput,
): Promise<
  | { readonly ok: true; readonly retroactivelyReclassifiedCount: number }
  | { readonly ok: false; readonly error: ActionError }
> {
  const { financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();
  try {
    const result = await categorizeTransaction(db, financialProfileId, {
      transactionId: data.transactionId,
      categoryId: data.categoryId,
      ...(data.subcategory !== undefined ? { subcategory: data.subcategory } : {}),
      ...(data.alwaysForMerchant !== undefined
        ? { alwaysForMerchant: data.alwaysForMerchant }
        : {}),
    });
    return { ok: true, retroactivelyReclassifiedCount: result.retroactivelyReclassifiedCount };
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
  categoryId: z.string().min(1),
  subcategory: z.string().min(1).optional(),
});
export type CreateCategoryRuleInput = z.infer<typeof createCategoryRuleInput>;

export async function createCategoryRuleHandler(
  data: CreateCategoryRuleInput,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: ActionError }> {
  const { financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();
  try {
    await createCategoryRule(db, financialProfileId, {
      matchType: data.matchType,
      pattern: data.pattern,
      categoryId: data.categoryId,
      ...(data.subcategory !== undefined ? { subcategory: data.subcategory } : {}),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: normalizeActionError(error) };
  }
}

export const getCategoriesInput = z.object({});
export type GetCategoriesInput = z.infer<typeof getCategoriesInput>;

/** The CategoryPicker's data source — every category visible to this profile (base + personal). */
export async function getCategoriesHandler(): Promise<
  | {
      readonly ok: true;
      readonly categories: readonly { id: string; name: string; isBase: boolean }[];
    }
  | { readonly ok: false; readonly error: ActionError }
> {
  const { financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();
  try {
    const categories = await getCategoriesForProfile(db, financialProfileId);
    return {
      ok: true,
      categories: categories
        .map((c) => ({ id: c.id, name: c.name, isBase: c.financialProfileId === undefined }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  } catch (error) {
    return { ok: false, error: normalizeActionError(error) };
  }
}

export const createCategoryInput = z.object({ name: z.string().min(1) });
export type CreateCategoryInput = z.infer<typeof createCategoryInput>;

/** The CategoryPicker's "+ Criar nova categoria" action — always a PERSONAL category, immediately usable. */
export async function createCategoryHandler(
  data: CreateCategoryInput,
): Promise<
  | { readonly ok: true; readonly category: { id: string; name: string } }
  | { readonly ok: false; readonly error: ActionError }
> {
  const { financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();
  try {
    const category = await createCategory(db, financialProfileId, { name: data.name });
    return { ok: true, category: { id: category.id, name: category.name } };
  } catch (error) {
    return { ok: false, error: normalizeActionError(error) };
  }
}

export const deleteCategoryRuleInput = z.object({ ruleId: z.string().min(1) });
export type DeleteCategoryRuleInput = z.infer<typeof deleteCategoryRuleInput>;

export async function deleteCategoryRuleHandler(
  data: DeleteCategoryRuleInput,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: ActionError }> {
  const { financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();
  try {
    await deleteCategoryRule(db, financialProfileId, data.ruleId);
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
