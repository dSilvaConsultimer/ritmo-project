import { createServerFn } from "@tanstack/react-start";
import { getCurrentProfileContext } from "./profile.server";

/**
 * Raw data for the "Perfil e dados" screen (Mais → Conta). Real Better Auth
 * identity only — name/email/account-creation date — never a fabricated
 * plan/subscription tier (there is no billing concept in the domain).
 */
export const getPerfilData = createServerFn({ method: "GET" }).handler(async () => {
  const { displayName, email, createdAt } = await getCurrentProfileContext();
  return { displayName, email, createdAt };
});

export type PerfilData = Awaited<ReturnType<typeof getPerfilData>>;
