import type { Id } from "@money-copilot/shared";
import type { FixedExpense } from "./expense";

export type ProtectedScope =
  | { readonly type: "EXPENSE"; readonly expenseId: Id<"fixed-expense"> }
  | { readonly type: "CATEGORY"; readonly category: string };

/**
 * A user-declared preference that overrides automatic cost-cutting
 * recommendations, even if a future recommendation engine would otherwise
 * flag the scope as reducible. See RULE #5, #11.
 */
export interface ProtectedPreference {
  readonly id: Id<"protected-preference">;
  readonly label: string;
  readonly scope: ProtectedScope;
  readonly reason?: string;
}

export function protectsExpense(
  preference: ProtectedPreference,
  expense: FixedExpense,
): boolean {
  if (preference.scope.type === "EXPENSE") {
    return preference.scope.expenseId === expense.id;
  }
  return preference.scope.category === expense.category;
}

/**
 * Sprint 5 (DEC-057): every category a `ProtectedPreference` shields,
 * whether declared directly (`scope.type === "CATEGORY"`) or indirectly by
 * protecting a specific `FixedExpense` (whose own category is then also
 * protected). Used by the recommendation engine to exclude a transaction
 * category from candidate generation BEFORE any ranking/presentation
 * happens (RULE #5/#11) — generic by construction: any future
 * `ProtectedPreference` gets the same treatment with no engine change.
 */
export function protectedCategories(
  preferences: readonly ProtectedPreference[],
  fixedExpenses: readonly FixedExpense[],
): ReadonlySet<string> {
  const categories = new Set<string>();
  for (const preference of preferences) {
    const scope = preference.scope;
    if (scope.type === "CATEGORY") {
      categories.add(scope.category);
      continue;
    }
    const expense = fixedExpenses.find((e) => e.id === scope.expenseId);
    if (expense) categories.add(expense.category);
  }
  return categories;
}
