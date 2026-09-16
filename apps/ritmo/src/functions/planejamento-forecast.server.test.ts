import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * DEC-140: Planning's predictive forecast ("Compromissos fixos," "Gastos
 * variáveis," "Entradas previstas") end to end — real (temp file) PGlite +
 * a real Better Auth session, matching every other `.server.test.ts` in
 * this app. The individual detection/averaging algorithms already have
 * thorough unit coverage in `@money-copilot/financial-engine`
 * (`recurring-fixed.test.ts`, `forecasting.test.ts`) — this file proves
 * the WIRING through `getPlanningForecast`/`buildPlanejamentoData` is
 * correct, using the exact section-12 example from the product brief
 * ("Despesas de casa" containing several independently-recurring
 * merchants plus a genuine one-off).
 */
let currentHeaders: Headers = new Headers();

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => currentHeaders,
}));

import { convertSetCookieToCookie } from "better-auth/test";
import { createId } from "@money-copilot/shared";
import {
  fromReais,
  type FinancialTransaction,
  type PaymentSource,
} from "@money-copilot/financial-engine";
import * as repo from "@money-copilot/persistence";
import { getDb, resetDbCache, createCategory } from "@money-copilot/app-services";
import { getAuth } from "./auth.server";
import { getCurrentProfileContext } from "./profile.server";
import { buildPlanejamentoData } from "./planejamento-data.server";
import { resolveAsOfDate } from "./config";

const ASOF_DATE = resolveAsOfDate(new Date("2026-09-15T12:00:00Z"));

let tmpDir: string;

beforeAll(async () => {
  delete process.env["DEV_AUTH_BYPASS"];
  resetDbCache();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ritmo-planejamento-forecast-"));
  process.env["MONEY_COPILOT_DB_PATH"] = path.join(tmpDir, "test.pglite");
  await getDb();
});

afterAll(() => {
  resetDbCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function signUpAndGetSessionHeaders(
  email: string,
  password: string,
  name: string,
): Promise<Headers> {
  const auth = await getAuth();
  const response = await auth.api.signUpEmail({
    body: { email, password, name },
    asResponse: true,
  });
  expect(response.status, `signUpEmail(${email}) should succeed`).toBeLessThan(400);

  const setCookieHeaders = new Headers();
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() === "set-cookie") setCookieHeaders.append("set-cookie", value);
  });
  return convertSetCookieToCookie(setCookieHeaders);
}

async function checkingSource(db: Awaited<ReturnType<typeof getDb>>, financialProfileId: string) {
  const source: PaymentSource = {
    id: createId("payment-source"),
    label: "Conta Corrente",
    type: "DEBIT",
  };
  await repo.upsertPaymentSource(db, source, financialProfileId);
  return source;
}

function tx(
  financialProfileId: string,
  source: PaymentSource,
  overrides: Partial<FinancialTransaction>,
): FinancialTransaction {
  return {
    id: createId("transaction"),
    financialProfileId: financialProfileId as never,
    paymentSource: source,
    date: "2026-08-05",
    amount: fromReais(100),
    direction: "DEBIT",
    rawDescription: "GENERIC",
    normalizedDescription: "GENERIC",
    status: "POSTED",
    certainty: "ACTUAL",
    financialEffect: "CONSUMPTION",
    category: null,
    origin: "IMPORTED",
    createdAt: "2026-08-05",
    updatedAt: "2026-08-05",
    ...overrides,
  };
}

