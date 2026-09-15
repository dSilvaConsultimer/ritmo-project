import { createFileRoute } from "@tanstack/react-router";
import { Tag } from "lucide-react";
import { PhoneShell, ScreenHeader } from "@/components/ritmo/PhoneShell";
import { getCategoriasData } from "@/functions/categorias";

const MATCH_TYPE_LABEL: Record<string, string> = {
  EXACT_MERCHANT: "Comerciante exato",
  CONTAINS_MERCHANT: "Contém no comerciante",
  CONTAINS_DESCRIPTION: "Contém na descrição",
  REGEX_DESCRIPTION: "Padrão na descrição",
};

export const Route = createFileRoute("/_protected/categorias")({
  head: () => ({ meta: [{ title: "Categorias e regras — Ritmo" }] }),
  loader: () => getCategoriasData(),
  component: Categorias,
});

function Categorias() {
  const data = Route.useLoaderData();

  return (
    <PhoneShell>
      <ScreenHeader
        title="Categorias e regras"
        subtitle={`${data.categoryRules.length} regras ativas`}
        backTo="/mais"
      />

      <p className="mb-4 text-[12.5px] text-muted-foreground">
        O Ritmo categoriza suas movimentações automaticamente com estas regras, sempre na mesma
        ordem — sem inteligência artificial e sem adivinhação. Uma movimentação que não bate com
        nenhuma regra fica "Sem categoria" em vez de ser encaixada à força.
      </p>

      {data.categoryRules.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nenhuma regra cadastrada ainda.</p>
      ) : (
        <div className="surface divide-y divide-border overflow-hidden">
          {data.categoryRules.map((rule) => (
            <div key={rule.id} className="flex items-center gap-3 px-4 py-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Tag className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">
                  {rule.category}
                  {rule.subcategory ? ` · ${rule.subcategory}` : ""}
                </p>
                <p className="truncate text-[12px] text-muted-foreground">
                  {MATCH_TYPE_LABEL[rule.matchType] ?? rule.matchType}: "{rule.pattern}"
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </PhoneShell>
  );
}
