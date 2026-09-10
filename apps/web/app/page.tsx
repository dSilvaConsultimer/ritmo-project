import type { CSSProperties, ReactNode } from "react";
import { format, type FinancialSnapshot, type LifestyleComparisonResult } from "@money-copilot/financial-engine";
import {
  getDb,
  getFinancialSnapshot,
  getTransactions,
  getCategoryTotals,
  getUncategorizedTransactions,
  getRecurringCandidates,
  getReconciliationCandidates,
  getLifestyleComparison,
  getConnections,
  getLatestSyncRunForConnection,
  getRecommendationsSummary,
  evaluateRecommendations,
  evaluateRecommendationVerifications,
  listSavedConciergePlansForProfile,
  evaluateAlerts,
  syncNotificationsForProfile,
  listAlertsForProfile,
  activeAlerts,
  rankAlerts,
  DEMO_PROFILE_ID,
  type RecommendationsSummary,
  type Alert,
} from "@money-copilot/app-services";
import { toReais, type Recommendation } from "@money-copilot/financial-engine";
import { ConnectedAccountsPanel } from "./components/ConnectedAccountsPanel";
import { ChatPanel } from "./components/ChatPanel";
import { AlertCenter, type AlertCardData } from "./components/AlertCenter";
import { RecommendationsPanel, type RecommendationsData, type RecommendationSummaryItem } from "./components/RecommendationsPanel";
import { warningKey } from "./lib/warning-key";

// This page reads live, DB-backed data (connections, synced transactions,
// manual-sync results) — it must be server-rendered per request, never
// statically prerendered/cached at build time. See DEC-024.
export const dynamic = "force-dynamic";

const ASOF_DATE = "2026-09-05";

const cardStyle: CSSProperties = {
  background: "#151821",
  border: "1px solid #262b38",
  borderRadius: 12,
  padding: "16px 20px",
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "#8b93a7",
  marginBottom: 6,
};

const valueStyle: CSSProperties = {
  fontSize: 22,
  fontWeight: 600,
};

const sectionTitleStyle: CSSProperties = { fontSize: 18, marginBottom: 12 };
const sectionStyle: CSSProperties = { marginBottom: 32 };
const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 14 };
const thStyle: CSSProperties = {
  textAlign: "left",
  color: "#8b93a7",
  fontWeight: 500,
  padding: "6px 10px",
  borderBottom: "1px solid #262b38",
};
const tdStyle: CSSProperties = { padding: "6px 10px", borderBottom: "1px solid #1c2029" };

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={cardStyle}>
      <div style={labelStyle}>{label}</div>
      <div style={valueStyle}>{value}</div>
      {sub ? <div style={{ fontSize: 13, color: "#8b93a7", marginTop: 4 }}>{sub}</div> : null}
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
      {children}
    </div>
  );
}

function SnapshotGrid({ snapshot }: { snapshot: FinancialSnapshot }) {
  return (
    <Grid>
      <Stat label="Monthly income (gross)" value={format(snapshot.income.gross)} />
      <Stat label="Taxes" value={format(snapshot.income.taxes)} />
      <Stat label="Usable income" value={format(snapshot.income.usable)} />
      <Stat label="Fixed commitments" value={format(snapshot.commitments.fixed)} />
      <Stat label="Variable budgets" value={format(snapshot.commitments.variableBudgets)} />
      <Stat label="Actual spending (this month)" value={format(snapshot.commitments.actualSpending)} />
      <Stat label="Debt / installment commitments" value={format(snapshot.commitments.debtCommitments)} />
      <Stat label="Future confirmed expenses" value={format(snapshot.commitments.futureConfirmed)} />
      <Stat label="Future estimated expenses" value={format(snapshot.commitments.futureEstimated)} />
      <Stat
        label="Protected savings target"
        value={format(snapshot.protectedSavings)}
        sub="Non-negotiable this month"
      />
      <Stat
        label="Safe-to-Spend (plan)"
        value={format(snapshot.safeToSpend.total)}
        sub={`${format(snapshot.safeToSpend.recommendedForToday)}/day · ${snapshot.safeToSpend.daysRemainingInMonth} days left`}
      />
      <Stat label="Projected savings" value={format(snapshot.projectedSavings)} />
      <Stat
        label="Confidence"
        value={snapshot.confidence}
        sub={
          snapshot.confidence === "LOW"
            ? "Some commitments are still unknown"
            : snapshot.confidence === "MEDIUM"
              ? "Some amounts are estimated"
              : "All amounts are actual or confirmed"
        }
      />
      <Stat
        label="Liquidity-aware Safe-to-Spend"
        value={
          snapshot.liquidity.liquidityAwareSafeToSpend !== null
            ? format(snapshot.liquidity.liquidityAwareSafeToSpend)
            : "Unknown"
        }
        sub={`Liquidity coverage: ${snapshot.liquidity.confidence}`}
      />
    </Grid>
  );
}

