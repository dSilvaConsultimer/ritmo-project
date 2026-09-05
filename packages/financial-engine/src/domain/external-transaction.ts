import type { TransactionDirection, TransactionStatus } from "./transaction";

/**
 * Provider-agnostic shape a future Open Finance integration (Sprint 3) maps
 * its own payload into, before it ever becomes a `FinancialTransaction`.
 * No provider-specific (Pluggy/Belvo/etc.) logic exists anywhere in Sprint
 * 2 — this DTO only defines the target shape such a mapping would produce.
 */
export interface ExternalTransactionInput {
  readonly provider: string;
  readonly externalTransactionId: string;
  /** The provider's own identifier for the account/card the movement occurred on. */
  readonly paymentSourceExternalRef: string;
  readonly amountCents: number;
  readonly direction: TransactionDirection;
  readonly date: string;
  readonly authorizationDate?: string;
  readonly postingDate?: string;
  readonly rawDescription: string;
  readonly rawMerchant?: string;
  readonly status: TransactionStatus;
  /** The original provider payload, kept for audit — never used in calculations. */
  readonly raw?: Readonly<Record<string, unknown>>;
}
