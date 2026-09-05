import type { CSSProperties } from "react";
import {
  buildFinancialSnapshot,
  compareLifestyles,
  format,
  initialUserSnapshotInput,
  currentLifestyleScenario,
  independentLivingScenario,
  type FinancialSnapshot,
} from "@money-copilot/financial-engine";

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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={cardStyle}>
      <div style={labelStyle}>{label}</div>
      <div style={valueStyle}>{value}</div>
      {sub ? <div style={{ fontSize: 13, color: "#8b93a7", marginTop: 4 }}>{sub}</div> : null}
    </div>
  );
}

function SnapshotGrid({ snapshot }: { snapshot: FinancialSnapshot }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 14,
      }}
    >
      <Stat label="Monthly income (gross)" value={format(snapshot.income.gross)} />
      <Stat label="Taxes" value={format(snapshot.income.taxes)} />
      <Stat label="Usable income" value={format(snapshot.income.usable)} />
      <Stat label="Fixed commitments" value={format(snapshot.commitments.fixed)} />
      <Stat label="Variable budgets" value={format(snapshot.commitments.variableBudgets)} />
      <Stat label="Actual spending (this month)" value={format(snapshot.commitments.actualSpending)} />
      <Stat label="Future confirmed expenses" value={format(snapshot.commitments.futureConfirmed)} />
      <Stat label="Future estimated expenses" value={format(snapshot.commitments.futureEstimated)} />
      <Stat
        label="Protected savings target"
        value={format(snapshot.protectedSavings)}
        sub="Non-negotiable this month"
      />
      <Stat
        label="Safe-to-Spend"
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
    </div>
  );
}

function Warnings({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) {
    return <p style={{ color: "#8b93a7" }}>No warnings.</p>;
  }
  return (
    <ul style={{ margin: 0, paddingLeft: 20, color: "#e0b64f" }}>
      {warnings.map((w) => (
        <li key={w} style={{ marginBottom: 6 }}>
          {w}
        </li>
      ))}
    </ul>
  );
}

export default function HomePage() {
  const currentSnapshot = buildFinancialSnapshot(initialUserSnapshotInput);
  const comparison = compareLifestyles(
    initialUserSnapshotInput,
    currentLifestyleScenario,
    independentLivingScenario,
  );

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "32px 20px 64px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Money Copilot</h1>
      <p style={{ color: "#8b93a7", marginTop: 0, marginBottom: 28 }}>
        &ldquo;Can I afford to do this without damaging the rest of my financial plan?&rdquo; — Sprint 1
        deterministic financial core, fixture data as of {currentSnapshot.asOfDate}.
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Current lifestyle</h2>
        <SnapshotGrid snapshot={currentSnapshot} />
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Warnings</h2>
        <Warnings warnings={currentSnapshot.warnings} />
      </section>

      <section>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>
          Current lifestyle vs. independent living simulation
        </h2>
        <p style={{ color: "#8b93a7", marginTop: 0, marginBottom: 16, fontSize: 14 }}>
          The independent-living scenario adds estimated household costs (dinner/food, cleaning,
          supplies) without changing any real financial data.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 14,
            marginBottom: 14,
          }}
        >
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
          <Stat
            label="Plan viability"
            value={comparison.isIndependentLivingViable ? "Viable" : "At risk"}
            sub="Based on whether projected savings would stay non-negative"
          />
        </div>
      </section>
    </main>
  );
}
