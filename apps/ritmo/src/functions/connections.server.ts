import { z } from "zod";
import {
  createConnectToken,
  completeConnection,
  disconnectConnection,
  getConnections,
  getLatestSyncRunForConnection,
  getFinancialPosition,
  syncConnection,
} from "@money-copilot/app-services";
import { ProviderError, type ProviderConnection } from "@money-copilot/financial-engine";
import { getCurrentProfileContext } from "./profile.server";
import { getDb } from "@money-copilot/app-services";
import { resolveAsOfDate } from "./config";
import { checkRateLimit, RATE_LIMIT_POLICIES } from "./rate-limit.server";
import { logger } from "./logger.server";
import { resolveWebhookUrl } from "./webhook-url.server";
import { resolveOpenFinanceMode, type OpenFinanceMode } from "./open-finance-mode.server";

/**
 * Server-only Sprint 9 Phase 4 (onboarding / bank connection) implementation.
 * Reuses the existing Sprint 3–7 Pluggy architecture as-is
 * (`createConnectToken`/`completeConnection`/`disconnectConnection`/
 * `getConnections`/`getLatestSyncRunForConnection` — see docs/OPEN-FINANCE.md)
 * — no second connection architecture, no new provider logic. Every function
 * here resolves `financialProfileId` itself via `getCurrentProfileContext()`
 * and never accepts one from the caller — see docs/DECISIONS.md DEC-101.
 * The `.server.ts` suffix signals this file is server-only to Vite's import
 * protection (it imports database/provider code).
 */

/**
 * Collapses the richer, provider-facing `ProviderConnectionStatus` into the
 * three health states the PRODUCT needs to react to — never exposes
 * `LOGIN_ERROR`/`USER_ACTION_REQUIRED`/raw provider vocabulary to the UI
 * layer (brief: never expose ProviderConnection/Item ID/Pluggy terms to the
 * user). `RECONNECT_STATUSES` matches `apps/web`'s existing
 * `ConnectedAccountsPanel` exactly (Sprint 7, DEC-080) — same product
 * decision, not a new one.
 */
const RECONNECT_STATUSES = new Set(["LOGIN_ERROR", "USER_ACTION_REQUIRED", "ERROR"]);

export type ConnectionHealth = "OK" | "SYNCING" | "NEEDS_ATTENTION" | "PENDING";

export interface ConnectionSummaryDTO {
  readonly id: string;
  readonly connectorName: string;
  readonly health: ConnectionHealth;
  readonly lastSuccessfulSyncAt: string | null;
}

function toConnectionSummary(connection: ProviderConnection): ConnectionSummaryDTO {
  const health: ConnectionHealth = RECONNECT_STATUSES.has(connection.status)
    ? "NEEDS_ATTENTION"
    : connection.status === "SYNCING"
      ? "SYNCING"
      : connection.status === "PENDING"
        ? "PENDING"
        : "OK";
  return {
    id: connection.id,
    connectorName: connection.connectorName ?? "Instituição financeira",
    health,
    lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt ?? null,
  };
}

export interface ConnectionScreenData {
  readonly hasAnyConnection: boolean;
  readonly needsAttention: boolean;
  readonly coverage: "COMPLETE" | "PARTIAL" | "UNKNOWN";
  readonly connections: readonly ConnectionSummaryDTO[];
  /**
   * Founder Local Live Bank Pilot — resolved server-side (never trusted from
   * the client) so the UI can derive the Connect widget's sandbox/live
   * behavior and the dev-only "REAL BANK — LOCAL PILOT" indicator from one
   * authoritative source, same as `hasAnyConnection` above.
   */
  readonly openFinanceMode: OpenFinanceMode;
}

/**
 * The single read every onboarding-routing decision and the Bank Connection
 * screen itself are built from — real, persisted state, never a
 * client-only flag (brief §8).
 */
