/**
 * The date every Ritmo server function treats as "today" — mirrors
 * `apps/web/app/page.tsx`'s own `ASOF_DATE` constant so both frontends
 * reflect the exact same demo/fixture state during the Sprint 8 transition
 * period. A real clock/timezone policy remains future work (unchanged from
 * every prior sprint).
 */
export const ASOF_DATE = "2026-09-05";
