import { describe, expect, it } from "vitest";
import type { MaisData } from "@/functions/mais";
import { toMaisViewModel } from "./mais";

function baseData(overrides: Partial<MaisData> = {}): MaisData {
  return {
    displayName: "Douglas",
    connectedInstitutionsCount: 0,
    categoryRuleCount: 21,
    quietHoursStart: null,
    quietHoursEnd: null,
    appVersion: "0.1.0",
    ...overrides,
  };
}

describe("toMaisViewModel", () => {
  it("derives initials only from the real known display name, never a fabricated last name", () => {
    const vm = toMaisViewModel(baseData());
    expect(vm.initials).toBe("D");
    expect(vm.groups[0]!.itens[0]!.hint).toBe("Douglas");
  });

  it("never invents a subscription plan the domain doesn't model", () => {
    const vm = toMaisViewModel(baseData());
    expect(vm.profileSubtitle).toBe("Ver perfil e dados da conta");
  });

  it("every item now has a real navigation destination", () => {
    const vm = toMaisViewModel(baseData());
    const allTargets = vm.groups.flatMap((g) => g.itens.map((i) => i.to));
    expect(allTargets).toEqual([
      "/perfil",
      "/notificacoes",
      "/conectar-banco",
      "/planejamento",
      "/ajuda",
      "/privacidade",
    ]);
  });

  it("(DEC-132) 'Categorias e regras' resolves to Planning's canonical rules/category area — never a second source of truth", () => {
    const vm = toMaisViewModel(baseData());
    const categoriasRow = vm.groups
      .flatMap((g) => g.itens)
      .find((i) => i.label === "Categorias e regras");
    expect(categoriasRow?.to).toBe("/planejamento");
  });

  it("shows the real package version, never a hardcoded/stale number", () => {
    const vm = toMaisViewModel(baseData({ appVersion: "1.2.3" }));
    expect(vm.appVersion).toBe("1.2.3");
  });

  it("shows the real quiet-hours window when configured, instead of a fabricated daily digest time", () => {
    const vm = toMaisViewModel(baseData({ quietHoursStart: "22:00", quietHoursEnd: "07:00" }));
    expect(vm.groups[0]!.itens[1]!.hint).toBe("Silencioso 22:00–07:00");
  });

  it("is honest that no digest is scheduled yet when quiet hours aren't configured", () => {
    const vm = toMaisViewModel(baseData());
    expect(vm.groups[0]!.itens[1]!.hint).toBe("Sem resumo agendado");
  });

  it("uses the real connected-institutions count, singular vs. plural", () => {
    expect(
      toMaisViewModel(baseData({ connectedInstitutionsCount: 0 })).groups[1]!.itens[0]!.hint,
    ).toBe("0 conectadas");
    expect(
      toMaisViewModel(baseData({ connectedInstitutionsCount: 1 })).groups[1]!.itens[0]!.hint,
    ).toBe("1 conectada");
    expect(
      toMaisViewModel(baseData({ connectedInstitutionsCount: 3 })).groups[1]!.itens[0]!.hint,
    ).toBe("3 conectadas");
  });

  it("shows the real category-rule count, never a hardcoded number", () => {
    const vm = toMaisViewModel(baseData({ categoryRuleCount: 21 }));
    expect(vm.groups[1]!.itens[1]!.hint).toBe("21 regras ativas");
  });
});
