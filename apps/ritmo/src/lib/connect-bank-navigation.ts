/**
 * Where the Bank Connection screen's Back link goes — contextual, not a
 * bare `router.history.back()` (which would be wrong for a direct link or
 * a refresh, and can't be unit-tested deterministically). See
 * `conectar-banco.tsx`'s `validateSearch` for how `origin` is populated
 * (an explicit `?origin=onboarding|mais` search param set by the two real
 * entry points — `/onboarding` and `/mais`) and `getConnectionScreenData`
 * for `hasAnyConnection` (real, server-resolved connection state — never a
 * client-controlled financialProfileId).
 */
export type ConnectBankOrigin = "onboarding" | "mais" | undefined;

export function resolveConnectBankBackTo(
  origin: ConnectBankOrigin,
  hasAnyConnection: boolean,
): "/onboarding" | "/mais" {
  if (origin === "onboarding") return "/onboarding";
  if (origin === "mais") return "/mais";
  // Direct URL / refresh, no origin — fall back to real server-side
  // connection state: a profile with no connection yet still belongs in
  // onboarding; a profile that already has one belongs in Mais.
  return hasAnyConnection ? "/mais" : "/onboarding";
}
