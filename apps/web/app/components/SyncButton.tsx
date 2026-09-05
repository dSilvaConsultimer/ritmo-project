"use client";

import { useCallback, useState } from "react";

interface SyncButtonProps {
  connectionId: string;
  onSynced: () => void;
}

/**
 * Manual synchronization trigger — local development (and the founder,
 * later) should never depend entirely on webhook delivery to see fresh
 * data. See docs/OPEN-FINANCE.md, "Manual sync vs. provider auto-sync."
 */
export function SyncButton({ connectionId, onSynced }: SyncButtonProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    setError(null);
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      if (!response.ok) throw new Error("Sync failed");
      onSynced();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  }, [connectionId, onSynced]);

  return (
    <div>
      <button
        onClick={handleSync}
        disabled={isSyncing}
        style={{
          background: "#262b38",
          color: "#e6e8ec",
          border: "1px solid #3a4152",
          borderRadius: 8,
          padding: "8px 14px",
          fontSize: 13,
          cursor: isSyncing ? "default" : "pointer",
          opacity: isSyncing ? 0.7 : 1,
        }}
      >
        {isSyncing ? "Syncing…" : "Refresh / sync"}
      </button>
      {error ? <p style={{ color: "#e08a8a", fontSize: 12, marginTop: 4 }}>{error}</p> : null}
    </div>
  );
}
