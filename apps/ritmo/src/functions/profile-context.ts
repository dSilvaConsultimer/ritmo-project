import { DEMO_PROFILE_ID } from "@money-copilot/app-services";

/**
 * The single seam every Ritmo server function goes through to learn WHICH
 * financial profile it's acting on — never `DEMO_PROFILE_ID` imported ad hoc
 * in individual server functions. For Sprint 8 this unconditionally resolves
 * to the existing demo/founder profile; it is explicitly NOT an
 * authentication implementation. Sprint 9's real auth replaces the inside of
 * this one function only — no adapter or route that already calls it needs
 * to change. See docs/RITMO.md, "Profile resolution seam."
 */
export interface ProfileContext {
  readonly financialProfileId: string;
  /**
   * A display name for the UI — NOT `FinancialProfile.label` (which is an
   * internal fixture label, e.g. "Founder (Sprint 1 fixture)", never meant
   * for a polished product surface). A hardcoded placeholder until real user
   * profiles/auth exist — see docs/RITMO.md, "Data-model gaps."
   */
  readonly displayName: string;
}

export function getCurrentProfileContext(): ProfileContext {
  return {
    financialProfileId: DEMO_PROFILE_ID,
    displayName: "Douglas",
  };
}
