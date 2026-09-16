import { createServerFn } from "@tanstack/react-start";
import {
  acceptRecommendationHandler,
  acceptRecommendationInput,
  categorizeTransactionHandler,
  categorizeTransactionInput,
  confirmRecurringExpenseHandler,
  confirmRecurringExpenseInput,
  confirmRecurringIncomeHandler,
  confirmRecurringIncomeInput,
  createCategoryRuleHandler,
  createCategoryRuleInput,
  deleteCategoryRuleHandler,
  deleteCategoryRuleInput,
  rejectCandidateHandler,
  rejectCandidateInput,
  rejectRecommendationHandler,
  rejectRecommendationInput,
} from "./planejamento-actions.server";

/**
 * Server functions for Planning's interactive sections ("Ritmo precisa
 * confirmar", "Regras e categorias") — see `planejamento-actions.server.ts`
 * for the real logic. Mirrors `connections.ts`'s own thin-wrapper pattern.
 */

export const categorizeTransactionAction = createServerFn({ method: "POST" })
  .validator(categorizeTransactionInput)
  .handler(({ data }) => categorizeTransactionHandler(data));

export const confirmRecurringIncomeAction = createServerFn({ method: "POST" })
  .validator(confirmRecurringIncomeInput)
  .handler(({ data }) => confirmRecurringIncomeHandler(data));

export const confirmRecurringExpenseAction = createServerFn({ method: "POST" })
  .validator(confirmRecurringExpenseInput)
  .handler(({ data }) => confirmRecurringExpenseHandler(data));

export const rejectCandidateAction = createServerFn({ method: "POST" })
  .validator(rejectCandidateInput)
  .handler(({ data }) => rejectCandidateHandler(data));

export const createCategoryRuleAction = createServerFn({ method: "POST" })
  .validator(createCategoryRuleInput)
  .handler(({ data }) => createCategoryRuleHandler(data));

export const deleteCategoryRuleAction = createServerFn({ method: "POST" })
  .validator(deleteCategoryRuleInput)
  .handler(({ data }) => deleteCategoryRuleHandler(data));

export const acceptRecommendationAction = createServerFn({ method: "POST" })
  .validator(acceptRecommendationInput)
  .handler(({ data }) => acceptRecommendationHandler(data));

export const rejectRecommendationAction = createServerFn({ method: "POST" })
  .validator(rejectRecommendationInput)
  .handler(({ data }) => rejectRecommendationHandler(data));
