import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Landmark,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { AuthShell } from "@/components/ritmo/AuthShell";
import { ConnectWidget } from "@/components/ritmo/ConnectWidget";
import { Button } from "@/components/ui/button";
import {
  checkSyncProgress,
  finishBankConnection,
  getConnectionScreenData,
  removeBankConnection,
  requestManualSync,
  startBankConnection,
  type ConnectionScreenData,
  type ConnectionSummaryDTO,
} from "@/functions/connections";
import { isAuthExpiredError } from "@/lib/auth-error";

/**
 * The dedicated Bank Connection screen (Sprint 9 Phase 4, brief §4/§20) —
 * one route, internal state machine for CONNECTING → (Pluggy's own
 * AUTHENTICATING UI) → SYNCING → CONNECTED/PARTIAL_DATA/RECONNECT_REQUIRED/
 * TEMPORARY_ERROR (brief §2). Serves BOTH the first-time onboarding path
 * (`/onboarding` → here) and the `/mais` "manage connections" entry point
 * (brief §18) — reusing one screen for both rather than a route per state,
 * per brief §20's own allowance. See docs/DECISIONS.md DEC-101.
 *
 * Reuses the exact Sprint 3–7 Pluggy architecture unmodified
 * (`@/functions/connections` → `connections.server.ts` →
 * `@money-copilot/app-services`'s existing `createConnectToken`/
 * `completeConnection`/`disconnectConnection`) — no second connection
 * architecture. Every server call resolves the authenticated profile
 * server-side; this component never sends or receives a
 * `financialProfileId`.
 */
export const Route = createFileRoute("/_protected/conectar-banco")({
  head: () => ({ meta: [{ title: "Conectar banco — Ritmo" }] }),
  loader: () => getConnectionScreenData(),
  component: ConectarBanco,
});

type Phase =
  "idle" | "requesting_token" | "authorizing" | "syncing" | "success" | "partial" | "error";

const RECONNECT_LABEL = "Reconectar";
const CONNECT_LABEL = "Conectar meu banco";

