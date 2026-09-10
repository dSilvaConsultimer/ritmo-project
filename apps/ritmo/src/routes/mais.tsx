import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bell,
  ChevronRight,
  HelpCircle,
  Landmark,
  ListOrdered,
  Lock,
  Sparkles,
  UserRound,
} from "lucide-react";
import { PhoneShell, ScreenHeader } from "@/components/ritmo/PhoneShell";
import { ThemeSelector, ThemeToggle } from "@/components/ritmo/ThemeToggle";
import { RitmoMark } from "@/components/ritmo/RitmoMark";
import { getMaisData } from "@/functions/mais";
import { toMaisViewModel } from "@/adapters/mais";

const GROUP_ICONS: Record<string, readonly (typeof UserRound)[]> = {
  Conta: [UserRound, Bell],
  Conexões: [Landmark, ListOrdered],
  Suporte: [HelpCircle, Lock],
};

export const Route = createFileRoute("/mais")({
  head: () => ({
    meta: [
      { title: "Mais — Perfil e preferências do Ritmo" },
      {
        name: "description",
        content:
          "Escolha entre o tema claro e escuro, ajuste preferências e veja instituições conectadas.",
      },
      { property: "og:title", content: "Mais — Perfil e preferências do Ritmo" },
      { property: "og:description", content: "Tema, preferências e ajustes do seu Ritmo." },
    ],
  }),
  loader: () => getMaisData(),
  component: Mais,
});

function Mais() {
  const data = Route.useLoaderData();
  const vm = toMaisViewModel(data);

  return (
    <PhoneShell>
      <ScreenHeader title="Mais" subtitle="Perfil e preferências" action={<ThemeToggle />} />

      <div className="surface flex items-center gap-4 p-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl brand-gradient font-display text-lg font-extrabold text-primary-foreground">
          {vm.initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[16px] font-extrabold">{vm.displayName}</p>
          <p className="truncate text-[12.5px] text-muted-foreground">{vm.profileSubtitle}</p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>

      <section className="mt-6">
        <h2 className="mb-3 font-display text-[15px] font-bold">Aparência</h2>
        <ThemeSelector />
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          O tema claro é a identidade principal. O escuro é a expressão premium da marca.
        </p>
      </section>

      {vm.groups.map((g) => (
        <section key={g.titulo} className="mt-6">
          <h2 className="mb-3 font-display text-[15px] font-bold">{g.titulo}</h2>
          <div className="surface divide-y divide-border overflow-hidden">
            {g.itens.map(({ label, hint }, index) => {
              const Icon = GROUP_ICONS[g.titulo]![index]!;
              return (
                <button
                  key={label}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{label}</span>
                  {hint ? (
                    <span className="shrink-0 text-[12px] text-muted-foreground">{hint}</span>
                  ) : null}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </section>
      ))}

      <Link to="/transacoes" className="surface mt-6 flex items-center gap-3 p-4">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
          Ver todas as movimentações
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>

      <div className="mt-8 mb-2 flex flex-col items-center gap-2">
        <RitmoMark className="h-8 w-8" />
        <p className="text-center text-[11.5px] text-muted-foreground">
          Organização financeira que aprende com você.
        </p>
        <p className="text-[10.5px] text-muted-foreground/70">Versão 1.0 · Protótipo visual</p>
      </div>
    </PhoneShell>
  );
}
