import type { MaisData } from "@/functions/mais";

/** Every real subpage a Mais row can now navigate to. */
export type MaisDestination =
  "/perfil" | "/notificacoes" | "/conectar-banco" | "/planejamento" | "/ajuda" | "/privacidade";

export interface MaisItem {
  readonly label: string;
  readonly hint: string;
  /** Real destination every item now navigates to — see conectar-banco.tsx's own precedent. */
  readonly to: MaisDestination;
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
  readonly appVersion: string;
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
 * Pure reshaping only. Every item now has a real destination (`to`) — a
 * dedicated detail/settings subpage, following the exact same pattern
 * `conectar-banco.tsx` already established for "Instituições conectadas."
 * "Perfil e dados" shows only real Better Auth identity — no fabricated
 * plan/subscription tier (there is no billing concept in the domain yet).
 */
export function toMaisViewModel(data: MaisData): MaisViewModel {
  return {
    displayName: data.displayName,
    initials: initialsFor(data.displayName),
    profileSubtitle: "Ver perfil e dados da conta",
    appVersion: data.appVersion,
    groups: [
      {
        titulo: "Conta",
        itens: [
          { label: "Perfil e dados", hint: data.displayName, to: "/perfil" },
          {
            label: "Notificações",
            hint: notificationsHint(data.quietHoursStart, data.quietHoursEnd),
            to: "/notificacoes",
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
            to: "/conectar-banco",
          },
          {
            label: "Categorias e regras",
            hint: `${data.categoryRuleCount} regras ativas`,
            // DEC-132: navigates into Planning's "Regras e categorias"
            // section — the one canonical management experience — rather
            // than the old standalone (now-removed) `/categorias` screen.
            to: "/planejamento",
          },
        ],
      },
      {
        titulo: "Suporte",
        itens: [
          { label: "Central de ajuda", hint: "", to: "/ajuda" },
          { label: "Privacidade e segurança", hint: "", to: "/privacidade" },
        ],
      },
    ],
  };
}
