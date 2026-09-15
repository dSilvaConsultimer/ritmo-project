import { createServerFn } from "@tanstack/react-start";
import { getDb, getCategoryRulesList } from "@money-copilot/app-services";

/**
 * Raw data for the "Categorias e regras" screen (Mais → Conexões). Real,
 * global deterministic categorization rules (see
 * `packages/financial-engine/src/domain/category.ts`) — read-only: there is
 * no per-profile rule authoring UI yet, so this honestly shows what exists
 * rather than pretending to be an editor.
 */
export const getCategoriasData = createServerFn({ method: "GET" }).handler(async () => {
  const db = await getDb();
  const categoryRules = await getCategoryRulesList(db);
  return {
    categoryRules: categoryRules.map((r) => ({
      id: r.id,
      matchType: r.matchType,
      pattern: r.pattern,
      category: r.category,
      subcategory: r.subcategory ?? null,
    })),
  };
});

export type CategoriasData = Awaited<ReturnType<typeof getCategoriasData>>;
