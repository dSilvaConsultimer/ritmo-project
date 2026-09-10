import type { ReactNode } from "react";
import { BottomNav } from "./BottomNav";

export function PhoneShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-background">
        <main className="flex-1 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-10">
          {children}
        </main>
        <BottomNav />
      </div>
    </div>
  );
}

export function ScreenHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 pb-6">
      <div className="min-w-0">
        <h1 className="truncate font-display text-[26px] font-extrabold">{title}</h1>
        {subtitle ? <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
