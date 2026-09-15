import type { PerfilData } from "@/functions/perfil";

export interface PerfilViewModel {
  readonly displayName: string;
  readonly initials: string;
  readonly email: string;
  readonly memberSinceLabel: string;
}

function initialsFor(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

const MEMBER_SINCE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Pure reshaping only — every field here is real Better Auth identity data. */
export function toPerfilViewModel(data: PerfilData): PerfilViewModel {
  return {
    displayName: data.displayName,
    initials: initialsFor(data.displayName),
    email: data.email,
    memberSinceLabel: MEMBER_SINCE_FORMATTER.format(new Date(data.createdAt)),
  };
}
