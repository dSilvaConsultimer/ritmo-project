import type { MaisData } from "@/functions/mais";

export interface MaisItem {
  readonly label: string;
  readonly hint: string;
}

export interface MaisGroup {
  readonly titulo: string;
  readonly itens: readonly MaisItem[];
}

export interface MaisViewModel {
  readonly displayName: string;
  readonly initials: string;
  readonly profileSubtitle: string;
  readonly groups: readonly MaisGroup[];
}

/** Initials from whatever real name is known — never a fabricated last name. */
function initialsFor(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/**
 * Kept deliberately short — the approved row layout truncates the
 * "Notificações" label itself once the hint text runs long (a real,
 * visible regression found live against the baseline screenshot), so this
 * stays close to the original hint's length rather than a longer, more
 * explicit sentence.
 */
function notificationsHint(quietHoursStart: string | null, quietHoursEnd: string | null): string {
  if (quietHoursStart && quietHoursEnd) {
    return `Silencioso ${quietHoursStart}–${quietHoursEnd}`;
  }
  return "Sem resumo agendado";
}

/**
 * Pure reshaping only. "Perfil e dados" shows only the real known display
 * name — no fabricated last name, plan, or subscription tier (there is no
 * billing/plan concept in the domain yet). "Notificações" reflects the real
 * quiet-hours preference instead of claiming a scheduled daily digest that
 * doesn't exist (see "Data-model gaps" #5). This is also the seam Sprint 9's
 * real authentication replaces — see docs/RITMO.md, "Login exception."
 *
 * The mock's "Plano Ritmo Premium" subtitle has no engine equivalent —
 * there is no billing/subscription-tier concept in the domain — so this
 * honestly labels the profile as what it currently is instead of inventing
 * a plan.
 */
export function toMaisViewModel(data: MaisData): MaisViewModel {
  return {
    displayName: data.displayName,
    initials: initialsFor(data.displayName),
    profileSubtitle: "Perfil de demonstração",
    groups: [
      {
        titulo: "Conta",
        itens: [
          { label: "Perfil e dados", hint: data.displayName },
          {
            label: "Notificações",
            hint: notificationsHint(data.quietHoursStart, data.quietHoursEnd),
          },
        ],
      },
      {
        titulo: "Conexões",
        itens: [
          {
            label: "Instituições conectadas",
            hint:
              data.connectedInstitutionsCount === 1
                ? "1 conectada"
                : `${data.connectedInstitutionsCount} conectadas`,
          },
          { label: "Categorias e regras", hint: `${data.categoryRuleCount} regras ativas` },
        ],
      },
      {
        titulo: "Suporte",
        itens: [
          { label: "Central de ajuda", hint: "" },
          { label: "Privacidade e segurança", hint: "" },
        ],
      },
    ],
  };
}