function ConectarBanco() {
  const initialData = Route.useLoaderData();
  const navigate = useNavigate();

  const [screenData, setScreenData] = useState<ConnectionScreenData>(initialData);
  const [phase, setPhase] = useState<Phase>("idle");
  const [connectToken, setConnectToken] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncingConnectionId, setSyncingConnectionId] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLivePilot = screenData.openFinanceMode === "live";

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const handleAuthError = useCallback(
    (error: unknown) => {
      if (isAuthExpiredError(error)) {
        navigate({ to: "/sessao-expirada" });
        return true;
      }
      return false;
    },
    [navigate],
  );

  const refreshScreenData = useCallback(async () => {
    try {
      const data = await getConnectionScreenData();
      setScreenData(data);
      return data;
    } catch (error) {
      if (!handleAuthError(error)) throw error;
      return null;
    }
  }, [handleAuthError]);

  /** CONNECTING state (brief §2/§10): honest loading copy, no fabricated progress. */
  const handleStartConnect = useCallback(async () => {
    setErrorMessage(null);
    setPhase("requesting_token");
    try {
      const result = await startBankConnection();
      if (!result.ok) {
        setErrorMessage(result.error.message);
        setPhase("error");
        return;
      }
      setConnectToken(result.connectToken);
      // AUTHENTICATING state (brief §2/§10): Pluggy's own widget UI is the
      // technically-distinguishable authentication step — this screen shows
      // neutral waiting copy behind it rather than reinventing that UI.
      setPhase("authorizing");
    } catch (error) {
      if (handleAuthError(error)) return;
      setErrorMessage("Não foi possível iniciar a conexão agora.");
      setPhase("error");
    }
  }, [handleAuthError]);

  /** SYNCING state (brief §2/§11): polls real persisted sync state — never a fixed fake timer. */
  const pollSyncProgress = useCallback(
    async (connectionId: string) => {
      try {
        const result = await checkSyncProgress({ data: { connectionId } });
        if (!result.ok) {
          setErrorMessage(result.error.message);
          setPhase("error");
          return;
        }
        if (result.progress === "IN_PROGRESS") {
          pollTimer.current = setTimeout(() => void pollSyncProgress(connectionId), 1500);
          return;
        }
        await refreshScreenData();
        if (result.progress === "FAILED") {
          setErrorMessage("A sincronização não foi concluída. Tente novamente.");
          setPhase("error");
        } else if (result.progress === "PARTIAL" || result.coverage === "PARTIAL") {
          setPhase("partial");
        } else {
          setPhase("success");
        }
      } catch (error) {
        if (handleAuthError(error)) return;
        setErrorMessage("Não foi possível verificar a sincronização agora.");
        setPhase("error");
      }
    },
    [handleAuthError, refreshScreenData],
  );

  const handleWidgetSuccess = useCallback(
    async (externalConnectionId: string) => {
      setConnectToken(null);
      setPhase("syncing");
      try {
        const result = await finishBankConnection({ data: { externalConnectionId } });
        if (!result.ok) {
          setErrorMessage(result.error.message);
          setPhase("error");
          return;
        }
        await pollSyncProgress(result.connection.id);
      } catch (error) {
        if (handleAuthError(error)) return;
        setErrorMessage("Conectado, mas não foi possível salvar a conexão. Tente novamente.");
        setPhase("error");
      }
    },
    [handleAuthError, pollSyncProgress],
  );

  const handleWidgetError = useCallback((message: string) => {
    setConnectToken(null);
    setErrorMessage(message || "Não foi possível concluir a conexão.");
    setPhase("error");
  }, []);

  const handleWidgetClose = useCallback(() => {
    setConnectToken(null);
    setPhase("idle");
  }, []);

  const handleDisconnect = useCallback(
    async (connectionId: string) => {
      try {
        const result = await removeBankConnection({ data: { connectionId } });
        if (result.ok) await refreshScreenData();
      } catch (error) {
        handleAuthError(error);
      }
    },
    [handleAuthError, refreshScreenData],
  );

  /**
   * Founder Local Live Bank Pilot — request-driven refresh (brief §7): no
   * public webhook exists for a localhost Live connection, so this is the
   * only way new movements ever get pulled in after the first sync. Reuses
   * `syncConnection` exactly as webhooks do — no second sync engine, no
   * background polling loop.
   */
  const handleManualSync = useCallback(
    async (connectionId: string) => {
      setSyncingConnectionId(connectionId);
      try {
        const result = await requestManualSync({ data: { connectionId } });
        if (!result.ok) setErrorMessage(result.error.message);
        await refreshScreenData();
      } catch (error) {
        handleAuthError(error);
      } finally {
        setSyncingConnectionId(null);
      }
    },
    [handleAuthError, refreshScreenData],
  );

  const isFlowActive = phase === "requesting_token" || phase === "authorizing";

  // TEMPORARY_ERROR / retry state (brief §2/§15) — calm, no raw provider errors, idempotent retry.
  if (phase === "error") {
    return (
      <AuthShell
        title="Não foi possível conectar"
        {...(errorMessage ? { subtitle: errorMessage } : {})}
      >
        <div className="flex flex-col items-center gap-4">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <Button
            size="lg"
            className="w-full rounded-full"
            onClick={() => void handleStartConnect()}
          >
            Tentar novamente
          </Button>
          <Link to="/mais" className="text-[13px] font-semibold text-primary">
            Voltar para Mais
          </Link>
        </div>
      </AuthShell>
    );
  }

  // SYNCING state (brief §2/§11).
  if (phase === "syncing") {
    return (
      <AuthShell
        title="Estamos organizando seus dados"
        subtitle="Isso costuma levar só um instante."
      >
        <div className="flex flex-col items-center gap-4 py-6">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </AuthShell>
    );
  }

  // CONNECTED / success state (brief §2/§12) and PARTIAL_DATA (brief §2/§13).
  if (phase === "success" || phase === "partial") {
    return (
      <AuthShell
        title={phase === "success" ? "Conexão concluída" : "Conexão concluída (parcial)"}
        subtitle={
          phase === "success"
            ? "Sua instituição está conectada e o Ritmo já está pronto para te ajudar."
            : "Conectamos sua instituição, mas ainda estamos com informações incompletas — o Ritmo já pode te ajudar com o que já sabe."
        }
      >
        <div className="flex flex-col items-center gap-4">
          <CheckCircle2 className="h-10 w-10 text-primary" />
          <Button size="lg" className="w-full rounded-full" onClick={() => navigate({ to: "/" })}>
            Ir para o Início
          </Button>
        </div>
      </AuthShell>
    );
  }

  const needingAttention = screenData.connections.find((c) => c.health === "NEEDS_ATTENTION");
  const healthy = screenData.connections.filter((c) => c.health !== "NEEDS_ATTENTION");

  return (
    <AuthShell
      title="Conectar banco"
      subtitle="Sua conexão é somente leitura — o Ritmo nunca move seu dinheiro."
    >
      <div className="flex flex-col gap-4">
        {/*
          Founder Local Live Bank Pilot — dev-only, unobtrusive indicator.
          `openFinanceMode` only ever resolves to "live" when APP_ENV is
          exactly "development" AND both explicit pilot flags are set (see
          `open-finance-mode.server.ts`) — never reachable in staging/
          production, so no separate build-mode check is needed here. Never
          shows account/institution details, just the mode itself.
        */}
        {isLivePilot ? (
          <div className="rounded-full border border-amber-400/60 bg-amber-50 px-3 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-amber-800">
            Banco real — piloto local
          </div>
        ) : null}

        {/*
          Data-isolation warning (brief §9) — report only, never auto-delete.
          Surfaces when a Founder is about to connect a real bank on a
          profile that already has connections (most likely sandbox test
          data from ordinary development), so mixing sandbox and Live data
          on the same profile is a deliberate, informed choice, not silent.
        */}
        {isLivePilot && screenData.hasAnyConnection ? (
          <div className="surface flex items-start gap-3 border border-amber-400/60 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-[13px] text-foreground">
              Este perfil já tem conexões (provavelmente dados de teste/sandbox). Conectar um banco
              real aqui vai somar dados reais às mesmas conexões — nada é apagado automaticamente.
            </p>
          </div>
        ) : null}

        {/* RECONNECT_REQUIRED state (brief §2/§14) — same connect flow, relabeled, per docs/OPEN-FINANCE.md DEC-080. */}
        {needingAttention ? (
          <ConnectionRow
            connection={needingAttention}
            actionLabel={RECONNECT_LABEL}
            onAction={() => void handleStartConnect()}
            actionDisabled={isFlowActive}
            attention
          />
        ) : null}

        {healthy.map((connection) => (
          <ConnectionRow
            key={connection.id}
            connection={connection}
            actionLabel="Desconectar"
            onAction={() => void handleDisconnect(connection.id)}
            destructive
            {...(isLivePilot
              ? {
                  onSync: () => void handleManualSync(connection.id),
                  syncing: syncingConnectionId === connection.id,
                }
              : {})}
          />
        ))}

        {!needingAttention ? (
          <div className="surface flex items-start gap-3 p-4">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-[13px] text-foreground">
              O Ritmo usa a Pluggy, parceira de conexão bancária segura, para ler suas movimentações
              — suas credenciais nunca ficam salvas aqui.
            </p>
          </div>
        ) : null}

        <Button
          size="lg"
          className="w-full rounded-full"
          disabled={isFlowActive}
          onClick={() => void handleStartConnect()}
        >
          {phase === "requesting_token"
            ? "Conectando com segurança..."
            : phase === "authorizing"
              ? "Aguardando autorização..."
              : healthy.length > 0
                ? "Conectar outra instituição"
                : CONNECT_LABEL}
        </Button>
      </div>

      {typeof window !== "undefined" && connectToken && phase === "authorizing" ? (
        <ConnectWidget
          connectToken={connectToken}
          includeSandbox={screenData.openFinanceMode === "sandbox"}
          onSuccess={(externalConnectionId) => void handleWidgetSuccess(externalConnectionId)}
          onError={handleWidgetError}
          onClose={handleWidgetClose}
        />
      ) : null}
    </AuthShell>
  );
}

