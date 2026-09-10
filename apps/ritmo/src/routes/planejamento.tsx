import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, CalendarHeart, Repeat } from "lucide-react";
import { PhoneShell, ScreenHeader } from "@/components/ritmo/PhoneShell";
import { ThemeToggle } from "@/components/ritmo/ThemeToggle";
import { getPlanejamentoData } from "@/functions/planejamento";
import { toPlanejamentoViewModel } from "@/adapters/planejamento";

export const Route = createFileRoute("/planejamento")({
  head: () => ({
    meta: [
      { title: "Planejamento do mês — Ritmo" },
      {
        name: "description",
        content:
          "Entradas, saídas, compromissos fixos e eventos planejados do seu mês, de forma visual e calma.",
      },
      { property: "og:title", content: "Planejamento do mês — Ritmo" },
      {
        property: "og:description",
        content: "Veja o desenho completo do seu mês: entradas, compromissos e reservas.",
      },
    ],
  }),
  loader: () => getPlanejamentoData(),
  component: Planejamento,
});

function Planejamento() {
  const data = Route.useLoaderData();
  const vm = toPlanejamentoViewModel(data);

  return (
    <PhoneShell>
      <ScreenHeader title="Planejamento" subtitle="Mês atual" action={<ThemeToggle />} />

      <section className="surface p-5">
        <p className="text-[12.5px] text-muted-foreground">Disponível até o fim do mês</p>
        <p className="num mt-1 text-[36px] font-extrabold leading-none">{vm.availableLabel}</p>

        <div className="mt-5 flex h-3 w-full overflow-hidden rounded-full bg-muted">
          {vm.legend.map((item) => (
            <div
              key={item.label}
              className={`h-full ${
                item.color === "brand"
                  ? "brand-gradient"
                  : item.color === "coral"
                    ? "bg-[var(--coral)]"
                    : "bg-[var(--success)]"
              }`}
              style={{ width: `${item.percent}%` }}
            />
          ))}
        </div>
        <div className="mt-3 space-y-2">
          {vm.legend.map((item) => (
            <Legend key={item.label} color={item.color} label={item.label} value={item.value} />
          ))}
        </div>
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3">
        <div className="surface p-4">
          <ArrowDownLeft className="h-4 w-4 text-[var(--success)]" />
          <p className="mt-3 text-[12px] text-muted-foreground">Entradas previstas</p>
          <p className="num mt-0.5 text-[17px] font-extrabold">{vm.incomeLabel}</p>
        </div>
        <div className="surface p-4">
          <ArrowUpRight className="h-4 w-4 text-[var(--coral)]" />
          <p className="mt-3 text-[12px] text-muted-foreground">Saídas previstas</p>
          <p className="num mt-0.5 text-[17px] font-extrabold">{vm.outflowLabel}</p>
        </div>
      </section>

      <section className="mt-7">
        <h2 className="mb-3 font-display text-[17px] font-bold">Linha do mês</h2>
        <div className="surface p-5">
          {vm.timeline.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Nenhum evento com data confirmada neste momento.
            </p>
          ) : (
            <ol className="relative space-y-6 border-l border-dashed border-border pl-6">
              {vm.timeline.map((t) => (
                <TimelineItem
                  key={t.id}
                  dia={t.dateLabel}
                  titulo={t.title}
                  valor={t.valueLabel}
                  tone={t.tone}
                  nota={t.note}
                />
              ))}
            </ol>
          )}
        </div>
      </section>

      <section className="mt-7">
        <h2 className="mb-3 font-display text-[17px] font-bold">Compromissos recorrentes</h2>
        {vm.recorrentes.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Nenhum compromisso fixo cadastrado ainda.
          </p>
        ) : (
          <div className="surface divide-y divide-border overflow-hidden">
            {vm.recorrentes.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <Repeat className="h-4 w-4" />
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

      <section className="mt-7 mb-2">
        <h2 className="mb-3 font-display text-[17px] font-bold">Eventos planejados</h2>
        {vm.eventCards.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nenhum evento planejado no momento.</p>
        ) : (
          vm.eventCards.map((card) => (
            <div key={card.id} className="surface flex items-center gap-4 p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl mark-gradient text-white">
                <CalendarHeart className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold">{card.title}</p>
                <p className="text-[12px] text-muted-foreground">{card.note}</p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full brand-gradient"
                    style={{ width: `${card.progressPercent}%` }}
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </section>
    </PhoneShell>
  );
}

function Legend({
  color,
  label,
  value,
}: {
  color: "brand" | "coral" | "success";
  label: string;
  value: string;
}) {
  const dot =
    color === "brand"
      ? "brand-gradient"
      : color === "coral"
        ? "bg-[var(--coral)]"
        : "bg-[var(--success)]";
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{label}</span>
      <span className="num shrink-0 text-[13px] font-semibold">{value}</span>
    </div>
  );
}

function TimelineItem({
  dia,
  titulo,
  valor,
  nota,
  tone,
  done,
}: {
  dia: string;
  titulo: string;
  valor: string;
  nota: string;
  tone: "in" | "out" | "plan";
  done?: boolean;
}) {
  const dot =
    tone === "in" ? "bg-[var(--success)]" : tone === "out" ? "bg-[var(--coral)]" : "brand-gradient";
  return (
    <li className="relative">
      <span
        className={`absolute -left-[31px] top-1 h-3 w-3 rounded-full ring-4 ring-card ${dot} ${
          done ? "opacity-55" : ""
        }`}
      />
      <p className="text-[11px] font-medium text-muted-foreground">{dia}</p>
      <div className="mt-0.5 flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-[14px] font-semibold">{titulo}</p>
        <p
          className={`num shrink-0 text-[13px] font-bold ${
            tone === "in" ? "text-[var(--success)]" : "text-foreground"
          }`}
        >
          {valor}
        </p>
      </div>
      <p className="text-[12px] text-muted-foreground">{nota}</p>
    </li>
  );
}
