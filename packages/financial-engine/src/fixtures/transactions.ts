import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import type { FinancialTransaction, PaymentSource, TransactionDirection } from "../domain/transaction";
import type { FinancialEffect } from "../domain/financial-effect";
import type { Certainty } from "../domain/certainty";
import { normalizeMerchant } from "../domain/merchant";
import { categorize } from "../domain/category";
import { merchantNormalizationRules, categoryRules } from "./rules";
import { FIXTURE_PROFILE_ID } from "./profile";

export const nubankCreditCard: PaymentSource = {
  id: createId("payment-source"),
  label: "Nubank",
  type: "CREDIT_CARD",
};

interface RawTransactionInput {
  readonly rawDescription: string;
  readonly rawMerchant: string;
  readonly amountReais: number;
  readonly date: string;
  readonly direction?: TransactionDirection;
  readonly financialEffect?: FinancialEffect;
  readonly certainty?: Certainty;
  readonly paymentSource?: PaymentSource;
}

/**
 * Builds a canonical `FinancialTransaction` by running raw merchant/
 * description text through the same deterministic normalization and
 * categorization rules a real pipeline would use — never hand-assigning a
 * category, so the fixture proves the rules actually work (including the
 * PagSeguro entry, which deliberately matches no rule and stays
 * UNCATEGORIZED).
 */
function buildTransaction(raw: RawTransactionInput): FinancialTransaction {
  const normalizedMerchant = normalizeMerchant(raw.rawMerchant, merchantNormalizationRules);
  const amount = M.fromReais(raw.amountReais);
  const direction = raw.direction ?? "DEBIT";
  const financialEffect = raw.financialEffect ?? "CONSUMPTION";
  const certainty = raw.certainty ?? "ACTUAL";
  const paymentSource = raw.paymentSource ?? nubankCreditCard;

  const partial: FinancialTransaction = {
    id: createId("transaction"),
    financialProfileId: FIXTURE_PROFILE_ID,
    paymentSource,
    date: raw.date,
    amount,
    direction,
    rawDescription: raw.rawDescription,
    normalizedDescription: raw.rawDescription.trim().toUpperCase(),
    rawMerchant: raw.rawMerchant,
    ...(normalizedMerchant !== undefined ? { normalizedMerchant } : {}),
    status: "POSTED",
    certainty,
    financialEffect,
    category: null,
    origin: "MANUAL",
    createdAt: raw.date,
    updatedAt: raw.date,
  };

  const { category, subcategory } = categorize(partial, categoryRules);
  return { ...partial, category, ...(subcategory !== undefined ? { subcategory } : {}) };
}

/**
 * Known real transactions from 2026-09-04/05 (see Sprint 2 brief). Amounts
 * and dates are the only facts taken from merchant names — no sensitive
 * personal interpretation of what any of these purchases represent is
 * recorded anywhere in this codebase or its documentation.
 */
export const septemberTransactions: readonly FinancialTransaction[] = [
  buildTransaction({
    rawDescription: "MINEIROS DOG",
    rawMerchant: "MINEIROS DOG",
    amountReais: 26.0,
    date: "2026-09-04",
  }),
  buildTransaction({
    rawDescription: "ADEGA DO RAI",
    rawMerchant: "ADEGA DO RAI",
    amountReais: 55.5,
    date: "2026-09-04",
  }),
  buildTransaction({
    rawDescription: "RODEO INGRESSOS ONLINE",
    rawMerchant: "RODEO INGRESSOS",
    amountReais: 476.1,
    date: "2026-09-04",
  }),
  buildTransaction({
    rawDescription: "OXXO CONVENIENCE",
    rawMerchant: "OXXO",
    amountReais: 40.78,
    date: "2026-09-04",
  }),
  buildTransaction({
    rawDescription: "TIKTOK SHOP BR",
    rawMerchant: "TIKTOK SHOP",
    amountReais: 173.02,
    date: "2026-09-04",
  }),
  buildTransaction({
    rawDescription: "PAGSEGURO*ESTABELEC",
    rawMerchant: "PAGSEGURO",
    amountReais: 12.49,
    date: "2026-09-04",
  }),
  buildTransaction({
    rawDescription: "IFOOD DINNER",
    rawMerchant: "IFOOD BR",
    amountReais: 45,
    date: "2026-09-05",
  }),
];
