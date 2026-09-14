import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import { AuthShell } from "@/components/ritmo/AuthShell";
import { Button } from "@/components/ui/button";

/**
 * First-time Welcome/onboarding screen (Sprint 9 Phase 4, brief §A) — the
 * step between account creation and the real product. Reuses `AuthShell`
 * (Phase 3's approved visual language, per the Phase 4 brief §3: "The
 * approved Phase 3 Login/Cadastro/Recuperação screens are also now part of
 * the visual language") rather than a new onboarding-specific shell.
 *
 * Deliberately has no "skip" option (brief §9: "If skip is not appropriate
 * for V1, it is acceptable to require connection. Choose deliberately and
 * document the choice.") — see docs/DECISIONS.md DEC-102. Every other
 * screen in this product (Home, Insights, Planejamento) is built assuming
 * real connected-account data; a genuinely honest empty-data experience
 * across all of them is real, separate future work, not something to
 * improvise here.
 */
export const Route = createFileRoute("/_protected/onboarding")({
  head: () => ({
    meta: [{ title: "Bem-vindo ao Ritmo" }],
  }),
  component: OnboardingWelcome,
});

function OnboardingWelcome() {
  const navigate = useNavigate();

  return (
    <AuthShell
      title="Vamos organizar seu dinheiro"
      subtitle="Conecte sua conta para o Ritmo aprender com seus dados reais — sem precisar digitar nada à mão."
    >
      <div className="flex flex-col gap-3">
        <div className="surface flex items-start gap-3 p-4">
          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-[13px] text-foreground">
            Veja quanto você pode gastar com tranquilidade, todos os dias, sem planilhas.
          </p>
        </div>
        <div className="surface flex items-start gap-3 p-4">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-[13px] text-foreground">
            Recomendações e um assistente que já conhecem suas movimentações reais.
          </p>
        </div>
        <div className="surface flex items-start gap-3 p-4">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-[13px] text-foreground">
            Conexão segura, somente leitura — o Ritmo nunca move seu dinheiro.
          </p>
        </div>
      </div>

      <Button
        size="lg"
        className="mt-6 w-full rounded-full"
        onClick={() => navigate({ to: "/conectar-banco" })}
      >
        Conectar meu banco
      </Button>
    </AuthShell>
  );
}
