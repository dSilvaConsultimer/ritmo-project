import { createFileRoute } from "@tanstack/react-router";
import { PhoneShell, ScreenHeader } from "@/components/ritmo/PhoneShell";
import { ThemeToggle } from "@/components/ritmo/ThemeToggle";
import { getTransacoesData } from "@/functions/transacoes";
import { toTransacoesViewModel } from "@/adapters/transacoes";

export const Route = createFileRoute("/transacoes")({
  head: () => ({
    meta: [
      { title: "Movimentações e compromissos — Ritmo" },
      {
        name: "description",
        content:
          "Todas as suas entradas, gastos, assinaturas e contas fixas agrupadas de forma clara.",
      },
      { property: "og:title", content: "Movimentações e compromissos — Ritmo" },
      {
        property: "og:description",
        content: "Entradas, gastos e recorrências organizados por padrão.",
      },
    ],
  }),
  loader: () => getTransacoesData(),
  component: Transacoes,
});

function Transacoes() {
  const data = Route.useLoaderData();
  const vm = toTransacoesViewModel(data);

  return (
    <PhoneShell>
      <ScreenHeader title="Movimentações" subtitle="Mês atual" action={<ThemeToggle />} />

      <div className="no-scrollbar -mx-5 mb-5 flex gap-2 overflow-x-auto px-5">
        {["Tudo", "Fixos", "Assinaturas", "Entradas", "Variáveis"].map((f, idx) => (
          <button
            key={f}
            className={`shrink-0 rounded-full px-3.5 py-2 text-[12.5px] font-semibold ${
              idx === 0
                ? "brand-gradient text-primary-foreground"
                : "border border-border bg-card text-muted-foreground"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <section>
        <h2 className="mb-3 font-display text-[15px] font-bold">Recorrentes do mês</h2>
        {vm.recorrentes.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Nenhum compromisso fixo cadastrado ainda.
          </p>
        ) : (
          <div className="surface divide-y divide-border overflow-hidden">
            {vm.recorrentes.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent font-display text-[13px] font-bold text-accent-foreground">
                  {c.label.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{c.label}</p>
                  <p className="text-[12px] text-muted-foreground">{c.detail}</p>
                </div>
                <p className="num shrink-0 text-[14px] font-bold">{c.amountLabel}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {vm.grupos.map((g) => (
        <section key={g.label} className="mt-6">
          <h2 className="mb-3 font-display text-[15px] font-bold">{g.label}</h2>
          <div className="surface divide-y divide-border overflow-hidden">
            {g.items.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3.5">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-display text-[13px] font-bold ${
                    t.isCredit
                      ? "bg-[var(--success)]/12 text-[var(--success)]"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {t.label.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{t.label}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {t.tag} · {t.dateLabel}
                  </p>
                </div>
                <p
                  className={`num shrink-0 text-[14px] font-bold ${
                    t.isCredit ? "text-[var(--success)]" : ""
                  }`}
                >
                  {t.amountLabel}
                </p>
              </div>
            ))}
          </div>
        </section>
      ))}
    </PhoneShell>
  );
}
