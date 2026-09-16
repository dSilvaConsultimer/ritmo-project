export type SpendingPeriod = "current" | "previous";

/** The 1st of the month before `asOfDate`'s month — any date within that month works, since every category-total/date function only ever compares year+month. */
function previousMonthAsOfDate(asOfDate: string): string {
  const [year, month] = asOfDate.split("-").map(Number) as [number, number];
  const previous = new Date(Date.UTC(year, month - 1 - 1, 1));
  return previous.toISOString().slice(0, 10);
}

/**
 * Shared by both `planejamento.ts` (client-safe wrappers) and
 * `planejamento-data.server.ts` (the real, server-only logic) — kept in its
 * own tiny, dependency-free module so neither side needs to import from the
 * other (which would risk pulling the server-only module's heavy
 * dependencies into the client bundle again — see `planejamento-data.server.ts`'s
 * own doc comment for the exact regression this avoids).
 */
export function resolveSpendingAsOfDate(realAsOfDate: string, period: SpendingPeriod): string {
  return period === "previous" ? previousMonthAsOfDate(realAsOfDate) : realAsOfDate;
}