function SafeToSpendBreakdownTable({ snapshot }: { snapshot: FinancialSnapshot }) {
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>Component</th>
          <th style={thStyle}>Amount</th>
          <th style={thStyle}>Certainty</th>
        </tr>
      </thead>
      <tbody>
        {snapshot.safeToSpendBreakdown.components.map((c) => (
          <tr key={c.type}>
            <td style={tdStyle}>{c.label}</td>
            <td style={{ ...tdStyle, color: c.amount.cents < 0 ? "#e08a8a" : "#8ae0a8" }}>
              {format(c.amount)}
            </td>
            <td style={tdStyle}>{c.certainty}</td>
          </tr>
        ))}
        <tr>
          <td style={{ ...tdStyle, fontWeight: 600 }}>= Safe-to-Spend</td>
          <td style={{ ...tdStyle, fontWeight: 600 }}>{format(snapshot.safeToSpendBreakdown.total)}</td>
          <td style={tdStyle} />
        </tr>
      </tbody>
    </table>
  );
}

function Warnings({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) {
    return <p style={{ color: "#8b93a7" }}>No warnings.</p>;
  }
  return (
    <ul style={{ margin: 0, paddingLeft: 20, color: "#e0b64f" }}>
      {warnings.map((w, index) => (
        <li key={warningKey(w, index)} style={{ marginBottom: 6 }}>
          {w}
        </li>
      ))}
    </ul>
  );
}

function LifestyleSection({ comparison }: { comparison: LifestyleComparisonResult }) {
  return (
    <section style={sectionStyle}>
      <h2 style={sectionTitleStyle}>9. Current vs. Independent Living</h2>
      <p style={{ color: "#8b93a7", marginTop: 0, marginBottom: 16, fontSize: 14 }}>
        The independent-living scenario adds estimated household costs (dinner/food, cleaning,
        supplies) without changing any real financial data.
      </p>
      <Grid>
        <Stat
          label="Independent living — Safe-to-Spend"
          value={format(comparison.independent.safeToSpend.total)}
          sub={`vs. current ${format(comparison.current.safeToSpend.total)} (Δ ${format(comparison.safeToSpendDelta)})`}
        />
        <Stat
          label="Independent living — projected savings"
          value={format(comparison.independent.projectedSavings)}
          sub={`vs. current ${format(comparison.current.projectedSavings)} (Δ ${format(comparison.projectedSavingsDelta)})`}
        />
        <Stat label="Current lifestyle viability" value={comparison.currentViability} />
        <Stat
          label="Independent living viability"
          value={comparison.independentViability}
          sub="UNSUSTAINABLE / FRAGILE / SUSTAINABLE"
        />
      </Grid>
    </section>
  );
}

function formatCentsRange(range: { min: number; max: number }): string {
  const fmt = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return range.min === range.max ? fmt(range.min) : `${fmt(range.min)} - ${fmt(range.max)}`;
}