export async function getConnectionScreenDataHandler(): Promise<ConnectionScreenData> {
  const { financialProfileId } = await getCurrentProfileContext();
  checkOpenFinancePollLimit(financialProfileId);
  const db = await getDb();

  const [connections, position] = await Promise.all([
    getConnections(db, financialProfileId),
    getFinancialPosition(db, financialProfileId, resolveAsOfDate()),
  ]);

  const summaries = connections.map(toConnectionSummary);
  return {
    hasAnyConnection: connections.length > 0,
    needsAttention: summaries.some((c) => c.health === "NEEDS_ATTENTION"),
    coverage: position.coverage,
    connections: summaries,
    openFinanceMode: resolveOpenFinanceMode(),
  };
}

type ActionError = { readonly code: string; readonly message: string };

const RATE_LIMITED_ERROR: ActionError = {
  code: "RATE_LIMITED",
  message: "Muitas tentativas em pouco tempo. Aguarde um instante e tente de novo.",
};

/**
 * Sprint 9 Phase 5 (DEC-105, brief §6): expensive, provider-calling actions
 * (create token / complete connection / disconnect) get the strict policy;
 * read/poll operations get a separate, generous one so the Phase 4 1.5s
 * SYNCING poll is never affected. Keyed by `financialProfileId` — never a
 * client-supplied value.
 */
function checkOpenFinanceActionLimit(financialProfileId: string): boolean {
  const result = checkRateLimit(
    `of:action:${financialProfileId}`,
    RATE_LIMIT_POLICIES.openFinanceAction,
  );
  if (!result.allowed)
    logger.warn("open_finance_rate_limited", { financialProfileId, kind: "action" });
  return result.allowed;
}

function checkOpenFinancePollLimit(financialProfileId: string): boolean {
  const result = checkRateLimit(
    `of:poll:${financialProfileId}`,
    RATE_LIMIT_POLICIES.openFinancePoll,
  );
  if (!result.allowed)
    logger.warn("open_finance_rate_limited", { financialProfileId, kind: "poll" });
  return result.allowed;
}

function normalizeProviderError(error: unknown): ActionError {
  if (error instanceof ProviderError) {
    return { code: error.code, message: honestProviderErrorMessage(error) };
  }
  return { code: "UNKNOWN_ERROR", message: "Não foi possível concluir a conexão agora." };
}

/**
 * Calm, honest, Ritmo-toned copy per provider error code — never a raw
 * provider error body/stack trace (brief §15).
 */
function honestProviderErrorMessage(error: ProviderError): string {
  switch (error.code) {
    case "INVALID_CONFIGURATION":
      return "A conexão com instituições financeiras ainda não está configurada neste ambiente.";
    case "RATE_LIMITED":
    case "PROVIDER_UNAVAILABLE":
    case "NETWORK_ERROR":
      return "Estamos com instabilidade para conectar agora. Tente novamente em instantes.";
    default:
      return "Não foi possível concluir a conexão agora.";
  }
}

/**
 * Creates a Pluggy Connect Token for the authenticated profile. Used
 * identically for a first connection AND a reconnect (Sprint 7, DEC-080) —
 * `completeConnection`'s own (profile, provider, externalConnectionId)
 * lookup is what prevents a reconnect from ever creating a second
 * `ProviderConnection`, not anything provider-token-specific.
 */
export async function startBankConnectionHandler(): Promise<
  | { readonly ok: true; readonly connectToken: string }
  | { readonly ok: false; readonly error: ActionError }
> {
  const { financialProfileId } = await getCurrentProfileContext();
  if (!checkOpenFinanceActionLimit(financialProfileId)) {
    return { ok: false, error: RATE_LIMITED_ERROR };
  }
  const db = await getDb();
  try {
    // Sprint 9 Phase 6A (DEC-121): resolves to a real webhook URL once a
    // real staging/production BETTER_AUTH_URL exists; `undefined` locally,
    // which `createConnectToken` already handles (no webhook registered).
    const result = await createConnectToken(db, financialProfileId, "pluggy", resolveWebhookUrl());
    return { ok: true, connectToken: result.connectToken };
  } catch (error) {
    return { ok: false, error: normalizeProviderError(error) };
  }
}

