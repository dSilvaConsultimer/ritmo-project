import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * DEC-137 (Issue B): a permanent regression test proving Home and Planning
 * can never disagree about "how much is actually available right now" for
 * the same profile/asOfDate — the exact bug this decision fixed (Planning
 * showed -R$973,20 from the plan-based `snapshot.safeToSpend.total` while
 * Home correctly showed a real, positive, liquidity-aware figure from
 * `snapshot.liquidity.recommendedTotal` for the SAME staging profile).
 *
 * Uses the real `buildHomeData`/`buildPlanejamentoData` functions (not a
 * re-derivation of the same math) — see those files' own doc comments for
 * why the `createServerFn` bodies were split into plain, directly-callable
 * functions specifically to make this test possible. Real (temp file)
 * PGlite + a real Better Auth session, matching
 * `planejamento-criar.server.test.ts`'s own established pattern — no
 * mocked auth, no client-supplied `financialProfileId`.
 */
let currentHeaders: Headers = new Headers();

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => currentHeaders,
}));

import { convertSetCookieToCookie } from "better-auth/test";
import { createId } from "@money-copilot/shared";
import { actual, fromReais, type PaymentSource } from "@money-copilot/financial-engine";
import * as repo from "@money-copilot/persistence";
import { getDb, resetDbCache } from "@money-copilot/app-services";
import { getAuth } from "./auth.server";
import { getCurrentProfileContext } from "./profile.server";
import { buildHomeData } from "./home.server";
import { buildPlanejamentoData } from "./planejamento-data.server";
import { resolveAsOfDate } from "./config";

const ASOF_DATE = resolveAsOfDate(new Date("2026-09-05T12:00:00Z"));

let tmpDir: string;

beforeAll(async () => {
  delete process.env["DEV_AUTH_BYPASS"];
  resetDbCache();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ritmo-home-planning-consistency-"));
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

describe("Home vs Planning: the canonical available figure must reconcile (DEC-137)", () => {
  it("Home.safeToSpendCents === Planning.availableCents for the same real liquidity-aware profile, and matches the manual arithmetic", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "consistency-a@isolation-test.invalid",
      "supersecret123",
      "Consistency A",
    );
    const db = await getDb();
    const { financialProfileId } = await getCurrentProfileContext();

    // Real current usable liquidity: R$28.059,56 checking, R$670,80 card
    // outstanding — the exact staging reference figures from this
    // decision's bug report (28_059.56 - 670.80 = 27_388.76).
    const checking: PaymentSource = {
      id: createId("payment-source"),
      label: "Conta Corrente",
      type: "DEBIT",
      subtype: "CHECKING_ACCOUNT",
      provider: "pluggy",
      externalAccountId: "acc-checking-consistency",
      balance: actual(fromReais(28_059.56)),
      availableBalance: actual(fromReais(28_059.56)),
    };
    const card: PaymentSource = {
      id: createId("payment-source"),
      label: "Cartão",
      type: "CREDIT_CARD",
      subtype: "CREDIT_CARD",
      provider: "pluggy",
      externalAccountId: "acc-card-consistency",
      balance: actual(fromReais(670.8)),
    };
    await repo.upsertPaymentSource(db, checking, financialProfileId);
    await repo.upsertPaymentSource(db, card, financialProfileId);

    const home = await buildHomeData(db, financialProfileId, "Test", ASOF_DATE);
    const planning = await buildPlanejamentoData(db, financialProfileId, ASOF_DATE, "current");

    // The bug this decision fixed: these two used to read different
    // snapshot fields and could disagree for the exact same profile.
    expect(planning.availableBasis).toBe("LIQUIDITY_AWARE");
    expect(planning.availableCents).toBe(home.safeToSpendCents);
    expect(planning.availableCents).toBe(2_738_876); // R$27.388,76

    // The breakdown Planning now shows reconciles to the same total: no
    // fixed/variable/event commitments exist for this profile, so the only
    // components are current cash and the card obligation.
    expect(planning.currentUsableCashCents).toBe(2_805_956); // R$28.059,56
    expect(planning.cardAndInstallmentsCents).toBe(67_080); // R$670,80
    expect(planning.currentUsableCashCents! - planning.cardAndInstallmentsCents).toBe(
      planning.availableCents,
    );
  });

  it("falls back to the same PLAN_BASED figure on both screens when no account is connected yet", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "consistency-b@isolation-test.invalid",
      "supersecret123",
      "Consistency B",
    );
    const db = await getDb();
    const { financialProfileId } = await getCurrentProfileContext();

    const home = await buildHomeData(db, financialProfileId, "Test", ASOF_DATE);
    const planning = await buildPlanejamentoData(db, financialProfileId, ASOF_DATE, "current");

    expect(planning.availableBasis).toBe("PLAN_BASED");
    expect(planning.availableCents).toBe(home.safeToSpendCents);
    expect(planning.currentUsableCashCents).toBeNull();
  });
});
