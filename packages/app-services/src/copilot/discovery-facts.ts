import type { DiscoveryFact } from "../concierge";
import type { FinancialFact } from "./facts";

/**
 * Sprint 6: the discovery-domain counterpart to `facts.ts`. Kept in a
 * SEPARATE file/type (`DiscoveryFact`, not `FinancialFact`) per the Sprint
 * 6 brief, "keep provider-specific search data separate from financial
 * facts" — an external venue's name/price/rating is never the user's own
 * money. Populated STRUCTURALLY from tool results the orchestrator already
 * has (never written by the LLM), so every entry is grounded BY
 * CONSTRUCTION — no fragile regex-based name/address/rating verification
 * is needed (Sprint 6 brief, "avoid mixing all grounding into fragile
 * regex logic"). See docs/CONCIERGE.md, "Discovery grounding."
 */
export function extractDiscoveryFacts(toolName: string, result: unknown): DiscoveryFact[] {
  switch (toolName) {
    case "searchPlaces":
    case "buildConciergePlans": {
      const r = result as { discoveryFacts?: readonly DiscoveryFact[] };
      return r.discoveryFacts ? [...r.discoveryFacts] : [];
    }
    default:
      return [];
  }
}

/**
 * Every price-evidence amount a turn's discovery facts carry — merged into
 * `groundResponseText`'s allowed-amounts pool (never into the client-facing
 * `financialFacts` array) so a BRL figure the assistant states about a
 * VENUE's price is grounded exactly like a financial figure would be,
 * without conflating the two concepts in the response shape.
 */
export function discoveryFactsAsGroundingFacts(discoveryFacts: readonly DiscoveryFact[]): FinancialFact[] {
  return discoveryFacts.flatMap((fact) =>
    (fact.amountsCents ?? []).map((amountCents) => ({
      label: fact.label,
      amountCents,
      certainty: "MEDIUM" as const,
      sourceTool: fact.sourceTool,
      semanticType: "DISCOVERY_PRICE_EVIDENCE" as const,
    })),
  );
}
