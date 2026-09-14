import { describe, expect, it } from "vitest";
import { isConfirmedSuccessfulConnectionPhase, type ConnectionFlowPhase } from "./connection-flow";

/**
 * Post-connection automatic Home transition — regression test matrix
 * (items 4, 6, 7 of the fix's request): proves which phases the Bank
 * Connection screen treats as a server-confirmed successful connection
 * (and therefore auto-navigates to Home for) without needing a browser —
 * `conectar-banco.tsx` only ever reaches these phases via
 * `checkSyncProgress`'s real, persisted result (never merely because
 * Pluggy's widget closed — see that file's `pollSyncProgress`).
 */
describe("isConfirmedSuccessfulConnectionPhase", () => {
  it("(4) CONNECTED (success) counts as a confirmed successful connection", () => {
    expect(isConfirmedSuccessfulConnectionPhase("success")).toBe(true);
  });

  it("(6) PARTIAL_DATA (partial) also counts as a confirmed successful connection", () => {
    expect(isConfirmedSuccessfulConnectionPhase("partial")).toBe(true);
  });

  it("(7) TEMPORARY_ERROR/RECONNECT_REQUIRED (error) never counts as success", () => {
    expect(isConfirmedSuccessfulConnectionPhase("error")).toBe(false);
  });

  it("no other phase is ever treated as a confirmed successful connection", () => {
    const nonSuccessPhases: readonly ConnectionFlowPhase[] = [
      "idle",
      "requesting_token",
      "authorizing",
      "syncing",
    ];
    for (const phase of nonSuccessPhases) {
      expect(isConfirmedSuccessfulConnectionPhase(phase)).toBe(false);
    }
  });
});
