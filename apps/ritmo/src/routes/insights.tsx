import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight, Sparkles } from "lucide-react";
import { PhoneShell, ScreenHeader } from "@/components/ritmo/PhoneShell";
import { ThemeToggle } from "@/components/ritmo/ThemeToggle";
import { getInsightsData } from "@/functions/insights";
import { toInsightsViewModel } from "@/adapters/insights";

export const Route = createFileRoute("/insights")({
  head: () => ({
    meta: [
      { title: "Insights — Ritmo" },
      {
        name: "description",
        content:
          "Recomendações claras e sem alarde sobre o seu mês, seus padrões e o seu Safe-to-Spend.",
      },
      { property: "og:title", content: "Insights — Ritmo" },
      { property: "og:description", content: "O que o Ritmo aprendeu sobre o seu mês." },
    ],
  }),
  loader: () => getInsightsData(),
  component: Insights,
});

function Insights() {
  const data = Route.useLoaderData();
  const vm = toInsightsViewModel(data);

  return (
    <PhoneShell>
      <ScreenHeader
        title="Insights"
        subtitle="O que o Ritmo aprendeu com você"
        action={<ThemeToggle />}
      />

      <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-5">
        <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full mark-gradient opacity-15 blur-2xl" />
        <div className="relative flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full brand-gradient">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p className="font-display text-[15px] font-bold">{vm.summaryTitle}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {vm.summaryDetail}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-3 pb-2">
        {vm.cards.map((i) => (
          <article key={i.id} className="surface p-4">
            <div className="flex items-center justify-between gap-3">
              <span
                className={`rounded-full px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide ${
                  i.tom === "atencao"
                    ? "bg-[var(--coral)]/12 text-[var(--coral)]"
                    : i.tom === "bom"
                      ? "bg-[var(--success)]/12 text-[var(--success)]"
                      : "bg-accent text-accent-foreground"
                }`}
              >
                {i.tag}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </div>
            <p className="mt-3 text-[14.5px] font-semibold leading-snug">{i.titulo}</p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              {i.detalhe}
            </p>
          </article>
        ))}
      </div>
    </PhoneShell>
  );
}