function recommendationItemFromDomain(r: Recommendation): RecommendationSummaryItem {
  return {
    id: r.id,
    title: r.title,
    ...(r.description ? { description: r.description } : {}),
    type: r.type,
    status: r.status,
    evidence: {
      normalizedMerchant: r.evidence.normalizedMerchant,
      cadence: r.evidence.cadence,
      observedAmountReais: toReais(r.evidence.observedAmount),
      occurrences: r.evidence.occurrences,
      confidence: r.evidence.confidence,
    },
    projectedMonthlyImpactReais: toReais(r.projectedMonthlyImpact),
    projectedAnnualImpactReais: toReais(r.projectedAnnualImpact),
    ...(r.lastVerificationAssessment ? { lastVerificationAssessment: r.lastVerificationAssessment } : {}),
  };
}

function recommendationsDataFromSummary(summary: RecommendationsSummary): RecommendationsData {
  return {
    pending: summary.pending.map(recommendationItemFromDomain),
    awaitingVerification: summary.awaitingVerification.map(recommendationItemFromDomain),
    verified: summary.verified.map(recommendationItemFromDomain),
    failed: summary.failed.map(recommendationItemFromDomain),
    rejected: summary.rejected.map(recommendationItemFromDomain),
    potentialMonthlySavingsReais: summary.potentialMonthlySavingsCents / 100,
    acceptedExpectedMonthlySavingsReais: summary.acceptedExpectedMonthlySavingsCents / 100,
    verifiedMonthlySavingsReais: summary.verifiedMonthlySavingsCents / 100,
  };
}

function fmtBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Human-readable evidence line per alert type — mirrors `alertFacts` in `copilot/tools.ts` for which figures are groundable, but this is display-only prose, never re-derived math. */
function alertDetail(alert: Alert): string {
  const e = alert.evidence;
  switch (e.kind) {
    case "SAFE_TO_SPEND_MATERIAL_DROP":
      return `De ${fmtBRL(e.previousCents)} para ${fmtBRL(e.currentCents)} (−${fmtBRL(e.deltaCents)}).`;
    case "RECOMMENDATION_DECISION":
      return `${e.recommendationTitle} — valor observado ${fmtBRL(e.observedAmountCents)}.`;
    case "UPCOMING_EVENT_PRESSURE":
      return `${e.eventLabel}: em ${Math.max(0, Math.round(e.daysUntilStart))} dia(s), custo conhecido de ${fmtBRL(e.knownCostCents)}.`;
    case "UPCOMING_EVENT_UNKNOWN_COST":
      return `${e.eventLabel}: em ${Math.max(0, Math.round(e.daysUntilStart))} dia(s), custo ainda não definido.`;
    case "LIQUIDITY_COVERAGE_DEGRADED":
      return `Cobertura de saldo: ${e.previousCoverage} → ${e.currentCoverage}.`;
    case "CONNECTION_NEEDS_ATTENTION":
      return `${e.connectorName ?? "Conexão"}: status ${e.status}.`;
    case "STALE_CONCIERGE_PLAN":
      return `Plano "${e.planLabel}" salvo em ${e.savedAt.slice(0, 10)}.`;
  }
}

function relatedActionFor(alert: Alert): string | undefined {
  switch (alert.type) {
    case "CONNECTION_NEEDS_ATTENTION":
      return "Ação sugerida: veja Connected Accounts para reconectar.";
    case "STALE_CONCIERGE_PLAN":
      return "Ação sugerida: peça ao assistente para recalcular esse plano.";
    case "UPCOMING_EVENT_UNKNOWN_COST":
      return "Ação sugerida: defina um orçamento para esse compromisso pelo chat.";
    default:
      return undefined;
  }
}

function alertCardDataFromAlert(alert: Alert): AlertCardData {
  return {
    id: alert.id,
    type: alert.type,
    severity: alert.severity,
    status: alert.status as "ACTIVE_UNSEEN" | "ACTIVE_SEEN",
    title: alert.title,
    detail: alertDetail(alert),
    ...(relatedActionFor(alert) ? { relatedAction: relatedActionFor(alert) } : {}),
    lastTriggeredAt: alert.lastTriggeredAt,
  };
}

