import type { ReactNode } from "react";
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
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col justify-center px-6 py-10">
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
