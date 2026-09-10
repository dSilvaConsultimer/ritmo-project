import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
      className="relative flex h-10 w-[70px] items-center rounded-full border border-border bg-card px-1 transition-colors"
    >
      <span
        className="absolute h-8 w-8 rounded-full brand-gradient transition-transform duration-300 ease-out"
        style={{ transform: isDark ? "translateX(30px)" : "translateX(0px)" }}
      />
      <span className="relative z-10 flex h-8 w-8 items-center justify-center">
        <Sun
          className={`h-4 w-4 ${isDark ? "text-muted-foreground" : "text-primary-foreground"}`}
        />
      </span>
      <span className="relative z-10 flex h-8 w-8 items-center justify-center">
        <Moon
          className={`h-4 w-4 ${isDark ? "text-primary-foreground" : "text-muted-foreground"}`}
        />
      </span>
    </button>
  );
}

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const options: { key: "light" | "dark"; label: string; hint: string }[] = [
    { key: "light", label: "Claro", hint: "Humana & Inteligente" },
    { key: "dark", label: "Escuro", hint: "Premium & Tech" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {options.map((o) => {
        const active = theme === o.key;
        return (
          <button
            key={o.key}
            onClick={() => setTheme(o.key)}
            className={`rounded-2xl border p-3 text-left transition-all ${
              active ? "border-primary bg-accent" : "border-border bg-card"
            }`}
          >
            <div
              className={`mb-3 h-14 w-full rounded-xl border ${
                o.key === "light" ? "border-black/5 bg-[#F7F7F5]" : "border-white/10 bg-[#111827]"
              } flex items-center justify-center`}
            >
              <div className="h-4 w-16 rounded-full mark-gradient" />
            </div>
            <p className="font-display text-sm font-bold">{o.label}</p>
            <p className="text-[11px] text-muted-foreground">{o.hint}</p>
          </button>
        );
      })}
    </div>
  );
}
