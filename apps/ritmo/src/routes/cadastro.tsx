import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AuthShell } from "@/components/ritmo/AuthShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/cadastro")({
  component: SignUpPage,
});

function SignUpPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const { error: signUpError } = await authClient.signUp.email({ name, email, password });
    setIsSubmitting(false);
    if (signUpError) {
      setError(signUpError.message ?? "Não foi possível criar sua conta.");
      return;
    }
    // Full first-time Onboarding / bank-connection flow is Sprint 9 Phase 4
    // (a dedicated, Founder-reviewed screen set) — land on Home for now,
    // where `resolveOrProvisionProfileForOwner` has already created a real
    // (placeholder-goal) FinancialProfile on first login.
    navigate({ to: "/" });
  }

  return (
    <AuthShell title="Criar conta" subtitle="Leva menos de um minuto para começar.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-[13px] font-semibold text-foreground">
            Nome
          </label>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
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
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-[13px] font-semibold text-foreground">
            Senha
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
        <Button type="submit" size="lg" className="mt-2 rounded-full" disabled={isSubmitting}>
          {isSubmitting ? "Criando conta..." : "Criar conta"}
        </Button>
      </form>
      <p className="mt-6 text-center text-[13px] text-muted-foreground">
        Já tem conta?{" "}
        <Link to="/login" className="font-semibold text-primary">
          Entrar
        </Link>
      </p>
    </AuthShell>
  );
}
