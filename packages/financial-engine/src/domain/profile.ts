import type { Id } from "@money-copilot/shared";

/**
 * The owner of a set of financial data. Sprint 2 has exactly one local
 * profile and no authentication — but every persisted entity belongs to a
 * profile from day one so introducing real auth later never requires a
 * schema redesign. Deliberately holds no unnecessary PII: a display label
 * only.
 */
export interface FinancialProfile {
  readonly id: Id<"financial-profile">;
  readonly label: string;
  readonly createdAt: string;
}
