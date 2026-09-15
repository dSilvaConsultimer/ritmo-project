import { DEFAULT_TIME_ZONE, todayIsoDate } from "@money-copilot/config";

/**
 * "Today," for every Ritmo server function — resolved fresh on every call
 * from the real clock (`America/Sao_Paulo`, the MVP's fixed default). See
 * docs/DECISIONS.md DEC-127: this used to be a hardcoded literal
 * ("2026-09-05", a Sprint 8 demo/fixture snapshot mirroring
 * `apps/web/app/page.tsx`'s own constant) that never advanced. Every real
 * call site already threaded an explicit `asOfDate: string` parameter
 * through pure functions (`getFinancialSnapshot`, `buildFinancialSnapshot`,
 * etc.) — replacing this one source with a real clock needed no signature
 * changes downstream.
 *
 * `now` is injectable so a caller (or a test) can pin a specific instant —
 * production code should call this with no arguments.
 */
export function resolveAsOfDate(now?: Date): string {
  return now ? todayIsoDate(DEFAULT_TIME_ZONE, now) : todayIsoDate(DEFAULT_TIME_ZONE);
}
