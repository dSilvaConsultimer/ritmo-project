"use client";

import { useRouter } from "next/navigation";
import { ConnectButton } from "./ConnectButton";
import { SyncButton } from "./SyncButton";
import { DisconnectButton } from "./DisconnectButton";

export interface ConnectionSummary {
  id: string;
  provider: string;
  connectorName?: string;
  status: string;
  lastSuccessfulSyncAt?: string;
}

const RECONNECT_STATUSES = new Set(["LOGIN_ERROR", "USER_ACTION_REQUIRED", "ERROR"]);

export interface SyncRunSummary {
  status: string;
  startedAt: string;
  finishedAt?: string;
  accountsDiscovered: number;
  transactionsCreated: number;
  transactionsUpdated: number;
  transactionsReconciled: number;
  errors: readonly string[];
}

const cardStyle: React.CSSProperties = {
  background: "#151821",
  border: "1px solid #262b38",
  borderRadius: 12,
  padding: "14px 18px",
  marginBottom: 10,
};

export function ConnectedAccountsPanel({
  connections,
  latestSync,
}: {
  connections: readonly ConnectionSummary[];
  latestSync?: SyncRunSummary;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <ConnectButton onConnected={refresh} />
      </div>

      {connections.length === 0 ? (
        <p style={{ color: "#8b93a7" }}>No institution connected yet — showing DEMO / FIXTURE data below.</p>
      ) : (
        connections.map((c) => (
          <div key={c.id} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{c.connectorName ?? c.provider}</div>
                <div style={{ fontSize: 12, color: "#8b93a7" }}>
                  Status: {c.status} · Last sync: {c.lastSuccessfulSyncAt ?? "never"}
                </div>
                {RECONNECT_STATUSES.has(c.status) ? (
                  <div style={{ fontSize: 12, color: "#e0b64f", marginTop: 4 }}>
                    Esta conexão precisa de atenção — reconecte para continuar sincronizando.
                  </div>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {RECONNECT_STATUSES.has(c.status) ? (
                  <ConnectButton onConnected={refresh} label="Reconectar" />
                ) : (
                  <SyncButton connectionId={c.id} onSynced={refresh} />
                )}
                <DisconnectButton connectionId={c.id} connectorLabel={c.connectorName ?? c.provider} onDisconnected={refresh} />
              </div>
            </div>
          </div>
        ))
      )}

      {latestSync ? (
        <div style={{ ...cardStyle, marginTop: 14 }}>
          <div style={{ fontSize: 13, color: "#8b93a7", marginBottom: 6 }}>Latest sync (developer view)</div>
          <div style={{ fontSize: 13 }}>
            Status: <strong>{latestSync.status}</strong> · Started: {latestSync.startedAt} · Finished:{" "}
            {latestSync.finishedAt ?? "—"}
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            Accounts: {latestSync.accountsDiscovered} · Created: {latestSync.transactionsCreated} · Updated:{" "}
            {latestSync.transactionsUpdated} · Reconciled: {latestSync.transactionsReconciled}
          </div>
          {latestSync.errors.length > 0 ? (
            <ul style={{ color: "#e0b64f", fontSize: 13, marginTop: 6 }}>
              {latestSync.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
