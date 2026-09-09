import { createId, type Id } from "@money-copilot/shared";
import * as M from "../money/index";
import type { Money } from "../money/index";
import type { Certainty } from "./certainty";

/**
 * A credit card bill/invoice (a payment-cycle representation: due date,
 * closing date, total owed, minimum payment). NEVER fed into
 * `FinancialSnapshot`'s committed totals — its underlying purchases are
 * already represented as individual `CONSUMPTION` transactions, and the
 * "amount actually due this cycle" for cashflow purposes comes from an
 * `InstallmentPlan` (or a manual `FixedExpense`) instead. Summing a bill's
 * `totalAmount` on top of its transactions would double-count consumption —
 * see docs/OPEN-FINANCE.md, "Credit card bills."
 */
export interface CreditCardBill {
  readonly id: Id<"credit-card-bill">;
  readonly financialProfileId: Id<"financial-profile">;
  /** The credit card `PaymentSource` this bill belongs to. */
  readonly paymentSourceId: Id<"payment-source">;
  readonly provider?: string;
  readonly externalBillId?: string;
  readonly dueDate: string;
  readonly closingDate?: string;
  readonly totalAmount: Money;
  readonly minimumPayment?: Money;
  readonly allowsInstallments?: boolean;
  readonly certainty: Certainty;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Provider-agnostic bill shape a future Open Finance integration maps its own payload into. */
export interface ExternalBillInput {
  readonly provider: string;
  readonly externalBillId: string;
  readonly externalAccountId: string;
  readonly dueDate: string;
  readonly closingDate?: string;
  readonly totalAmountCents: number;
  readonly minimumPaymentCents?: number;
  readonly allowsInstallments?: boolean;
  readonly certainty: Certainty;
}

/**
 * `id` defaults to a fresh `createId()` for a bill never seen before, but
 * callers that already found an existing bill for this
 * (provider, externalBillId) — see `findBillByExternalId` — must pass its
 * id here to reuse it, the same way `paymentSourceFromExternalAccount` and
 * `draftTransactionFromExternalInput`'s callers reuse an existing internal
 * id. Sprint 4.5 live validation found this was NOT being done (DEC-048):
 * every sync re-created a brand new bill row for the same real Pluggy
 * bill, since nothing looked up an existing one by `externalBillId` first.
 */
export function billFromExternalInput(
  input: ExternalBillInput,
  financialProfileId: Id<"financial-profile">,
  paymentSourceId: Id<"payment-source">,
  now: string,
  id: Id<"credit-card-bill"> = createId("credit-card-bill"),
): CreditCardBill {
  return {
    id,
    financialProfileId,
    paymentSourceId,
    provider: input.provider,
    externalBillId: input.externalBillId,
    dueDate: input.dueDate,
    ...(input.closingDate ? { closingDate: input.closingDate } : {}),
    totalAmount: M.fromCents(input.totalAmountCents),
    ...(input.minimumPaymentCents !== undefined
      ? { minimumPayment: M.fromCents(input.minimumPaymentCents) }
      : {}),
    ...(input.allowsInstallments !== undefined
      ? { allowsInstallments: input.allowsInstallments }
      : {}),
    certainty: input.certainty,
    createdAt: now,
    updatedAt: now,
  };
}
