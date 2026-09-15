import { describe, expect, it } from "vitest";
import type { Id } from "@money-copilot/shared";
import type { ExtratoData } from "@/functions/extrato";
import { toExtratoViewModel } from "./extrato";
import { brl } from "./format";

function txId(raw: string): Id<"transaction"> {
  return raw as Id<"transaction">;
}

function baseData(overrides: Partial<ExtratoData> = {}): ExtratoData {
  return {
    transactions: [],
    ...overrides,
  };
}

describe("toExtratoViewModel", () => {
  it("groups transactions by calendar month, preserving the already-newest-first order from the server", () => {
    const vm = toExtratoViewModel(
      baseData({
        transactions: [
          {
            id: txId("t1"),
            date: "2026-09-05",
            label: "SALARIO EMPRESA XYZ LTDA",
            amountCents: 850_000,
            direction: "CREDIT",
            category: "Receitas",
            subcategory: "Salário",
          },
          {
            id: txId("t2"),
            date: "2026-08-20",
            label: "COMPRA AGOSTO",
            amountCents: 5_000,
            direction: "DEBIT",
            category: null,
            subcategory: null,
          },
        ],
      }),
    );
    expect(vm.groups).toHaveLength(2);
    expect(vm.groups[0]!.label).toBe("Setembro de 2026");
    expect(vm.groups[0]!.items).toHaveLength(1);
    expect(vm.groups[1]!.label).toBe("Agosto de 2026");
    expect(vm.isEmpty).toBe(false);
  });

  it("shows the friendly label, signed amount, and short date for each transaction", () => {
    const vm = toExtratoViewModel(
      baseData({
        transactions: [
          {
            id: txId("t1"),
            date: "2026-09-05",
            label: "SALARIO EMPRESA XYZ LTDA",
            amountCents: 850_000,
            direction: "CREDIT",
            category: "Receitas",
            subcategory: "Salário",
          },
          {
            id: txId("t2"),
            date: "2026-09-05",
            label: "CONDOMINIO EDIFICIO SOLAR",
            amountCents: 80_000,
            direction: "DEBIT",
            category: "Moradia",
            subcategory: "Condomínio",
          },
        ],
      }),
    );
    const [salary, condo] = vm.groups[0]!.items;
    expect(salary!.label).toBe("SALARIO EMPRESA XYZ LTDA");
    expect(salary!.dateLabel).toBe("05 set");
    expect(salary!.amountLabel).toBe(`+ ${brl(850_000)}`);
    expect(salary!.isCredit).toBe(true);
    expect(salary!.categoryLabel).toBe("Receitas › Salário");

    expect(condo!.amountLabel).toBe(`- ${brl(80_000)}`);
    expect(condo!.isCredit).toBe(false);
    expect(condo!.categoryLabel).toBe("Moradia › Condomínio");
  });

  it("shows only the category when there is no subcategory", () => {
    const vm = toExtratoViewModel(
      baseData({
        transactions: [
          {
            id: txId("t1"),
            date: "2026-09-05",
            label: "FARMACIA MOCK",
            amountCents: 12_000,
            direction: "DEBIT",
            category: "Saúde",
            subcategory: null,
          },
        ],
      }),
    );
    expect(vm.groups[0]!.items[0]!.categoryLabel).toBe("Saúde");
  });

  it("falls back to the neutral 'Sem categoria' state when there is no category either", () => {
    const vm = toExtratoViewModel(
      baseData({
        transactions: [
          {
            id: txId("t1"),
            date: "2026-09-05",
            label: "PAGAMENTO DESCONHECIDO",
            amountCents: 1_000,
            direction: "DEBIT",
            category: null,
            subcategory: null,
          },
        ],
      }),
    );
    expect(vm.groups[0]!.items[0]!.categoryLabel).toBe("Sem categoria");
  });

  it("localizes the engine's UNCATEGORIZED sentinel the same as a null category", () => {
    const vm = toExtratoViewModel(
      baseData({
        transactions: [
          {
            id: txId("t1"),
            date: "2026-09-05",
            label: "PAGSEGURO",
            amountCents: 1_249,
            direction: "DEBIT",
            category: "UNCATEGORIZED",
            subcategory: null,
          },
        ],
      }),
    );
    expect(vm.groups[0]!.items[0]!.categoryLabel).toBe("Sem categoria");
  });

  it("reports isEmpty and no groups when there are no transactions", () => {
    const vm = toExtratoViewModel(baseData());
    expect(vm.isEmpty).toBe(true);
    expect(vm.groups).toEqual([]);
  });
});
