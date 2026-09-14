import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AuthShell } from "@/components/ritmo/AuthShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { checkPasswordResetAvailability } from "@/functions/password-reset";

export const Route = createFileRoute("/recuperar-senha")({
  // Sprint 9 Phase 3 fix-up (docs/DECISIONS.md DEC-098): resolved BEFORE the
  // form ever renders, so a user is never invited to submit an email address
  // into a flow that cannot deliver anything in this environment.
  loader: () => checkPasswordResetAvailability(),
  component: RecoverPasswordPage,
});

function RecoverPasswordPage() {
  const { available } = Route.useLoaderData();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!available) {
    return (
      <AuthShell
        title="Recuperação de senha indisponível"
        subtitle="Este recurso está temporariamente indisponível neste ambiente. Entre em contato com o suporte para redefinir sua senha."
      >
        <Link
          to="/login"
          className="mt-2 flex items-center justify-center rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground"
        >
          Voltar para o login
        </Link>
      </AuthShell>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    await authClient.requestPasswordReset({ email, redirectTo: "/login" });
    setIsSubmitting(false);
    // Always show the same confirmation regardless of whether the e-mail is
    // registered — never leak account existence through this form.
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell
        title="Verifique seu e-mail"
        subtitle="Se houver uma conta com esse e-mail, enviamos um link para redefinir sua senha."
      >
        <Link
          to="/login"
          className="mt-2 flex items-center justify-center rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground"
        >
          Voltar para o login
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Recuperar senha" subtitle="Envie um link de redefinição para seu e-mail.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-[13px] font-semibold text-foreground">
            E-mail
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Button type="submit" size="lg" className="mt-2 rounded-full" disabled={isSubmitting}>
          {isSubmitting ? "Enviando..." : "Enviar link"}
        </Button>
      </form>
      <p className="mt-6 text-center text-[13px] text-muted-foreground">
        <Link to="/login" className="font-semibold text-primary">
          Voltar para o login
        </Link>
      </p>
    </AuthShell>
  );
}
