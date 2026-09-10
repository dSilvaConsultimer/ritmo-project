"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

export interface AlertCardData {
  id: string;
  type: string;
  severity: "INFO" | "ATTENTION" | "IMPORTANT";
  status: "ACTIVE_UNSEEN" | "ACTIVE_SEEN";
  title: string;
  detail: string;
  relatedAction?: string;
  lastTriggeredAt: string;
}

const SEVERITY_STYLE: Record<AlertCardData["severity"], { bg: string; fg: string; label: string }> = {
  IMPORTANT: { bg: "#3a1f1f", fg: "#e8a3a3", label: "Importante" },
  ATTENTION: { bg: "#3a2f12", fg: "#e0b64f", label: "Atenção" },
  INFO: { bg: "#12263a", fg: "#7fb8e0", label: "Info" },
};

function AlertCard({ alert, onSeen, onDismissed }: { alert: AlertCardData; onSeen: (id: string) => void; onDismissed: (id: string) => void }) {
  const [isUpdating, setIsUpdating] = useState(false);
  const style = SEVERITY_STYLE[alert.severity];

  const act = useCallback(
    async (action: "SEEN" | "DISMISS") => {
      setIsUpdating(true);
      try {
        const response = await fetch("/api/alerts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alertId: alert.id, action }),
        });
        if (response.ok) {
          if (action === "SEEN") onSeen(alert.id);
          else onDismissed(alert.id);
        }
      } finally {
        setIsUpdating(false);
      }
    },
    [alert.id, onSeen, onDismissed],
  );

  return (
    <div
      style={{
        background: "#151821",
        border: "1px solid #262b38",
        borderRadius: 12,
        padding: "14px 18px",
        marginBottom: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span
              style={{
                background: style.bg,
                color: style.fg,
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 999,
                letterSpacing: 0.3,
              }}
            >
              {style.label}
            </span>
            {alert.status === "ACTIVE_UNSEEN" ? (
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4fd18f", display: "inline-block" }} aria-label="não visto" />
            ) : null}
          </div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{alert.title}</div>
          {alert.detail ? <div style={{ fontSize: 13, color: "#c7cbd6", marginTop: 4 }}>{alert.detail}</div> : null}
          {alert.relatedAction ? <div style={{ fontSize: 12, color: "#8b93a7", marginTop: 6 }}>{alert.relatedAction}</div> : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
          {alert.status === "ACTIVE_UNSEEN" ? (
            <button
              onClick={() => void act("SEEN")}
              disabled={isUpdating}
              style={{
                background: "#262b38",
                color: "#e6e8ec",
                border: "1px solid #3a4152",
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 12,
                cursor: isUpdating ? "default" : "pointer",
              }}
            >
              Marcar como visto
            </button>
          ) : null}
          <button
            onClick={() => void act("DISMISS")}
            disabled={isUpdating}
            style={{
              background: "transparent",
              color: "#8b93a7",
              border: "1px solid #3a4152",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 12,
              cursor: isUpdating ? "default" : "pointer",
            }}
          >
            Dispensar
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Sprint 7: the dashboard's alert surface. Alert CREATION/lifecycle is
 * entirely server-side/deterministic (`evaluateAlerts`) — this component
 * only ever reads what the server already computed and lets the user mark
 * seen/dismiss, then refreshes the server-rendered page so the change is
 * reflected everywhere at once (never a locally-guessed optimistic state
 * that could drift from the real deterministic engine). See
 * docs/ALERTS-NOTIFICATIONS.md, "Alert Center UI."
 */
export function AlertCenter({ alerts }: { alerts: readonly AlertCardData[] }) {
  const router = useRouter();
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  const handleSeen = useCallback(() => router.refresh(), [router]);
  const handleDismissed = useCallback(
    (id: string) => {
      setHiddenIds((prev) => new Set(prev).add(id));
      router.refresh();
    },
    [router],
  );

  const visible = alerts.filter((a) => !hiddenIds.has(a.id));

  if (visible.length === 0) {
    return <p style={{ color: "#8b93a7" }}>Nada precisa da sua atenção agora.</p>;
  }

  return (
    <div>
      {visible.map((alert) => (
        <AlertCard key={alert.id} alert={alert} onSeen={handleSeen} onDismissed={handleDismissed} />
      ))}
    </div>
  );
}
