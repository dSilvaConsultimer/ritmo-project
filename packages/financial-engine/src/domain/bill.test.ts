import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import { billFromExternalInput, type ExternalBillInput } from "./bill";
import { buildFinancialSnapshot } from "../snapshot/snapshot";
import { initialUserSnapshotInput } from "../fixtures/initial-user";

describe("billFromExternalInput", () => {
  it("maps a provider bill into the canonical CreditCardBill shape", () => {
    const input: ExternalBillInput = {
      provider: "pluggy",
      externalBillId: "bill-1",
      externalAccountId: "acc-1",
      dueDate: "2026-10-10",
      closingDate: "2026-10-01",
      totalAmountCents: 350_000,
      minimumPaymentCents: 35_000,
      allowsInstallments: true,
      certainty: "ACTUAL",
    };
    const bill = billFromExternalInput(
      input,
      createId("financial-profile"),
      createId("payment-source"),
      "2026-09-05",
    );
    expect(bill.totalAmount.cents).toBe(350_000);
    expect(bill.minimumPayment?.cents).toBe(35_000);
    expect(bill.dueDate).toBe("2026-10-10");
  });

  it("is never fed into FinancialSnapshot's committed totals (bills are not a second copy of consumption)", () => {
    // FinancialSnapshotInput has no `bills` field at all — a bill has no
    // code path into the snapshot calculation, structurally, not just by
    // convention. The snapshot only ever sees CreditCardBill data through
    // read models (see reporting/), never through buildFinancialSnapshot.
    expect(Object.keys(initialUserSnapshotInput)).not.toContain("bills");
    expect(buildFinancialSnapshot(initialUserSnapshotInput).safeToSpend.total.cents).toBe(217_111);
  });
});
