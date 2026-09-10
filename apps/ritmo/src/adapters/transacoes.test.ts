import { describe, expect, it } from "vitest";
import type { Id } from "@money-copilot/shared";
import type { TransacoesData } from "@/functions/transacoes";
import { toTransacoesViewModel } from "./transacoes";

function feId(raw: string): Id<"fixed-expense"> {
  return raw as Id<"fixed-expense">;
}
function txId(raw: string): Id<"transaction"> {
  return raw as Id<"transaction">;
}

function baseData(overrides: Partial<TransacoesData> = {}): TransacoesData {
  return {
    asOfDate: "2026-09-05",
    fixedExpenses: [],
    transactions: [],
    ...overrides,
  };
}

describe("toTransacoesViewModel", () => {
  it("sorts recurring commitments with known due days first, unknown last", () => {
    const vm = toTransacoesViewModel(
      baseData({
        fixedExpenses: [
          { id: feId("unknown"), label: "A", category: "X", amountCents: 100, dueDayOfMonth: null },
          { id: feId("known-10"), label: "B", category: "X", amountCents: 100, dueDayOfMonth: 10 },
          { id: feId("known-5"), label: "C", category: "X", amountCents: 100, dueDayOfMonth: 5 },
        ],
      }),
    );
    expect(vm.recorrentes.map((c) => c.id)).toEqual(["known-5", "known-10", "unknown"]);
    expect(vm.recorrentes[0]!.detail).toBe("X · todo dia 5");
    expect(vm.recorrentes[2]!.dueDayBadge).toBe("–");
    expect(vm.recorrentes[2]!.detail).toBe("X"); // no fabricated due-day clause
  });

  it("groups transactions into Hoje/Ontem/Esta semana relative to asOfDate, most-recent-first", () => {
    const vm = toTransacoesViewModel(
      baseData({
        transactions: [
          {
            id: txId("t1"),
            date: "2026-09-04",
            label: "Adega",
            category: "Food",
            amountCents: 5550,
            direction: "DEBIT",
          },
          {
            id: txId("t2"),
            date: "2026-09-05",
            label: "iFood",
            category: "Food",
            amountCents: 4500,
            direction: "DEBIT",
          },
          {
            id: txId("t3"),
            date: "2026-09-01",
            label: "Salário",
            category: null,
            amountCents: 720000,
            direction: "CREDIT",
          },
        ],
      }),
    );
    expect(vm.grupos.map((g) => g.label)).toEqual(["Hoje", "Ontem", "Esta semana"]);
    expect(vm.grupos[0]!.items[0]!.label).toBe("iFood");
    expect(vm.grupos[1]!.items[0]!.label).toBe("Adega");
    expect(vm.grupos[2]!.items[0]!.label).toBe("Salário");
    expect(vm.grupos[2]!.items[0]!.tag).toBe("Sem categoria");
  });

  it("shows an honest date instead of a fabricated time, and a signed amount", () => {
    const vm = toTransacoesViewModel(
      baseData({
        transactions: [
          {
            id: txId("t1"),
            date: "2026-09-05",
            label: "iFood",
            category: "Food",
            amountCents: 4500,
            direction: "DEBIT",
          },
          {
            id: txId("t2"),
            date: "2026-09-05",
            label: "Salário",
            category: null,
            amountCents: 720000,
            direction: "CREDIT",
          },
        ],
      }),
    );
    const [debit, credit] = vm.grupos[0]!.items;
    expect(debit!.dateLabel).toBe("05/09");
    expect(debit!.amountLabel).toBe("- R$ 45,00");
    expect(debit!.isCredit).toBe(false);
    expect(credit!.amountLabel).toBe("+ R$ 7.200,00");
    expect(credit!.isCredit).toBe(true);
  });

  it("localizes the engine's UNCATEGORIZED sentinel the same as a null category", () => {
    const vm = toTransacoesViewModel(
      baseData({
        transactions: [
          {
            id: txId("t1"),
            date: "2026-09-05",
            label: "Pagseguro",
            category: "UNCATEGORIZED",
            amountCents: 1249,
            direction: "DEBIT",
          },
        ],
      }),
    );
    expect(vm.grupos[0]!.items[0]!.tag).toBe("Sem categoria");
  });

  it("omits a group entirely when it has no real transactions, never renders it empty", () => {
    const vm = toTransacoesViewModel(baseData());
    expect(vm.grupos).toEqual([]);
  });
});