function ConnectionRow({
  connection,
  actionLabel,
  onAction,
  actionDisabled,
  attention,
  destructive,
  onSync,
  syncing,
}: {
  readonly connection: ConnectionSummaryDTO;
  readonly actionLabel: string;
  readonly onAction: () => void;
  readonly actionDisabled?: boolean;
  readonly attention?: boolean;
  readonly destructive?: boolean;
  /**
   * Founder Local Live Bank Pilot only (brief §7) — a manual, request-driven
   * refresh, since no public webhook exists for a localhost Live connection.
   * Omitted entirely outside that mode.
   */
  readonly onSync?: () => void;
  readonly syncing?: boolean;
}) {
  return (
    <div className="surface flex items-center gap-3 p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        {attention ? (
          <RefreshCw className="h-4 w-4 text-destructive" />
        ) : (
          <Landmark className="h-4 w-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium">{connection.connectorName}</p>
        {attention ? (
          <p className="text-[12px] text-destructive">Precisa de atenção</p>
        ) : (
          <p className="truncate text-[12px] text-muted-foreground">
            {connection.lastSuccessfulSyncAt
              ? `Última sincronização: ${new Date(connection.lastSuccessfulSyncAt).toLocaleDateString("pt-BR")}`
              : "Sincronizando…"}
          </p>
        )}
      </div>
      {onSync ? (
        <button
          onClick={onSync}
          disabled={syncing}
          className="shrink-0 rounded-full border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground disabled:opacity-50"
        >
          {syncing ? "Sincronizando…" : "Sincronizar agora"}
        </button>
      ) : null}
      <button
        onClick={onAction}
        disabled={actionDisabled}
        className={
          destructive
            ? "shrink-0 rounded-full border border-border px-3 py-1.5 text-[12px] font-semibold text-destructive disabled:opacity-50"
            : "shrink-0 rounded-full brand-gradient px-3 py-1.5 text-[12px] font-semibold text-primary-foreground disabled:opacity-50"
        }
      >
        {actionLabel}
      </button>
    </div>
  );
}