export const finishConnectionInput = z.object({
  externalConnectionId: z.string().min(1),
});
export type FinishConnectionInput = z.infer<typeof finishConnectionInput>;

export async function finishBankConnectionHandler(
  data: FinishConnectionInput,
): Promise<
  | { readonly ok: true; readonly connection: ConnectionSummaryDTO; readonly syncRunId: string }
  | { readonly ok: false; readonly error: ActionError }
> {
  const { financialProfileId } = await getCurrentProfileContext();
  if (!checkOpenFinanceActionLimit(financialProfileId)) {
    return { ok: false, error: RATE_LIMITED_ERROR };
  }
  const db = await getDb();
  try {
    const { connection, syncRun } = await completeConnection(
      db,
      financialProfileId,
      "pluggy",
      data.externalConnectionId,
    );
    // Audit event (brief §13) — a real connection lifecycle change, not
    // ordinary debug logging. No secrets/financial payload, just the fact.
    logger.audit("connection_completed", { financialProfileId, connectionId: connection.id });
    return { ok: true, connection: toConnectionSummary(connection), syncRunId: syncRun.id };
  } catch (error) {
    return { ok: false, error: normalizeProviderError(error) };
  }
}

export const checkSyncProgressInput = z.object({
  connectionId: z.string().min(1),
});
export type CheckSyncProgressInput = z.infer<typeof checkSyncProgressInput>;

export type SyncProgress = "IN_PROGRESS" | "SUCCESS" | "PARTIAL" | "FAILED";

export async function checkSyncProgressHandler(data: CheckSyncProgressInput): Promise<
  | {
      readonly ok: true;
      readonly progress: SyncProgress;
      readonly connection: ConnectionSummaryDTO;
      readonly coverage: "COMPLETE" | "PARTIAL" | "UNKNOWN";
    }
  | { readonly ok: false; readonly error: ActionError }
> {
  const { financialProfileId } = await getCurrentProfileContext();
  checkOpenFinancePollLimit(financialProfileId);
  const db = await getDb();
  try {
    const [latestRun, connections, position] = await Promise.all([
      getLatestSyncRunForConnection(db, financialProfileId, data.connectionId),
      getConnections(db, financialProfileId),
      getFinancialPosition(db, financialProfileId, resolveAsOfDate()),
    ]);
    const connection = connections.find((c) => c.id === data.connectionId);
    if (!connection) {
      return { ok: false, error: { code: "NOT_FOUND", message: "Conexão não encontrada." } };
    }

    const progress: SyncProgress =
      !latestRun || latestRun.status === "PENDING" || latestRun.status === "RUNNING"
        ? "IN_PROGRESS"
        : latestRun.status === "SUCCEEDED"
          ? "SUCCESS"
          : latestRun.status === "PARTIAL"
            ? "PARTIAL"
            : "FAILED";

    return {
      ok: true,
      progress,
      connection: toConnectionSummary(connection),
      coverage: position.coverage,
    };
  } catch (error) {
    return { ok: false, error: normalizeProviderError(error) };
  }
}

export const removeConnectionInput = z.object({
  connectionId: z.string().min(1),
});
export type RemoveConnectionInput = z.infer<typeof removeConnectionInput>;

export async function removeBankConnectionHandler(
  data: RemoveConnectionInput,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: ActionError }> {
  const { financialProfileId } = await getCurrentProfileContext();
  if (!checkOpenFinanceActionLimit(financialProfileId)) {
    return { ok: false, error: RATE_LIMITED_ERROR };
  }
  const db = await getDb();
  try {
    await disconnectConnection(db, financialProfileId, data.connectionId);
    logger.audit("connection_disconnected", {
      financialProfileId,
      connectionId: data.connectionId,
    });
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: { code: "UNKNOWN_ERROR", message: "Não foi possível desconectar agora." },
    };
  }
}

export const requestManualSyncInput = z.object({
  connectionId: z.string().min(1),
});
export type RequestManualSyncInput = z.infer<typeof requestManualSyncInput>;

