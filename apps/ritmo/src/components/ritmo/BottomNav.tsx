import { Link, useRouterState } from "@tanstack/react-router";
import { Home, CalendarRange, Sparkles, Lightbulb, LayoutGrid } from "lucide-react";

const items = [
  { to: "/", label: "Início", icon: Home },
  { to: "/planejamento", label: "Planejamento", icon: CalendarRange },
  { to: "/assistente", label: "Assistente", icon: Sparkles },
  { to: "/insights", label: "Insights", icon: Lightbulb },
  { to: "/mais", label: "Mais", icon: LayoutGrid },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="sticky bottom-0 z-20 border-t border-border bg-card/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-[430px] items-stretch justify-between px-2 py-2">
        {items.map(({ to, label, icon: Icon }) => {
          const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className="flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5"
            >
              <span
                className={`flex h-8 w-12 items-center justify-center rounded-full transition-colors ${
                  active ? "brand-gradient text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={2.1} />
              </span>
              <span
                className={`text-[10px] font-medium tracking-tight ${
                  active ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
