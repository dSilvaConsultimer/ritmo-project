"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import type { Item } from "pluggy-js";

const PluggyConnect = dynamic(
  () => import("react-pluggy-connect").then((mod) => mod.PluggyConnect),
  { ssr: false, loading: () => null },
);

interface ConnectButtonProps {
  onConnected: () => void;
}

/**
 * "Connect institution" flow: fetches a Connect Token from our own
 * server-side `/api/token` endpoint (CLIENT_ID/CLIENT_SECRET never reach
 * the browser — only this restricted token does), opens the Pluggy
 * Connect widget, and — once the user finishes and Pluggy reports a
 * successful Item — POSTs the resulting `itemId` to `/api/connections`
 * so the server can persist the connection and run the initial import.
 */
export function ConnectButton({ onConnected }: ConnectButtonProps) {
  const [connectToken, setConnectToken] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/token", { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "Failed to create connect token");
      }
      const data = (await response.json()) as { connectToken: string };
      setConnectToken(data.connectToken);
      setIsOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start connection");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSuccess = useCallback(
    async (data: { item: Item }) => {
      setIsOpen(false);
      setConnectToken(null);
      try {
        await fetch("/api/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ externalConnectionId: data.item.id }),
        });
        onConnected();
      } catch {
        setError("Connected, but failed to save the connection. Try Refresh.");
      }
    },
    [onConnected],
  );

  const handleError = useCallback((err: { message?: string }) => {
    setError(err.message ?? "Connection failed");
    setIsOpen(false);
    setConnectToken(null);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setConnectToken(null);
  }, []);

  return (
    <div>
      <button
        onClick={handleOpen}
        disabled={isLoading}
        style={{
          background: "#3b82f6",
          color: "white",
          border: "none",
          borderRadius: 8,
          padding: "10px 18px",
          fontSize: 14,
          fontWeight: 600,
          cursor: isLoading ? "default" : "pointer",
          opacity: isLoading ? 0.7 : 1,
        }}
      >
        {isLoading ? "Loading…" : "Connect institution"}
      </button>
      {error ? <p style={{ color: "#e08a8a", fontSize: 13, marginTop: 6 }}>{error}</p> : null}
      {typeof window !== "undefined" && connectToken && isOpen ? (
        <PluggyConnect
          connectToken={connectToken}
          includeSandbox
          onSuccess={handleSuccess}
          onError={handleError}
          onClose={handleClose}
        />
      ) : null}
    </div>
  );
}
