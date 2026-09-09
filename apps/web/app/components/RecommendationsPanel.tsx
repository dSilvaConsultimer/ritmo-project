"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

export interface RecommendationSummaryItem {
  id: string;
  title: string;
  description?: string;
  type: string;
  status: string;
  evidence: {
    normalizedMerchant: string;
    cadence: string;
    observedAmountReais: number;
    occurrences: number;
    confidence: string;
  };
  projectedMonthlyImpactReais: number;
  projectedAnnualImpactReais: number;
  lastVerificationAssessment?: string;
}

export interface RecommendationsData {
  pending: RecommendationSummaryItem[];
  awaitingVerification: RecommendationSummaryItem[];
  verified: RecommendationSummaryItem[];
  failed: RecommendationSummaryItem[];
  rejected: RecommendationSummaryItem[];
  potentialMonthlySavingsReais: number;
  acceptedExpectedMonthlySavingsReais: number;
  verifiedMonthlySavingsReais: number;
}

const cardStyle: React.CSSProperties = {
  background: "#151821",
  border: "1px solid #262b38",
  borderRadius: 12,
  padding: "14px 18px",
  marginBottom: 10,
};

function brl(reais: number): string {
  return reais.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function statusNote(item: RecommendationSummaryItem): string | null {
  switch (item.status) {
    case "ACCEPTED":
    case "MODIFIED":
      return "Aguardando confirmação pelas próximas movimentações.";
    case "VERIFIED":
      return "Economia confirmada.";
    case "FAILED":
      return "A cobrança continuou.";
    default:
      return null;
  }
}

async function postDecision(body: Record<string, unknown>): Promise<void> {
  const response = await fetch("/api/recommendations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "Request failed");
  }
}

function RecommendationCard({ item, onDecided }: { item: RecommendationSummaryItem; onDecided: () => void }) {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDecidable = item.status === "PENDING";

  const handle = useCallback(
    async (action: "ACCEPT" | "MODIFY" | "REJECT") => {
      setError(null);
      let targetAmountReais: number | undefined;
      if (action === "MODIFY") {
        const raw = window.prompt(
          `Reduzir "${item.title}" para qual valor mensal (R$)? Valor atual: ${brl(item.evidence.observedAmountReais)}`,
        );
        if (raw === null) return;
        const parsed = Number(raw.replace(",", "."));
        if (!Number.isFinite(parsed) || parsed <= 0) {
          setError("Valor inválido.");
          return;
        }
        targetAmountReais = parsed;
      }
      setIsBusy(true);
      try {
        await postDecision({
          recommendationId: item.id,
          action,
          ...(targetAmountReais !== undefined ? { targetAmountReais } : {}),
        });
        onDecided();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Request failed");
      } finally {
        setIsBusy(false);
      }
    },
    [item, onDecided],
  );

  const note = statusNote(item);

  return (
    <div style={cardStyle}>
      <div style={{ fontWeight: 600 }}>{item.title}</div>
      {item.description ? (
        <div style={{ fontSize: 13, color: "#8b93a7", marginTop: 4 }}>{item.description}</div>
      ) : null}
      <div style={{ fontSize: 13, marginTop: 8 }}>
        Current: {brl(item.evidence.observedAmountReais)} ({item.evidence.cadence.toLowerCase()}) · Monthly impact:{" "}
        {brl(item.projectedMonthlyImpactReais)} · Annual impact: {brl(item.projectedAnnualImpactReais)}
      </div>
      <div style={{ fontSize: 12, color: "#8b93a7", marginTop: 4 }}>
        Confidence: {item.evidence.confidence} · Status: {item.status}
        {item.lastVerificationAssessment ? ` · Last check: ${item.lastVerificationAssessment}` : ""}
      </div>
      {note ? <div style={{ fontSize: 13, marginTop: 6, color: "#8b93a7" }}>{note}</div> : null}
      {isDecidable ? (
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <button onClick={() => handle("ACCEPT")} disabled={isBusy} style={buttonStyle}>
            Accept
          </button>
          <button onClick={() => handle("MODIFY")} disabled={isBusy} style={buttonStyle}>
            Modify
          </button>
          <button onClick={() => handle("REJECT")} disabled={isBusy} style={buttonStyle}>
            Reject
          </button>
        </div>
      ) : null}
      {error ? <p style={{ color: "#e08a8a", fontSize: 12, marginTop: 6 }}>{error}</p> : null}
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  background: "#262b38",
  color: "#e6e8ec",
  border: "1px solid #3a4152",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 13,
  cursor: "pointer",
};

export function RecommendationsPanel({ data }: { data: RecommendationsData }) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);

  const all = [...data.pending, ...data.awaitingVerification, ...data.verified, ...data.failed, ...data.rejected];

  return (
    <div>
      <p style={{ fontSize: 13, color: "#8b93a7", marginTop: 0, marginBottom: 12 }}>
        Accepting a recommendation records your intent and tracks whether future transactions confirm it — Money
        Copilot does NOT contact any merchant or cancel anything on your behalf.
      </p>
      <div style={{ display: "flex", gap: 24, marginBottom: 14, fontSize: 13 }}>
        <div>
          Potential monthly savings: <strong>{brl(data.potentialMonthlySavingsReais)}</strong>
        </div>
        <div>
          Accepted, awaiting confirmation: <strong>{brl(data.acceptedExpectedMonthlySavingsReais)}</strong>
        </div>
        <div>
          Verified: <strong>{brl(data.verifiedMonthlySavingsReais)}</strong>
        </div>
      </div>
      {all.length === 0 ? (
        <p style={{ color: "#8b93a7" }}>No recommendations yet.</p>
      ) : (
        all.map((item) => <RecommendationCard key={item.id} item={item} onDecided={refresh} />)
      )}
    </div>
  );
}
