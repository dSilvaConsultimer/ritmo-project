import type { Id } from "@money-copilot/shared";
import type { Category } from "../domain/category";

/**
 * DEC-135: the V1 canonical BASE category taxonomy — global, available to
 * every profile, never mutated by any user flow (a user who disagrees
 * creates a PERSONAL category instead — see `mutations.createCategory`).
 *
 * Reconciled against what DEC-134's `system-default-category-rules.ts`
 * ALREADY shipped as live `category_rules.category` string values
 * ("Transporte," "Assinaturas," "Delivery," "Academia," "Combustível") —
 * this list reuses those exact same names rather than inventing slightly
 * different ones, so linking those existing rules to a canonical
 * `categoryId` (DEC-135's migration) is a real, exact match rather than a
 * fuzzy one. Two small deliberate normalizations from the requesting
 * product brief's own illustrative examples, reported rather than applied
 * silently: "Restaurantes / Delivery" -> "Delivery" (matches the
 * already-live DEC-134 string exactly instead of fragmenting it into a
 * second, different label for the same concept), and "Tarifas / Impostos"
 * -> "Tarifas e Impostos" (avoids a literal slash character in a stored/
 * displayed category name).
 */
export const baseCategoryAlimentacao: Category = {
  id: "category_base-alimentacao" as Id<"category">,
  name: "Alimentação",
};
export const baseCategoryDelivery: Category = { id: "category_base-delivery" as Id<"category">, name: "Delivery" };
export const baseCategoryTransporte: Category = {
  id: "category_base-transporte" as Id<"category">,
  name: "Transporte",
};
export const baseCategoryCombustivel: Category = {
  id: "category_base-combustivel" as Id<"category">,
  name: "Combustível",
};
export const baseCategoryMoradia: Category = { id: "category_base-moradia" as Id<"category">, name: "Moradia" };
export const baseCategorySaude: Category = { id: "category_base-saude" as Id<"category">, name: "Saúde" };
export const baseCategoryAcademia: Category = { id: "category_base-academia" as Id<"category">, name: "Academia" };
export const baseCategoryAssinaturas: Category = {
  id: "category_base-assinaturas" as Id<"category">,
  name: "Assinaturas",
};
export const baseCategoryLazer: Category = { id: "category_base-lazer" as Id<"category">, name: "Lazer" };
export const baseCategoryCompras: Category = { id: "category_base-compras" as Id<"category">, name: "Compras" };
export const baseCategoryEducacao: Category = { id: "category_base-educacao" as Id<"category">, name: "Educação" };
export const baseCategoryContas: Category = { id: "category_base-contas" as Id<"category">, name: "Contas" };
export const baseCategoryTarifasImpostos: Category = {
  id: "category_base-tarifas-impostos" as Id<"category">,
  name: "Tarifas e Impostos",
};
export const baseCategoryRenda: Category = { id: "category_base-renda" as Id<"category">, name: "Renda" };
export const baseCategoryInvestimentos: Category = {
  id: "category_base-investimentos" as Id<"category">,
  name: "Investimentos",
};
export const baseCategoryOutros: Category = { id: "category_base-outros" as Id<"category">, name: "Outros" };

export const baseCategories: readonly Category[] = [
  baseCategoryAlimentacao,
  baseCategoryDelivery,
  baseCategoryTransporte,
  baseCategoryCombustivel,
  baseCategoryMoradia,
  baseCategorySaude,
  baseCategoryAcademia,
  baseCategoryAssinaturas,
  baseCategoryLazer,
  baseCategoryCompras,
  baseCategoryEducacao,
  baseCategoryContas,
  baseCategoryTarifasImpostos,
  baseCategoryRenda,
  baseCategoryInvestimentos,
  baseCategoryOutros,
];