export default async function HomePage() {
  const db = await getDb();

  // Sprint 5: cheap, deterministic, and idempotent — safe to re-run on
  // every page load rather than requiring a separate manual trigger. See
  // docs/RECOMMENDATIONS.md, "Sync integration."
  await evaluateRecommendations(db, DEMO_PROFILE_ID, ASOF_DATE);
  await evaluateRecommendationVerifications(db, DEMO_PROFILE_ID, ASOF_DATE);
  // Sprint 7: same idempotent-by-construction pattern — see
  // docs/ALERTS-NOTIFICATIONS.md, "Alert evaluation orchestration."
  await evaluateAlerts(db, DEMO_PROFILE_ID, ASOF_DATE);
  await syncNotificationsForProfile(db, DEMO_PROFILE_ID);

  const [
    snapshot,
    monthlyTransactions,
    categoryTotals,
    uncategorized,
    recurringCandidates,
    pendingReconciliation,
    comparison,
    connections,
    recommendationsSummary,
    savedConciergePlans,
    allAlerts,
  ] = await Promise.all([
    getFinancialSnapshot(db, DEMO_PROFILE_ID, ASOF_DATE),
    getTransactions(db, DEMO_PROFILE_ID, ASOF_DATE),
    getCategoryTotals(db, DEMO_PROFILE_ID, ASOF_DATE),
    getUncategorizedTransactions(db, DEMO_PROFILE_ID, ASOF_DATE),
    getRecurringCandidates(db, DEMO_PROFILE_ID, ASOF_DATE),
    getReconciliationCandidates(db, DEMO_PROFILE_ID, ASOF_DATE),
    getLifestyleComparison(db, DEMO_PROFILE_ID, ASOF_DATE),
    getConnections(db, DEMO_PROFILE_ID),
    getRecommendationsSummary(db, DEMO_PROFILE_ID),
    listSavedConciergePlansForProfile(db, DEMO_PROFILE_ID),
    listAlertsForProfile(db, DEMO_PROFILE_ID),
  ]);

  const latestSync = connections[0] ? await getLatestSyncRunForConnection(db, connections[0].id) : undefined;
  const future = snapshot.futureInstallmentCommitments;
  const isDemoMode = connections.length === 0;
  const recommendationsData = recommendationsDataFromSummary(recommendationsSummary);

  // Sprint 7 (Section 42, "Dashboard prioritization"): show only the
  // highest-priority active alerts here — never every historical alert.
  const DASHBOARD_ALERT_LIMIT = 5;
  const rankedActiveAlerts = rankAlerts(activeAlerts(allAlerts), new Date().toISOString());
  const dashboardAlerts = rankedActiveAlerts.slice(0, DASHBOARD_ALERT_LIMIT).map((r) => alertCardDataFromAlert(r.alert));

  return (
    <main style={{ maxWidth: 1040, margin: "0 auto", padding: "32px 20px 64px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Money Copilot</h1>
      <p style={{ color: "#8b93a7", marginTop: 0, marginBottom: 12 }}>
        &ldquo;Can I afford to do this without damaging the rest of my financial plan?&rdquo; — Sprint 3
        Open Finance sandbox integration, DB-backed dashboard as of {ASOF_DATE}. This view exists to
        inspect and debug the system, not as final product design.
      </p>
      <div
        style={{
          display: "inline-block",
          padding: "4px 10px",
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.4,
          marginBottom: 28,
          background: isDemoMode ? "#3a2f12" : "#0f3a24",
          color: isDemoMode ? "#e0b64f" : "#4fd18f",
        }}
      >
        {isDemoMode ? "DEMO / FIXTURE DATA — no institution connected" : "PROVIDER DATA CONNECTED (SANDBOX)"}
      </div>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>
          Alertas
          {rankedActiveAlerts.length > 0 ? (
            <span style={{ fontSize: 13, fontWeight: 400, color: "#8b93a7", marginLeft: 8 }}>
              ({rankedActiveAlerts.filter((r) => r.alert.status === "ACTIVE_UNSEEN").length} não vistos)
            </span>
          ) : null}
        </h2>
        <p style={{ color: "#8b93a7", marginTop: 0, marginBottom: 12, fontSize: 14 }}>
          Sinais deterministicos — nunca decididos pela IA. Mostrando os {DASHBOARD_ALERT_LIMIT} mais
          relevantes; pergunte &ldquo;Tenho algum alerta?&rdquo; no chat para o histórico completo.
        </p>
        <AlertCenter alerts={dashboardAlerts} />
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Ask Money Copilot</h2>
        <p style={{ color: "#8b93a7", marginTop: 0, marginBottom: 12, fontSize: 14 }}>
          The engine calculates, the assistant explains — every figure below comes from the same
          deterministic financial engine as the rest of this dashboard. Requires{" "}
          <code>OPENAI_API_KEY</code> to be configured on the server; see .env.example.
        </p>
        <ChatPanel />
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>0. Connected Accounts</h2>
        <ConnectedAccountsPanel
          connections={connections.map((c) => ({
            id: c.id,
            provider: c.provider,
            ...(c.connectorName ? { connectorName: c.connectorName } : {}),
            status: c.status,
            ...(c.lastSuccessfulSyncAt ? { lastSuccessfulSyncAt: c.lastSuccessfulSyncAt } : {}),
          }))}
          {...(latestSync
            ? {
                latestSync: {
                  status: latestSync.status,
                  startedAt: latestSync.startedAt,
                  ...(latestSync.finishedAt ? { finishedAt: latestSync.finishedAt } : {}),
                  accountsDiscovered: latestSync.metrics.accountsDiscovered,
                  transactionsCreated: latestSync.metrics.transactionsCreated,
                  transactionsUpdated: latestSync.metrics.transactionsUpdated,
                  transactionsReconciled: latestSync.metrics.transactionsReconciled,
                  errors: latestSync.errors,
                },
              }
            : {})}
        />
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>1. Financial Snapshot</h2>
        <SnapshotGrid snapshot={snapshot} />
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>2. Safe-to-Spend Breakdown</h2>
        <SafeToSpendBreakdownTable snapshot={snapshot} />
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>3. Transactions ({monthlyTransactions.length})</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Description</th>
              <th style={thStyle}>Amount</th>
              <th style={thStyle}>Category</th>
              <th style={thStyle}>Payment source</th>
              <th style={thStyle}>Effect</th>
              <th style={thStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {monthlyTransactions.map((t) => (
              <tr key={t.id}>
                <td style={tdStyle}>{t.date}</td>
                <td style={tdStyle}>{t.rawDescription}</td>
                <td style={tdStyle}>{format(t.amount)}</td>
                <td style={tdStyle}>
                  {t.category ?? "—"}
                  {t.subcategory ? ` / ${t.subcategory}` : ""}
                </td>
                <td style={tdStyle}>{t.paymentSource.label}</td>
                <td style={tdStyle}>{t.financialEffect}</td>
                <td style={tdStyle}>{t.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>4. Category Totals</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Category</th>
              <th style={thStyle}>Subcategory</th>
              <th style={thStyle}>Total</th>
              <th style={thStyle}>Transactions</th>
            </tr>
          </thead>
          <tbody>
            {categoryTotals.map((c) => (
              <tr key={`${c.category}:${c.subcategory ?? ""}`}>
                <td style={tdStyle}>{c.category}</td>
                <td style={tdStyle}>{c.subcategory ?? "—"}</td>
                <td style={tdStyle}>{format(c.total)}</td>
                <td style={tdStyle}>{c.transactionCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 13, color: "#8b93a7", marginTop: 8 }}>
          The rodeo ticket and the old credit-card debt installment never appear here — the ticket is
          already accounted for via its event, and the debt installment isn&apos;t a transaction at all.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>5. Uncategorized ({uncategorized.length})</h2>
        {uncategorized.length === 0 ? (
          <p style={{ color: "#8b93a7" }}>Nothing uncategorized.</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Raw merchant</th>
                <th style={thStyle}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {uncategorized.map((t) => (
                <tr key={t.id}>
                  <td style={tdStyle}>{t.date}</td>
                  <td style={tdStyle}>{t.rawMerchant ?? t.rawDescription}</td>
                  <td style={tdStyle}>{format(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>6. Installments / Future Commitments</h2>
        <Grid>
          <Stat label="Current period (this month)" value={format(future.currentPeriodAmount)} />
          <Stat label="Next 30 days" value={format(future.next30DaysCommitment)} />
          <Stat label="Next 90 days" value={format(future.next90DaysCommitment)} />
        </Grid>
        {future.hasIncompleteData ? (
          <p style={{ fontSize: 13, color: "#e0b64f", marginTop: 8 }}>
            Incomplete schedule: {future.incompletePlanDescriptions.join(", ")} — projections beyond this
            month are estimates, not silently treated as ending.
          </p>
        ) : null}
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>7. Recurring Candidates</h2>
        {recurringCandidates.length === 0 ? (
          <p style={{ color: "#8b93a7" }}>
            No recurring pattern detected yet — the data only spans a couple of days of transactions.
          </p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Merchant</th>
                <th style={thStyle}>Avg. amount</th>
                <th style={thStyle}>Occurrences</th>
                <th style={thStyle}>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {recurringCandidates.map((c) => (
                <tr key={c.id}>
                  <td style={tdStyle}>{c.normalizedMerchant}</td>
                  <td style={tdStyle}>{format(c.evidence.averageAmount)}</td>
                  <td style={tdStyle}>{c.evidence.occurrences}</td>
                  <td style={tdStyle}>{c.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>8. Reconciliation / Possible Duplicates</h2>
        {pendingReconciliation.length === 0 ? (
          <p style={{ color: "#8b93a7" }}>No unresolved possible duplicates.</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Confidence</th>
                <th style={thStyle}>Method</th>
              </tr>
            </thead>
            <tbody>
              {pendingReconciliation.map((l) => (
                <tr key={l.id}>
                  <td style={tdStyle}>{l.type}</td>
                  <td style={tdStyle}>{l.confidence}</td>
                  <td style={tdStyle}>{l.method}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <LifestyleSection comparison={comparison} />

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>10. Recommendations</h2>
        <RecommendationsPanel data={recommendationsData} />
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>11. Saved Concierge Plans</h2>
        <p style={{ fontSize: 13, color: "#8b93a7", marginTop: 0, marginBottom: 12 }}>
          Selected via chat (Sprint 6) — saving a plan only records intent, it never books anything or
          spends money. Ask Money Copilot things like &ldquo;Vou sair para jantar hoje, quanto posso
          gastar?&rdquo; to build one.
        </p>
        {savedConciergePlans.length === 0 ? (
          <p style={{ color: "#8b93a7" }}>No saved plans yet.</p>
        ) : (
          savedConciergePlans.map((saved) => (
            <div
              key={saved.id}
              style={{
                background: "#151821",
                border: "1px solid #262b38",
                borderRadius: 12,
                padding: "14px 18px",
                marginBottom: 10,
              }}
            >
              <div style={{ fontWeight: 600 }}>{saved.plan.label}</div>
              <div style={{ fontSize: 13, marginTop: 6 }}>
                Total: {saved.plan.totalCostRangeCents ? `${formatCentsRange(saved.plan.totalCostRangeCents)}` : "Price incomplete"} ·
                Fit: {saved.plan.totalBudgetFit.zone}
              </div>
              <div style={{ fontSize: 12, color: "#8b93a7", marginTop: 4 }}>Saved: {saved.createdAt}</div>
            </div>
          ))
        )}
      </section>

      <section>
        <h2 style={sectionTitleStyle}>12. Data Confidence / Warnings</h2>
        <Warnings warnings={snapshot.warnings} />
      </section>
    </main>
  );
}
