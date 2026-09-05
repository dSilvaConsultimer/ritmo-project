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
