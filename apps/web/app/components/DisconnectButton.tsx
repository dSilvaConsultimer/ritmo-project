"use client";

import { useCallback, useState } from "react";

interface DisconnectButtonProps {
  connectionId: string;
  connectorLabel: string;
  onDisconnected: () => void;
}

/**
 * Sprint 7: the previously-missing UI for `disconnectConnection`/
 * `DELETE /api/connections?connectionId=...` (Sprint 4.5, DEC-050). Requires
 * an explicit confirmation step, disables itself while the request is in
 * flight (idempotent — a duplicate click while pending is a no-op, never a
 * second delete), and always refreshes the page's server-rendered state
 * afterward so a disconnected account never keeps showing as connected. See
 * docs/OPEN-FINANCE.md, "Connection deletion."
 */
export function DisconnectButton({ connectionId, connectorLabel, onDisconnected }: DisconnectButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = useCallback(async () => {
    setIsDisconnecting(true);
    setError(null);
    try {
      const response = await fetch(`/api/connections?connectionId=${encodeURIComponent(connectionId)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to disconnect");
      setConfirming(false);
      onDisconnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setIsDisconnecting(false);
    }
  }, [connectionId, onDisconnected]);

  if (confirming) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
        <div style={{ fontSize: 12, color: "#e0b64f", maxWidth: 220, textAlign: "right" }}>
          Desconectar {connectorLabel}? Isso remove os dados importados aqui — não apaga nada no banco.
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setConfirming(false)}
            disabled={isDisconnecting}
            style={{
              background: "transparent",
              color: "#c7cbd6",
              border: "1px solid #3a4152",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 12,
              cursor: isDisconnecting ? "default" : "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={isDisconnecting}
            aria-busy={isDisconnecting}
            style={{
              background: "#5c2b2b",
              color: "#f5c9c9",
              border: "1px solid #7a3a3a",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 12,
              cursor: isDisconnecting ? "default" : "pointer",
              opacity: isDisconnecting ? 0.7 : 1,
            }}
          >
            {isDisconnecting ? "Desconectando…" : "Confirmar desconexão"}
          </button>
        </div>
        {error ? <p style={{ color: "#e08a8a", fontSize: 11, margin: 0 }}>{error}</p> : null}
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      style={{
        background: "transparent",
        color: "#8b93a7",
        border: "1px solid #3a4152",
        borderRadius: 8,
        padding: "8px 14px",
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      Desconectar
    </button>
  );
}
