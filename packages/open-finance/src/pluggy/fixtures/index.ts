import type { Account, Connector, Item, Transaction } from "pluggy-sdk";
import { TransactionStatus } from "pluggy-sdk";
import type { CreditCardBills } from "pluggy-sdk/dist/types/creditCardBills";
import type { WebhookEventPayload } from "pluggy-sdk";

/**
 * Sanitized, entirely synthetic Pluggy-shaped fixtures for automated
 * tests. None of this represents a real user's financial data — see
 * NON-NEGOTIABLE (Sprint 3): "these fixtures must not contain real user
 * financial data."
 */

export const fixtureBankAccount: Account = {
  id: "fixture-bank-account-1",
  itemId: "fixture-item-1",
  type: "BANK",
  subtype: "CHECKING_ACCOUNT",
  number: "0001-1",
  balance: 1_250.5,
  name: "Conta Corrente",
  marketingName: "Conta Corrente Fixture Bank",
  owner: null,
  taxNumber: null,
  currencyCode: "BRL",
  bankData: {
    transferNumber: "0001-1",
    closingBalance: 1_250.5,
    automaticallyInvestedBalance: null,
    overdraftContractedLimit: null,
    overdraftUsedLimit: null,
    unarrangedOverdraftAmount: null,
    hasReservedBalance: null,
    reservedBalances: null,
  },
  creditData: null,
};

export const fixtureCreditCardAccount: Account = {
  id: "fixture-credit-card-1",
  itemId: "fixture-item-1",
  type: "CREDIT",
  subtype: "CREDIT_CARD",
  number: "**** 1234",
  balance: 850.0,
  name: "Cartao de Credito",
  marketingName: "Fixture Card",
  owner: null,
  taxNumber: null,
  currencyCode: "BRL",
  bankData: null,
  creditData: {
    level: "GOLD",
    brand: "MASTERCARD",
    balanceCloseDate: new Date("2026-10-01"),
    balanceDueDate: new Date("2026-10-10"),
    availableCreditLimit: 4_150.0,
    balanceForeignCurrency: null,
    minimumPayment: 85.0,
    creditLimit: 5_000.0,
    isLimitFlexible: null,
    status: "ACTIVE",
    holderType: "MAIN",
  },
};

export const fixtureBankDebitTransaction: Transaction = {
  id: "fixture-tx-bank-debit-1",
  accountId: fixtureBankAccount.id,
  date: new Date("2026-09-04"),
  description: "COMPRA DEBITO MERCADO",
  descriptionRaw: "COMPRA DEBITO MERCADO",
  type: "DEBIT",
  amount: 89.9,
  amountInAccountCurrency: null,
  balance: 1_160.6,
  currencyCode: "BRL",
  category: "Groceries",
  status: TransactionStatus.POSTED,
  creditCardMetadata: null,
  categoryId: null,
  operationType: null,
  operationTypeAdditionalInfo: null,
  providerId: null,
  createdAt: new Date("2026-09-04"),
  updatedAt: new Date("2026-09-04"),
};

export const fixtureBankCreditTransaction: Transaction = {
  ...fixtureBankDebitTransaction,
  id: "fixture-tx-bank-credit-1",
  description: "SALARIO",
  descriptionRaw: "SALARIO",
  type: "CREDIT",
  amount: 5_000,
};

export const fixtureBankTransferTransaction: Transaction = {
  ...fixtureBankDebitTransaction,
  id: "fixture-tx-bank-transfer-1",
  description: "TRANSFERENCIA ENTRE CONTAS PROPRIAS",
  descriptionRaw: "TRANSFERENCIA ENTRE CONTAS PROPRIAS",
  type: "DEBIT",
  amount: 500,
};

export const fixtureCardPurchaseTransaction: Transaction = {
  id: "fixture-tx-card-purchase-1",
  accountId: fixtureCreditCardAccount.id,
  date: new Date("2026-09-04"),
  description: "RESTAURANTE FIXTURE",
  descriptionRaw: "RESTAURANTE FIXTURE",
  type: "DEBIT",
  amount: 150.0,
  amountInAccountCurrency: null,
  balance: 1_000.0,
  currencyCode: "BRL",
  category: "Food",
  status: TransactionStatus.POSTED,
  creditCardMetadata: null,
  categoryId: null,
  operationType: null,
  operationTypeAdditionalInfo: null,
  providerId: null,
  createdAt: new Date("2026-09-04"),
  updatedAt: new Date("2026-09-04"),
};

export const fixturePendingCardPurchaseTransaction: Transaction = {
  ...fixtureCardPurchaseTransaction,
  id: "fixture-tx-card-pending-1",
  status: TransactionStatus.PENDING,
};

export const fixturePostedCardPurchaseTransaction: Transaction = {
  ...fixturePendingCardPurchaseTransaction,
  status: TransactionStatus.POSTED,
};

export const fixtureCardPaymentTransaction: Transaction = {
  ...fixtureCardPurchaseTransaction,
  id: "fixture-tx-card-payment-1",
  description: "PAGAMENTO DE FATURA",
  descriptionRaw: "PAGAMENTO DE FATURA",
  type: "CREDIT",
  amount: 850.0,
};

