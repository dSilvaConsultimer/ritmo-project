import { createFileRoute } from "@tanstack/react-router";
import { Mail, UserRound, CalendarDays } from "lucide-react";
import { PhoneShell, ScreenHeader } from "@/components/ritmo/PhoneShell";
import { getPerfilData } from "@/functions/perfil";
import { toPerfilViewModel } from "@/adapters/perfil";

/**
 * "Perfil e dados" (Mais → Conta) — real Better Auth identity only. No
 * plan/subscription tier is shown: there is no billing concept in the
 * domain yet, and this screen never invents one.
 */
export const Route = createFileRoute("/_protected/perfil")({
  head: () => ({
    meta: [{ title: "Perfil e dados — Ritmo" }],
  }),
  loader: () => getPerfilData(),
  component: Perfil,
});

function Perfil() {
  const data = Route.useLoaderData();
  const vm = toPerfilViewModel(data);

  return (
    <PhoneShell>
      <ScreenHeader title="Perfil e dados" backTo="/mais" />

      <div className="surface flex items-center gap-4 p-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl brand-gradient font-display text-lg font-extrabold text-primary-foreground">
          {vm.initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[16px] font-extrabold">{vm.displayName}</p>
          <p className="truncate text-[12.5px] text-muted-foreground">{vm.email}</p>
        </div>
      </div>

      <section className="mt-6">
        <h2 className="mb-3 font-display text-[15px] font-bold">Dados da conta</h2>
        <div className="surface divide-y divide-border overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <UserRound className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-muted-foreground">Nome</p>
              <p className="truncate text-[14px] font-medium">{vm.displayName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Mail className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-muted-foreground">E-mail</p>
              <p className="truncate text-[14px] font-medium">{vm.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <CalendarDays className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-muted-foreground">Membro desde</p>
              <p className="truncate text-[14px] font-medium">{vm.memberSinceLabel}</p>
            </div>
          </div>
        </div>
        <p className="mt-3 text-[11.5px] text-muted-foreground">
          Ritmo ainda não tem planos pagos — sua conta é gratuita enquanto o produto evolui.
        </p>
      </section>
    </PhoneShell>
  );
}
