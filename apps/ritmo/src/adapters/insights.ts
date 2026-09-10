import type { AlertEvidence, AlertType } from "@money-copilot/app-services";
import type { InsightsData } from "@/functions/insights";
import { brl } from "./format";

export type InsightTone = "atencao" | "neutro" | "bom";

export interface InsightCard {
  readonly id: string;
  readonly tag: string;
  readonly tom: InsightTone;
  readonly titulo: string;
  readonly detalhe: string;
}

export interface InsightsViewModel {
  readonly summaryTitle: string;
  readonly summaryDetail: string;
  readonly cards: readonly InsightCard[];
}

const ALERT_TAGS: Record<AlertType, string> = {
  SAFE_TO_SPEND_MATERIAL_DROP: "Safe-to-Spend",
  RECOMMENDATION_FAILED: "Recomendação",
  RECOMMENDATION_VERIFIED: "Recomendação",
  UPCOMING_EVENT_PRESSURE: "Planejamento",
  UPCOMING_EVENT_UNKNOWN_COST: "Planejamento",
  LIQUIDITY_COVERAGE_DEGRADED: "Liquidez",
  CONNECTION_NEEDS_ATTENTION: "Conexão",
  STALE_CONCIERGE_PLAN: "Assistente",
};

/**
 * One honest sentence built only from the alert's own structured
 * `evidence` fields — never a generic placeholder and never a fabricated
 * number, mirroring the specificity of the Lovable mock's example insights
 * (e.g. "De R$ 2.140 para R$ 1.842...") with real figures instead.
 */
function describeEvidence(evidence: AlertEvidence): string {
  switch (evidence.kind) {
    case "SAFE_TO_SPEND_MATERIAL_DROP":
      return `De ${brl(evidence.previousCents)} para ${brl(evidence.currentCents)}.`;
    case "RECOMMENDATION_DECISION":
      return `${evidence.recommendationTitle}: impacto projetado de ${brl(evidence.projectedMonthlyImpactCents)}/mês.`;
    case "UPCOMING_EVENT_PRESSURE":
      return `${evidence.eventLabel} em ${evidence.daysUntilStart} dia(s), custo conhecido de ${brl(evidence.knownCostCents)}.`;
    case "UPCOMING_EVENT_UNKNOWN_COST":
      return `${evidence.eventLabel} em ${evidence.daysUntilStart} dia(s), custo ainda não definido.`;
    case "LIQUIDITY_COVERAGE_DEGRADED":
      return `Cobertura de liquidez passou de ${evidence.previousCoverage} para ${evidence.currentCoverage}.`;
    case "CONNECTION_NEEDS_ATTENTION":
      return `${evidence.connectorName ?? "Conexão"} precisa de atenção (${evidence.reasonCode}).`;
    case "STALE_CONCIERGE_PLAN":
      return `O plano "${evidence.planLabel}" pode estar desatualizado.`;
  }
}

/**
 * Pure reshaping only. The feed only ever renders real active Alerts and
 * pending Recommendations — two of the Lovable mock's four example
 * insights ("gastando 12% acima do ritmo" and "evento ainda cabe no mês")
 * have no engine equivalent yet and simply don't appear (see "Data-model
 * gaps" #3) — an honest, visible gap rather than invented content.
 */
export function toInsightsViewModel(data: InsightsData): InsightsViewModel {
  const alertCards: InsightCard[] = data.alerts.map((a) => ({
    id: a.id,
    tag: ALERT_TAGS[a.type],
    tom: a.severity === "INFO" ? "neutro" : "atencao",
    titulo: a.title,
    detalhe: describeEvidence(a.evidence),
  }));

  const recommendationCards: InsightCard[] = data.pendingRecommendations.map((r) => ({
    id: r.id,
    tag: "Recorrência",
    tom: "neutro",
    titulo: r.title,
    detalhe: r.description ?? `Impacto projetado de ${brl(r.projectedMonthlyImpactCents)}/mês.`,
  }));

  const cards = [...alertCards, ...recommendationCards];
  const count = cards.length;
  const anyImportant = data.alerts.some((a) => a.severity === "IMPORTANT");

  let summaryTitle: string;
  let summaryDetail: string;
  if (count === 0) {
    summaryTitle = "Nenhuma novidade esta semana";
    summaryDetail = "Continue no seu ritmo — você verá algo aqui assim que houver.";
  } else {
    summaryTitle = anyImportant ? "Seu ritmo pede atenção" : "Seu ritmo continua tranquilo";
    summaryDetail = `${count} ${count === 1 ? "novidade merece" : "novidades merecem"} atenção, nada urgente.`;
  }

  return { summaryTitle, summaryDetail, cards };
}
