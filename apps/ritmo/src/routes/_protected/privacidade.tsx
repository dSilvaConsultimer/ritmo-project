import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { PhoneShell, ScreenHeader } from "@/components/ritmo/PhoneShell";
import { Switch } from "@/components/ui/switch";
import { getNotificacoesData, updateNotificacoes } from "@/functions/notificacoes";

/**
 * "Privacidade e segurança" (Mais → Suporte). Real backing for what
 * genuinely exists today: the notification privacy mode (shared with
 * "Notificações" — same underlying preference, surfaced here too since it
 * is fundamentally a privacy setting) and a link into the real password
 * recovery flow. There is no in-session "change password"/2FA/session-list
 * feature in the product yet, so this screen never invents one.
 */
export const Route = createFileRoute("/_protected/privacidade")({
  head: () => ({ meta: [{ title: "Privacidade e segurança — Ritmo" }] }),
  loader: () => getNotificacoesData(),
  component: Privacidade,
});

function Privacidade() {
  const initialData = Route.useLoaderData();
  const [amountAllowed, setAmountAllowed] = useState(initialData.privacyMode === "AMOUNT_ALLOWED");
  const [saving, setSaving] = useState(false);

  async function handleToggle(checked: boolean) {
    setSaving(true);
    setAmountAllowed(checked);
    try {
      await updateNotificacoes({ data: { privacyMode: checked ? "AMOUNT_ALLOWED" : "GENERIC" } });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PhoneShell>
      <ScreenHeader title="Privacidade e segurança" backTo="/mais" />

      <section>
        <h2 className="mb-3 font-display text-[15px] font-bold">Privacidade</h2>
        <div className="surface flex items-center gap-3 p-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium">Mostrar valores nas notificações</p>
            <p className="text-[12px] text-muted-foreground">
              Quando desligado, notificações futuras nunca mencionam um valor em reais
            </p>
          </div>
          <Switch checked={amountAllowed} disabled={saving} onCheckedChange={handleToggle} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 font-display text-[15px] font-bold">Segurança</h2>
        <div className="surface p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <KeyRound className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium">Senha</p>
              <p className="text-[12px] text-muted-foreground">
                Para trocar sua senha, saia da conta e use "Esqueci minha senha" na tela de login.
              </p>
            </div>
          </div>
          <Link
            to="/recuperar-senha"
            className="mt-3 inline-flex items-center text-[13px] font-semibold text-primary"
          >
            Ir para recuperação de senha
          </Link>
        </div>
        <p className="mt-3 text-[11.5px] text-muted-foreground">
          Suas credenciais bancárias nunca ficam salvas no Ritmo — a Pluggy cuida disso com
          segurança, e a conexão é sempre somente leitura.
        </p>
      </section>
    </PhoneShell>
  );
}
