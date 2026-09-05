"use client";

import { useCallback, useEffect, useState } from "react";

interface ChatMessage {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
}

interface FinancialFact {
  label: string;
  amountCents: number;
  certainty: "HIGH" | "MEDIUM" | "LOW";
  sourceTool: string;
  semanticType: string;
}

interface ChatApiResponse {
  conversationId: string;
  text: string;
  financialFacts: FinancialFact[];
  warnings: string[];
  groundingStatus: "PASSED" | "FAILED" | "NOT_APPLICABLE";
}

interface ChatApiError {
  error: { code: string; message: string };
}

const STORAGE_KEY = "money-copilot:conversationId";

const QUICK_ACTIONS = [
  "How much can I spend today?",
  "Can I spend R$ 500?",
  "How am I doing this month?",
  "Why is my Safe-to-Spend this amount?",
  "Am I financially ready to live alone?",
];

function formatCents(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function FactCard({ fact }: { fact: FinancialFact }) {
  return (
    <div
      style={{
        background: "#0f1218",
        border: "1px solid #262b38",
        borderRadius: 8,
        padding: "8px 12px",
        minWidth: 160,
      }}
    >
      <div style={{ fontSize: 11, color: "#8b93a7", textTransform: "uppercase", letterSpacing: 0.4 }}>
        {fact.label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{formatCents(fact.amountCents)}</div>
      {fact.certainty !== "HIGH" ? (
        <div style={{ fontSize: 11, color: "#e0b64f", marginTop: 2 }}>Confidence: {fact.certainty}</div>
      ) : null}
    </div>
  );
}

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFacts, setLastFacts] = useState<FinancialFact[]>([]);
  const [lastWarnings, setLastWarnings] = useState<string[]>([]);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (!stored) return;
    setConversationId(stored);
    fetch(`/api/chat?conversationId=${encodeURIComponent(stored)}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ messages: ChatMessage[] }>) : { messages: [] }))
      .then((data) => setMessages(data.messages ?? []))
      .catch(() => undefined);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isSending) return;

      setError(null);
      setIsSending(true);
      setInput("");
      setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: "USER", content: trimmed }]);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, message: trimmed }),
        });
        const data = (await response.json()) as ChatApiResponse | ChatApiError;

        if (!response.ok || "error" in data) {
          const message = "error" in data ? data.error.message : "Something went wrong.";
          setError(message);
          return;
        }

        setConversationId(data.conversationId);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(STORAGE_KEY, data.conversationId);
        }
        setMessages((prev) => [
          ...prev,
          { id: `assistant-${Date.now()}`, role: "ASSISTANT", content: data.text },
        ]);
        setLastFacts(data.financialFacts);
        setLastWarnings(data.warnings);
      } catch {
        setError("Could not reach the assistant. Please try again.");
      } finally {
        setIsSending(false);
      }
    },
    [conversationId, isSending],
  );

  return (
    <div
      style={{
        background: "#151821",
        border: "1px solid #262b38",
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action}
            onClick={() => void sendMessage(action)}
            disabled={isSending}
            style={{
              background: "#0f1218",
              color: "#c7cbd6",
              border: "1px solid #262b38",
              borderRadius: 999,
              padding: "6px 12px",
              fontSize: 12,
              cursor: isSending ? "default" : "pointer",
            }}
          >
            {action}
          </button>
        ))}
      </div>

      <div
        style={{
          maxHeight: 360,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: "4px 2px",
        }}
      >
        {messages.length === 0 ? (
          <p style={{ color: "#8b93a7", fontSize: 13 }}>
            Ask about your Safe-to-Spend, a specific purchase, or an upcoming plan.
          </p>
        ) : null}
        {messages.map((message) => (
          <div
            key={message.id}
            style={{
              alignSelf: message.role === "USER" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              background: message.role === "USER" ? "#22406b" : "#0f1218",
              border: "1px solid #262b38",
              borderRadius: 10,
              padding: "8px 12px",
              fontSize: 14,
              whiteSpace: "pre-wrap",
            }}
          >
            {message.content}
          </div>
        ))}
        {isSending ? <p style={{ color: "#8b93a7", fontSize: 13 }}>Thinking…</p> : null}
      </div>

      {lastFacts.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {lastFacts.map((fact, index) => (
            <FactCard key={`${fact.semanticType}-${index}`} fact={fact} />
          ))}
        </div>
      ) : null}

      {lastWarnings.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 18, color: "#e0b64f", fontSize: 12 }}>
          {lastWarnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {error ? <p style={{ color: "#e08a8a", fontSize: 13 }}>{error}</p> : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage(input);
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask Money Copilot…"
          disabled={isSending}
          style={{
            flex: 1,
            background: "#0f1218",
            border: "1px solid #262b38",
            borderRadius: 8,
            padding: "8px 12px",
            color: "#e6e8ec",
            fontSize: 14,
          }}
        />
        <button
          type="submit"
          disabled={isSending || input.trim().length === 0}
          style={{
            background: "#262b38",
            color: "#e6e8ec",
            border: "1px solid #3a4152",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 13,
            cursor: isSending ? "default" : "pointer",
            opacity: isSending ? 0.7 : 1,
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
