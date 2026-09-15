import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { RitmoWordmark } from "./RitmoMark";

/**
 * Shared shell for Login/Sign-up/Recovery/Session-expired screens — the same
 * phone-width column and background as `PhoneShell`, minus `BottomNav`
 * (these screens exist outside the authenticated `_protected` layout, so
 * there is no private-data nav to show). Not a final design pass — see
 * Sprint 9 Phase 4's visual-approval checkpoint.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  backTo,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /**
   * Optional explicit Back destination — same small chevron+"Voltar" link
   * `ScreenHeader`'s own `backTo` prop renders (Perfil, Notificações,
   * Categorias, Privacidade), positioned top-left so it doesn't disturb
   * this shell's centered title/subtitle/form layout. Omitted by
   * Login/Cadastro/Recuperar senha (no real "back" destination for a
   * pre-auth screen); used by conectar-banco.tsx, which has one.
   */
  backTo?: string;
}) {
  return (
    <div className="relative min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col justify-center px-6 py-10">
        {backTo ? (
          <Link
            to={backTo}
            className="absolute left-6 top-6 inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Voltar
          </Link>
        ) : null}
        <div className="mb-8 flex flex-col items-center text-center">
          <RitmoWordmark className="mb-6" />
          <h1 className="font-display text-2xl font-extrabold">{title}</h1>
          {subtitle ? <p className="mt-2 text-[13px] text-muted-foreground">{subtitle}</p> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
