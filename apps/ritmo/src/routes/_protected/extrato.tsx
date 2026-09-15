import { createFileRoute } from "@tanstack/react-router";
import { Receipt } from "lucide-react";
import { PhoneShell, ScreenHeader } from "@/components/ritmo/PhoneShell";
import { getExtratoData } from "@/functions/extrato";
import { toExtratoViewModel } from "@/adapters/extrato";

/**
 * Extrato (DEC-129) — the full, all-time transaction ledger. Reached from
 * Home's main card ("Extrato →"), never from the bottom nav — this is a
 * detail screen, not a fifth tab, following the exact same
 * `ScreenHeader`/`PhoneShell` back-navigation pattern as the Mais subpages
 * (Categorias, Perfil, ...).
 */
export const Route = createFileRoute("/_protected/extrato")({
  head: () => ({ meta: [{ title: "Extrato — Ritmo" }] }),
  loader: () => getExtratoData(),
  component: Extrato,
});

function Extrato() {
  const data = Route.useLoaderData();
  const vm = toExtratoViewModel(data);

  return (
    <PhoneShell>
      <ScreenHeader title="Extrato" subtitle="Todas as suas movimentações" backTo="/" />

      {vm.isEmpty ? (
        <div className="surface flex flex-col items-center gap-3 p-8 text-center">
          <Receipt className="h-8 w-8 text-muted-foreground" />
          <p className="text-[13px] text-muted-foreground">
            Nenhuma movimentação encontrada ainda.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {vm.groups.map((group) => (
            <section key={group.key}>
              <h2 className="mb-3 text-[13px] font-semibold text-muted-foreground">
                {group.label}
              </h2>
              <div className="surface divide-y divide-border overflow-hidden">
                {group.items.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-3.5">
                    <div className="w-11 shrink-0 text-[11px] font-medium text-muted-foreground">
                      {item.dateLabel}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium">{item.label}</p>
                      <p className="truncate text-[12px] text-muted-foreground">
                        {item.categoryLabel}
                      </p>
                    </div>
                    <p
                      className={`num shrink-0 text-[14px] font-bold ${
                        item.isCredit ? "text-[var(--success)]" : "text-foreground"
                      }`}
                    >
                      {item.amountLabel}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PhoneShell>
  );
}