export const fixtureCardRefundTransaction: Transaction = {
  ...fixtureCardPurchaseTransaction,
  id: "fixture-tx-card-refund-1",
  description: "ESTORNO COMPRA RESTAURANTE FIXTURE",
  descriptionRaw: "ESTORNO COMPRA RESTAURANTE FIXTURE",
  type: "CREDIT",
  amount: 150.0,
};

export const fixtureCardFeeTransaction: Transaction = {
  ...fixtureCardPurchaseTransaction,
  id: "fixture-tx-card-fee-1",
  description: "ANUIDADE CARTAO",
  descriptionRaw: "ANUIDADE CARTAO",
  type: "DEBIT",
  amount: 30.0,
};

export const fixtureBankFeeTransaction: Transaction = {
  ...fixtureBankDebitTransaction,
  id: "fixture-tx-bank-fee-1",
  description: "TARIFA MANUTENCAO CONTA",
  descriptionRaw: "TARIFA MANUTENCAO CONTA",
  type: "DEBIT",
  amount: 12.0,
};

export const fixtureInstallmentPurchaseTransaction: Transaction = {
  ...fixtureCardPurchaseTransaction,
  id: "fixture-tx-card-installment-1",
  description: "LOJA ELETRONICOS 3/10",
  descriptionRaw: "LOJA ELETRONICOS 3/10",
  amount: 200.0,
  creditCardMetadata: {
    installmentNumber: 3,
    totalInstallments: 10,
    totalAmount: 2_000.0,
    payeeMCC: 5732,
    purchaseDate: new Date("2026-07-04"),
    billId: "fixture-bill-1",
    cardNumber: "**** 1234",
  },
};

export const fixtureCreditCardBill: CreditCardBills = {
  id: "fixture-bill-1",
  dueDate: new Date("2026-10-10"),
  billClosingDate: new Date("2026-10-01"),
  totalAmount: 850.0,
  totalAmountCurrencyCode: "BRL",
  minimumPaymentAmount: 85.0,
  allowsInstallments: true,
  financeCharges: [],
  payments: [],
  createdAt: new Date("2026-09-05"),
  updatedAt: new Date("2026-09-05"),
};

const fixtureConnector: Connector = {
  id: 999,
  name: "Fixture Sandbox Bank",
  primaryColor: "000000",
  institutionUrl: "https://example.invalid",
  country: "BR",
  type: "PERSONAL_BANK",
  credentials: [],
  imageUrl: "https://example.invalid/logo.png",
  hasMFA: false,
  products: ["ACCOUNTS", "TRANSACTIONS"],
  createdAt: new Date("2026-01-01"),
  isSandbox: true,
  supportsPaymentInitiation: false,
  isOpenFinance: false,
  health: { status: "ONLINE", stage: null },
  supportsScheduledPayments: false,
  supportsSmartTransfers: false,
  supportsAutomaticPix: false,
  supportsBoletoManagement: false,
};

export const fixtureItem: Item = {
  id: "fixture-item-1",
  connector: fixtureConnector,
  status: "UPDATED",
  statusDetail: null,
  error: null,
  executionStatus: "SUCCESS" as Item["executionStatus"],
  createdAt: new Date("2026-09-01"),
  updatedAt: new Date("2026-09-05"),
  lastUpdatedAt: new Date("2026-09-05"),
  parameter: null,
  webhookUrl: null,
  clientUserId: "fixture-profile-1",
  userAction: null,
  consecutiveFailedLoginAttempts: 0,
  nextAutoSyncAt: null,
  consentExpiresAt: null,
};

export const fixtureItemCreatedWebhook: WebhookEventPayload = {
  id: fixtureItem.id,
  eventId: "fixture-event-item-created-1",
  event: "item/created",
  itemId: fixtureItem.id,
};

export const fixtureTransactionsCreatedWebhook: WebhookEventPayload = {
  id: fixtureCreditCardAccount.id,
  eventId: "fixture-event-tx-created-1",
  event: "transactions/created",
  itemId: fixtureItem.id,
  accountId: fixtureCreditCardAccount.id,
  transactionsCreatedAtFrom: "2026-09-04T00:00:00.000Z",
  createdTransactionsLink: "https://api.pluggy.ai/transactions?accountId=fixture-credit-card-1",
};

export const fixtureTransactionsUpdatedWebhook: WebhookEventPayload = {
  id: fixtureCreditCardAccount.id,
  eventId: "fixture-event-tx-updated-1",
  event: "transactions/updated",
  itemId: fixtureItem.id,
  clientId: "fixture-client-1",
  accountId: fixtureCreditCardAccount.id,
  transactionIds: [fixturePostedCardPurchaseTransaction.id],
};

export const fixtureTransactionsDeletedWebhook: WebhookEventPayload = {
  id: fixtureCreditCardAccount.id,
  eventId: "fixture-event-tx-deleted-1",
  event: "transactions/deleted",
  itemId: fixtureItem.id,
  clientId: "fixture-client-1",
  accountId: fixtureCreditCardAccount.id,
  transactionIds: [fixtureCardPurchaseTransaction.id],
};
