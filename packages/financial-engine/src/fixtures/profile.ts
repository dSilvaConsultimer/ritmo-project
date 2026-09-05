import type { Id } from "@money-copilot/shared";
import type { FinancialProfile } from "../domain/profile";

export const FIXTURE_PROFILE_ID = "financial-profile_fixture" as Id<"financial-profile">;

export const fixtureProfile: FinancialProfile = {
  id: FIXTURE_PROFILE_ID,
  label: "Founder (Sprint 1 fixture)",
  createdAt: "2026-09-05",
};
