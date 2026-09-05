import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import type { Certainty } from "./certainty";
import type { FinancialEffect } from "./financial-effect";
import type {
  FinancialTransaction,
  PaymentSource,
  TransactionDirection,
  TransactionStatus,
} from "./transaction";

/**
 * Provider-agnostic shape a future Open Finance integration maps its own
 * payload into, before it ever becomes a `FinancialTransaction`. No
 * provider-specific (Pluggy/Belvo/etc.) logic exists anywhere in
 * `financial-engine` — see `packages/open-finance` for where a real
 * provider's sign/type conventions get interpreted into `financialEffect`
 * and `direction` below (NON-NEGOTIABLE: "provider signs must not directly
 * become financial meaning" — that interpretation happens once, at the
 * adapter boundary, before this DTO is ever constructed).
 */
export interface ExternalTransactionInput {
  readonly provider: string;
  readonly externalTransactionId: string;
  /** The provider's own identifier for the account/card the movement occurred on. */
  readonly paymentSourceExternalRef: string;
  readonly amountCents: number;
  readonly direction: TransactionDirection;
  readonly financialEffect: FinancialEffect;
  readonly certainty: Certainty;
  readonly date: string;
  readonly authorizationDate?: string;
  readonly postingDate?: string;
  readonly rawDescription: string;
  readonly rawMerchant?: string;
  readonly status: TransactionStatus;
  /** The provider's own category label — preserved, never authoritative. */
  readonly providerCategory?: string;
  readonly installmentMetadata?: {
    readonly installmentNumber?: number;
    readonly totalInstallments?: number;
    readonly totalAmountCents?: number;
    readonly externalBillId?: string;
  };
  /**
   * The original provider payload, useful for interactive debugging while
   * mapping. NEVER persisted by the repository layer by default (only
   * narrowly-scoped structured fields are) — see docs/OPEN-FINANCE.md,
   * "raw payload retention policy."
   */
  readonly raw?: Readonly<Record<string, unknown>>;
}

/**
 * Builds a draft `FinancialTransaction` from a canonical provider input —
 * category/normalizedMerchant are left unset (`null`/`undefined`) for the
 * existing normalization+categorization pipeline to fill in
 * (`domain/merchant.ts`, `domain/category.ts`). Generic and
 * provider-agnostic: it never inspects `input.provider`.
 */
export function draftTransactionFromExternalInput(
  input: ExternalTransactionInput,
  financialProfileId: FinancialTransaction["financialProfileId"],
  paymentSource: PaymentSource,
  now: string,
): FinancialTransaction {
  return {
    id: createId("transaction"),
    financialProfileId,
    externalProviderId: input.provider,
    externalTransactionId: input.externalTransactionId,
    paymentSource,
    date: input.date,
    ...(input.authorizationDate ? { authorizationDate: input.authorizationDate } : {}),
    ...(input.postingDate ? { postingDate: input.postingDate } : {}),
    amount: M.fromCents(input.amountCents),
    direction: input.direction,
    rawDescription: input.rawDescription,
    normalizedDescription: input.rawDescription.trim().toUpperCase(),
    ...(input.rawMerchant ? { rawMerchant: input.rawMerchant } : {}),
    status: input.status,
    certainty: input.certainty,
    financialEffect: input.financialEffect,
    category: null,
    ...(input.providerCategory ? { providerCategory: input.providerCategory } : {}),
    ...(input.installmentMetadata
      ? {
          installmentMetadata: {
            ...(input.installmentMetadata.installmentNumber !== undefined
              ? { installmentNumber: input.installmentMetadata.installmentNumber }
              : {}),
            ...(input.installmentMetadata.totalInstallments !== undefined
              ? { totalInstallments: input.installmentMetadata.totalInstallments }
              : {}),
            ...(input.installmentMetadata.totalAmountCents !== undefined
              ? { totalAmount: M.fromCents(input.installmentMetadata.totalAmountCents) }
              : {}),
            ...(input.installmentMetadata.externalBillId
              ? { externalBillId: input.installmentMetadata.externalBillId }
              : {}),
          },
        }
      : {}),
    origin: "IMPORTED",
    createdAt: now,
    updatedAt: now,
  };
}