/**
 * Founder Local Live Bank Pilot (and any manual "sync now" affordance more
 * generally) — a request-driven, on-demand refresh. Reuses `syncConnection`
 * exactly as webhooks/scheduled syncs do (see `@money-copilot/app-services`'s
 * `sync.ts`/`webhook.ts`); no second sync engine, no background polling loop
 * of its own. This matters most for the local Live pilot, where no public
 * webhook URL exists at all (see `webhook-url.server.ts`) — without this
 * action, a locally-connected real bank would never refresh after the
 * initial sync.
 */
export async function requestManualSyncHandler(
  data: RequestManualSyncInput,
): Promise<
  | { readonly ok: true; readonly connection: ConnectionSummaryDTO }
  | { readonly ok: false; readonly error: ActionError }
> {
  const { financialProfileId } = await getCurrentProfileContext();
  if (!checkOpenFinanceActionLimit(financialProfileId)) {
    return { ok: false, error: RATE_LIMITED_ERROR };
  }
  const db = await getDb();
  try {
    await syncConnection(db, financialProfileId, data.connectionId);
    const connections = await getConnections(db, financialProfileId);
    const connection = connections.find((c) => c.id === data.connectionId);
    if (!connection) {
      return { ok: false, error: { code: "NOT_FOUND", message: "Conexão não encontrada." } };
    }
    logger.audit("connection_manual_sync_requested", {
      financialProfileId,
      connectionId: data.connectionId,
    });
    return { ok: true, connection: toConnectionSummary(connection) };
  } catch (error) {
    return { ok: false, error: normalizeProviderError(error) };
  }
}

export interface AutoSyncSummary {
  readonly ok: boolean;
  readonly attempted: number;
  readonly succeeded: number;
  readonly failed: number;
}

/**
 * DEC-129: runs once per authenticated app session — triggered from the
 * `_protected` layout's own component (mounted once per app open, never
 * per-route-navigation), not from any route's `loader`/`beforeLoad` (which
 * would re-run on every internal navigation). Reuses `syncConnection`
 * exactly as the webhook and manual "Sincronizar agora" paths do — no
 * second sync pipeline. Every connection is attempted independently: one
 * failing never stops the others, and `syncConnection` itself never
 * deletes previously-synced data on failure (see DEC-128) — so a partial
 * failure here still leaves the app fully usable with whatever data is
 * already persisted. Shares the same `openFinanceAction` rate-limit bucket
 * as every other provider-calling action (brief §6) rather than inventing
 * a separate policy for this trigger.
 */
export async function syncAllConnectionsOnOpenHandler(): Promise<AutoSyncSummary> {
  const { financialProfileId } = await getCurrentProfileContext();
  if (!checkOpenFinanceActionLimit(financialProfileId)) {
    return { ok: false, attempted: 0, succeeded: 0, failed: 0 };
  }
  const db = await getDb();
  const connections = await getConnections(db, financialProfileId);
  const active = connections.filter((c) => c.status !== "DISCONNECTED");

  let succeeded = 0;
  let failed = 0;
  for (const connection of active) {
    try {
      // `syncConnection` never throws for a provider-side failure — it
      // reports a FAILED `SyncRun` instead (see docs/DECISIONS.md DEC-128).
      // The try/catch here is a second, defense-in-depth layer for a truly
      // unexpected error (e.g. a database-level failure), not the primary
      // signal of whether this connection's sync succeeded.
      const syncRun = await syncConnection(db, financialProfileId, connection.id);
      if (syncRun.status === "FAILED") {
        failed += 1;
        logger.error("auto_sync_on_open_connection_failed", {
          financialProfileId,
          connectionId: connection.id,
          errors: syncRun.errors,
        });
      } else {
        succeeded += 1;
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Unknown auto-sync error";
      logger.error("auto_sync_on_open_connection_failed", {
        financialProfileId,
        connectionId: connection.id,
        message,
      });
    }
  }

  logger.audit("auto_sync_on_open", {
    financialProfileId,
    attempted: active.length,
    succeeded,
    failed,
  });
  return { ok: true, attempted: active.length, succeeded, failed };
}
