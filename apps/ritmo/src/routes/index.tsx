import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Sparkles, TrendingUp, Wallet } from "lucide-react";
import { PhoneShell } from "@/components/ritmo/PhoneShell";
import { ThemeToggle } from "@/components/ritmo/ThemeToggle";
import { RitmoMark } from "@/components/ritmo/RitmoMark";
import { getHomeData } from "@/functions/home";
import { toHomeViewModel } from "@/adapters/home";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ritmo — Seu ritmo financeiro de hoje" },
      {
        name: "description",
        content:
          "Veja quanto você pode gastar com tranquilidade até o próximo salário, seus compromissos e o insight do dia.",
      },
      { property: "og:title", content: "Ritmo — Seu ritmo financeiro de hoje" },
      {
        property: "og:description",
        content: "Safe-to-Spend, compromissos e recomendações no seu ritmo.",
      },
    ],
  }),
  loader: () => getHomeData(),
  component: Home,
});

function Home() {
  const data = Route.useLoaderData();
  const vm = toHomeViewModel(data);

  return (
    <PhoneShell>
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 pb-6">
        <div className="flex min-w-0 items-center gap-3">
          <RitmoMark className="h-9 w-9 shrink-0" />
          <div className="min-w-0">
            <p className="text-[13px] text-muted-foreground">{vm.greeting}</p>
            <p className="truncate font-display text-lg font-extrabold">{vm.displayName}</p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <section className="relative overflow-hidden rounded-3xl hero-gradient p-6 lift">
        <div className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-[var(--coral)]/25 blur-3xl" />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white/90">
            <span
              className={`h-1.5 w-1.5 rounded-full ${vm.toneOk ? "bg-emerald-300" : "bg-[var(--coral)]"}`}
            />
            {vm.toneLabel}
          </span>
          <p className="mt-5 text-[13px] text-white/70">Disponível para gastar</p>
          <p className="num mt-1 text-[44px] font-extrabold leading-none text-white">
            {vm.safeToSpendLabel}
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-white/75">
            até o fim do mês, em{" "}
            <span className="font-semibold text-white">
              {vm.endOfMonthDays} dia{vm.endOfMonthDays === 1 ? "" : "s"}
            </span>
          </p>

          <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-white/85"
              style={{ width: `${vm.monthProgressPercent}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-white/60">
            <span>{vm.todayLabel}</span>
            <span>{vm.endOfMonthLabel}</span>
          </div>
        </div>
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3">
        <MiniCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Entradas do mês"
          value={vm.incomeLabel}
          tone="up"
        />
        <MiniCard
          icon={<Wallet className="h-4 w-4" />}
          label="Já comprometido"
          value={vm.committedLabel}
          tone="flat"
        />
      </section>

      <section className="mt-7">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-[17px] font-bold">Próximos compromissos</h2>
          <Link to="/transacoes" className="text-[12px] font-semibold text-primary">
            Ver todos
          </Link>
        </div>
        {vm.upcoming.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Nenhum compromisso fixo cadastrado ainda.
          </p>
        ) : (
          <div className="surface divide-y divide-border overflow-hidden">
            {vm.upcoming.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-[11px] font-bold text-accent-foreground">
                  {c.dueDayBadge}
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

      <section className="mt-7">
        <h2 className="mb-3 font-display text-[17px] font-bold">Ritmo aprendeu algo novo</h2>
        <div className="surface relative overflow-hidden p-4">
          <span className="absolute left-0 top-0 h-full w-1 mark-gradient" />
          <div className="flex items-start gap-3 pl-2">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--coral)]/12 text-[var(--coral)]">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold leading-snug">
                {vm.insight ? vm.insight.title : "Nada de novo por aqui — continue no seu ritmo."}
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                {vm.insight
                  ? vm.insight.detail
                  : "Assim que houver algo relevante, você verá aqui primeiro."}
              </p>
              {vm.insight ? (
                <Link
                  to={vm.insight.href}
                  className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-primary"
                >
                  Ver detalhes <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <Link
        to="/assistente"
        className="mt-6 flex items-center gap-3 rounded-3xl brand-gradient px-5 py-4 lift"
      >
        <Sparkles className="h-5 w-5 shrink-0 text-primary-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] font-bold text-primary-foreground">
            Falar com o assistente
          </p>
          <p className="truncate text-[12px] text-primary-foreground/75">
            “Posso gastar hoje?” · “Explique meu mês”
          </p>
        </div>
        <ArrowUpRight className="h-5 w-5 shrink-0 text-primary-foreground" />
      </Link>

      <p className="mt-6 text-center text-[11px] text-muted-foreground">
        Organização financeira que aprende com você.
      </p>
    </PhoneShell>
  );
}

function MiniCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "up" | "flat";
}) {
  return (
    <div className="surface p-4">
      <div
        className={`flex h-8 w-8 items-center justify-center rounded-full ${
          tone === "up"
            ? "bg-[var(--success)]/12 text-[var(--success)]"
            : "bg-accent text-accent-foreground"
        }`}
      >
        {icon}
      </div>
      <p className="mt-3 text-[12px] text-muted-foreground">{label}</p>
      <p className="num mt-0.5 text-[17px] font-extrabold">{value}</p>
    </div>
  );
}