describe("Planning predictive forecast wiring (DEC-140)", () => {
  it("(section 12) 'Despesas de casa': independently-recurring merchants aggregate into Compromissos fixos; a one-off purchase in the same category does not", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "forecast-a@isolation-test.invalid",
      "supersecret123",
      "Forecast A",
    );
    const db = await getDb();
    const { financialProfileId } = await getCurrentProfileContext();
    const source = await checkingSource(db, financialProfileId);
    const despesasDeCasa = await createCategory(db, financialProfileId, {
      name: "Despesas de casa",
    });

    const rows: FinancialTransaction[] = [
      // ALUGUEL — recurring, same amount.
      tx(financialProfileId, source, {
        normalizedMerchant: "ALUGUEL",
        date: "2026-06-01",
        amount: fromReais(1500),
        categoryId: despesasDeCasa.id,
      }),
      tx(financialProfileId, source, {
        normalizedMerchant: "ALUGUEL",
        date: "2026-07-01",
        amount: fromReais(1500),
        categoryId: despesasDeCasa.id,
      }),
      tx(financialProfileId, source, {
        normalizedMerchant: "ALUGUEL",
        date: "2026-08-01",
        amount: fromReais(1500),
        categoryId: despesasDeCasa.id,
      }),
      // CONDOMINIO — recurring, same amount.
      tx(financialProfileId, source, {
        normalizedMerchant: "CONDOMINIO",
        date: "2026-06-05",
        amount: fromReais(450),
        categoryId: despesasDeCasa.id,
      }),
      tx(financialProfileId, source, {
        normalizedMerchant: "CONDOMINIO",
        date: "2026-07-05",
        amount: fromReais(450),
        categoryId: despesasDeCasa.id,
      }),
      tx(financialProfileId, source, {
        normalizedMerchant: "CONDOMINIO",
        date: "2026-08-05",
        amount: fromReais(450),
        categoryId: despesasDeCasa.id,
      }),
      // ENERGIA — recurring, VARYING amount.
      tx(financialProfileId, source, {
        normalizedMerchant: "ENERGIA",
        date: "2026-06-10",
        amount: fromReais(180),
        categoryId: despesasDeCasa.id,
      }),
      tx(financialProfileId, source, {
        normalizedMerchant: "ENERGIA",
        date: "2026-07-10",
        amount: fromReais(235),
        categoryId: despesasDeCasa.id,
      }),
      tx(financialProfileId, source, {
        normalizedMerchant: "ENERGIA",
        date: "2026-08-10",
        amount: fromReais(207),
        categoryId: despesasDeCasa.id,
      }),
      // A genuine one-off purchase — same category, only one occurrence.
      tx(financialProfileId, source, {
        normalizedMerchant: "LOJA MOVEIS",
        date: "2026-08-15",
        amount: fromReais(2000),
        categoryId: despesasDeCasa.id,
      }),
    ];
    for (const row of rows) await repo.upsertTransaction(db, row);

    const planning = await buildPlanejamentoData(db, financialProfileId, ASOF_DATE, "current");

    // 1500 + 450 + (180+235+207)/3=207.33 -> 20733 cents => total 215233
    const expectedFixedCents = fromReais(1500).cents + fromReais(450).cents + 20_733;
    expect(planning.fixedCommitmentsCents).toBe(expectedFixedCents);

    // The one-off LOJA MOVEIS purchase must never be swept into "Compromissos
    // fixos" — it should instead surface (partially) in the variable
    // residual, never disappear and never inflate the fixed total.
    expect(planning.fixedCommitmentsCents).toBeLessThan(expectedFixedCents + fromReais(2000).cents);
  });

  it("'Entradas previstas' reflects the 3-month income average, independent of category or declared Income records", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "forecast-b@isolation-test.invalid",
      "supersecret123",
      "Forecast B",
    );
    const db = await getDb();
    const { financialProfileId } = await getCurrentProfileContext();
    const source = await checkingSource(db, financialProfileId);

    const rows: FinancialTransaction[] = [
      tx(financialProfileId, source, {
        direction: "CREDIT",
        financialEffect: "INCOME",
        date: "2026-06-05",
        amount: fromReais(8500),
      }),
      tx(financialProfileId, source, {
        direction: "CREDIT",
        financialEffect: "INCOME",
        date: "2026-07-05",
        amount: fromReais(8500),
      }),
      tx(financialProfileId, source, {
        direction: "CREDIT",
        financialEffect: "INCOME",
        date: "2026-08-05",
        amount: fromReais(8500),
      }),
    ];
    for (const row of rows) await repo.upsertTransaction(db, row);

    const planning = await buildPlanejamentoData(db, financialProfileId, ASOF_DATE, "current");
    expect(planning.futureIncomeCents).toBe(fromReais(8500).cents);
  });

  it("a recurring card subscription (Netflix, no installment marker) is recognized as fixed; a card installment ('3/12') is not", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "forecast-c@isolation-test.invalid",
      "supersecret123",
      "Forecast C",
    );
    const db = await getDb();
    const { financialProfileId } = await getCurrentProfileContext();
    const source = await checkingSource(db, financialProfileId);

    const rows: FinancialTransaction[] = [
      tx(financialProfileId, source, {
        normalizedMerchant: "NETFLIX",
        date: "2026-06-05",
        amount: fromReais(39.9),
      }),
      tx(financialProfileId, source, {
        normalizedMerchant: "NETFLIX",
        date: "2026-07-05",
        amount: fromReais(39.9),
      }),
      tx(financialProfileId, source, {
        normalizedMerchant: "NETFLIX",
        date: "2026-08-05",
        amount: fromReais(39.9),
      }),
      tx(financialProfileId, source, {
        normalizedMerchant: "LOJA X",
        rawDescription: "LOJA X 3/12",
        normalizedDescription: "LOJA X 3/12",
        date: "2026-06-20",
        amount: fromReais(200),
      }),
      tx(financialProfileId, source, {
        normalizedMerchant: "LOJA X",
        rawDescription: "LOJA X 4/12",
        normalizedDescription: "LOJA X 4/12",
        date: "2026-07-20",
        amount: fromReais(200),
      }),
      tx(financialProfileId, source, {
        normalizedMerchant: "LOJA X",
        rawDescription: "LOJA X 5/12",
        normalizedDescription: "LOJA X 5/12",
        date: "2026-08-20",
        amount: fromReais(200),
      }),
    ];
    for (const row of rows) await repo.upsertTransaction(db, row);

    const planning = await buildPlanejamentoData(db, financialProfileId, ASOF_DATE, "current");
    // Only Netflix (39.90) counts toward "Compromissos fixos" — the 200/mo
    // installment must never be counted as an indefinite fixed commitment.
    expect(planning.fixedCommitmentsCents).toBe(fromReais(39.9).cents);
  });

  it("(test H) a realized current-month salary still shows in Entradas previstas without inflating Disponível — the forecast and Safe-to-Spend never interact", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "forecast-d@isolation-test.invalid",
      "supersecret123",
      "Forecast D",
    );
    const db = await getDb();
    const { financialProfileId } = await getCurrentProfileContext();
    const source = await checkingSource(db, financialProfileId);

    const rows: FinancialTransaction[] = [
      tx(financialProfileId, source, {
        direction: "CREDIT",
        financialEffect: "INCOME",
        date: "2026-06-05",
        amount: fromReais(8500),
      }),
      tx(financialProfileId, source, {
        direction: "CREDIT",
        financialEffect: "INCOME",
        date: "2026-07-05",
        amount: fromReais(8500),
      }),
      tx(financialProfileId, source, {
        direction: "CREDIT",
        financialEffect: "INCOME",
        date: "2026-08-05",
        amount: fromReais(8500),
      }),
      // This month's salary — ALREADY realized.
      tx(financialProfileId, source, {
        direction: "CREDIT",
        financialEffect: "INCOME",
        date: "2026-09-05",
        amount: fromReais(8500),
      }),
    ];
    for (const row of rows) await repo.upsertTransaction(db, row);

    const result = await buildPlanejamentoData(db, financialProfileId, ASOF_DATE, "current");

    // The forecast shows the normal predicted amount regardless of this
    // month's realization...
    expect(result.futureIncomeCents).toBe(fromReais(8500).cents);
    // ...while Safe-to-Spend/liquidity (no connected account, no declared
    // Income here) stays exactly what it would be with no forecast
    // involved at all — the September salary transaction never reaches
    // `availableCents` through this code path, because the forecast and
    // Safe-to-Spend simply never share any data.
    expect(result.availableBasis).toBe("PLAN_BASED");
    expect(result.availableCents).toBe(0);
  });
});
