import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import type { Certainty } from "./certainty";
import type { Id } from "@money-copilot/shared";
import type { PaymentSource, PaymentSourceType } from "./transaction";

export type ExternalAccountKind = "BANK" | "CREDIT_CARD";

/**
 * Provider-agnostic account/card shape a future Open Finance integration
 * maps its own payload into. No provider-specific logic lives here — see
 * `packages/open-finance` for where a real provider's account types get
 * interpreted into `kind`/`subtype` below.
 */
export interface ExternalAccountInput {
  readonly provider: string;
  readonly externalAccountId: string;
  /** The provider's own connection/item identifier this account belongs to. */
  readonly connectionExternalId: string;
  readonly kind: ExternalAccountKind;
  readonly subtype?: string;
  readonly displayName: string;
  readonly currency: string;
  /** Null when the provider hasn't reported a balance yet. */
  readonly balanceCents: number | null;
  readonly balanceCertainty: Certainty;
  readonly creditCard?: {
    readonly creditLimitCents?: number;
    readonly availableCreditLimitCents?: number;
    readonly closingDate?: string;
    readonly dueDate?: string;
    readonly minimumPaymentCents?: number;
  };
  readonly lastSyncedAt: string;
}

function paymentSourceType(kind: ExternalAccountKind): PaymentSourceType {
  return kind === "CREDIT_CARD" ? "CREDIT_CARD" : "DEBIT";
}

/**
 * Builds a `PaymentSource` from a canonical provider account input. Pure
 * and provider-agnostic — never inspects `input.provider`'s specific
 * conventions (that interpretation already happened upstream, in the
 * provider adapter, to produce this DTO).
 */
export function paymentSourceFromExternalAccount(
  input: ExternalAccountInput,
  connectionId: Id<"provider-connection">,
  id: Id<"payment-source"> = createId("payment-source"),
): PaymentSource {
  return {
    id,
    label: input.displayName,
    type: paymentSourceType(input.kind),
    ...(input.subtype ? { subtype: input.subtype } : {}),
    provider: input.provider,
    externalAccountId: input.externalAccountId,
    connectionId,
    currency: input.currency,
    balance: {
      certainty: input.balanceCertainty,
      amount: input.balanceCents === null ? null : M.fromCents(input.balanceCents),
    },
    ...(input.creditCard
      ? {
          creditCard: {
            ...(input.creditCard.creditLimitCents !== undefined
              ? { creditLimit: M.fromCents(input.creditCard.creditLimitCents) }
              : {}),
            ...(input.creditCard.availableCreditLimitCents !== undefined
              ? { availableCreditLimit: M.fromCents(input.creditCard.availableCreditLimitCents) }
              : {}),
            ...(input.creditCard.closingDate ? { closingDate: input.creditCard.closingDate } : {}),
            ...(input.creditCard.dueDate ? { dueDate: input.creditCard.dueDate } : {}),
            ...(input.creditCard.minimumPaymentCents !== undefined
              ? { minimumPayment: M.fromCents(input.creditCard.minimumPaymentCents) }
              : {}),
          },
        }
      : {}),
    certainty: input.balanceCertainty,
    lastSyncedAt: input.lastSyncedAt,
  };
}
