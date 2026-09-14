/**
 * The Bank Connection screen's phase state machine (Sprint 9 Phase 4) — kept
 * as a plain, framework-free module so the "which phases count as a
 * server-confirmed successful connection" decision is unit-testable without
 * a browser/DOM, and shared between the route component and its regression
 * tests. See `apps/ritmo/src/routes/_protected/conectar-banco.tsx`.
 */
export type ConnectionFlowPhase =
  "idle" | "requesting_token" | "authorizing" | "syncing" | "success" | "partial" | "error";

/**
 * Post-connection automatic Home transition (regression fix, Sprint 9): a
 * phase only ever becomes `"success"`/`"partial"` after `checkSyncProgress`
 * confirms the initial sync finished (see `pollSyncProgress` in
 * `conectar-banco.tsx`) — never merely because Pluggy's Connect widget
 * closed. `"partial"` (PARTIAL_DATA) counts as a successful connection for
 * navigation purposes, matching the product's existing definition (brief
 * §2/§13: "the Ritmo já pode te ajudar com o que já sabe"). `"error"`
 * (TEMPORARY_ERROR/RECONNECT_REQUIRED surfaces as `"error"` here) must never
 * be treated as success.
 */
export function isConfirmedSuccessfulConnectionPhase(phase: ConnectionFlowPhase): boolean {
  return phase === "success" || phase === "partial";
}
