import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowUp, Sparkles } from "lucide-react";
import { PhoneShell, ScreenHeader } from "@/components/ritmo/PhoneShell";
import { ThemeToggle } from "@/components/ritmo/ThemeToggle";
import { RitmoMark } from "@/components/ritmo/RitmoMark";
import { getAssistenteData, sendAssistenteMessage } from "@/functions/assistente";
import {
  parseInlineMarkdown,
  toAssistenteMessages,
  toSimulationCard,
  type AssistenteMessage,
  type SimulationCard,
} from "@/adapters/assistente";

export const Route = createFileRoute("/assistente")({
  head: () => ({
    meta: [
      { title: "Assistente Ritmo — Converse sobre o seu dinheiro" },
      {
        name: "description",
        content:
          "Pergunte se pode gastar hoje, entenda seu mês e descubra quanto sobra até o próximo salário.",
      },
      { property: "og:title", content: "Assistente Ritmo" },
      {
        property: "og:description",
        content: "Um assistente financeiro calmo, claro e no seu ritmo.",
      },
    ],
  }),
  loader: () => getAssistenteData(),
  component: Assistente,
});

const atalhos = [
  "Posso gastar hoje?",
  "Explique meu mês",
  "Como está meu ritmo?",
  "Me ajude a economizar",
  "Quanto sobra até o próximo salário?",
];

function Assistente() {
  const data = Route.useLoaderData();
  const [conversationId, setConversationId] = useState<string | undefined>(
    data.conversationId ?? undefined,
  );
  const [messages, setMessages] = useState<AssistenteMessage[]>(() => toAssistenteMessages(data));
  const [simulationByMessageId, setSimulationByMessageId] = useState<
    Record<string, SimulationCard>
  >({});
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    setInput("");
    setPending(true);
    const userMessageId = `local-user-${Date.now()}`;
    setMessages((prev) => [...prev, { id: userMessageId, role: "user", text: trimmed }]);

    const result = await sendAssistenteMessage({ data: { conversationId, message: trimmed } });

    if (result.ok) {
      setConversationId(result.conversationId);
      const assistantMessageId = `local-assistant-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: assistantMessageId, role: "assistant", text: result.text },
      ]);
      const simulationCard = toSimulationCard(result.financialFacts);
      if (simulationCard) {
        setSimulationByMessageId((prev) => ({ ...prev, [assistantMessageId]: simulationCard }));
      }
    } else {
      setMessages((prev) => [
        ...prev,
        { id: `local-error-${Date.now()}`, role: "assistant", text: result.error.message },
      ]);
    }
    setPending(false);
  }

  return (
    <PhoneShell>
      <ScreenHeader
        title="Assistente"
        subtitle="Aprende com o seu ritmo"
        action={<ThemeToggle />}
      />

      <div className="space-y-4">
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[80%] rounded-3xl rounded-br-lg brand-gradient px-4 py-3">
                <p className="text-[14px] leading-relaxed text-primary-foreground">{m.text}</p>
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent">
                <RitmoMark className="h-5 w-5" />
              </div>
              <div className="min-w-0 space-y-3">
                <div className="rounded-3xl rounded-tl-lg border border-border bg-card px-4 py-3">
                  <p className="text-[14px] leading-relaxed">
                    {parseInlineMarkdown(m.text).map((segment, i) =>
                      segment.bold ? (
                        <span key={i} className="font-semibold">
                          {segment.text}
                        </span>
                      ) : (
                        <span key={i}>{segment.text}</span>
                      ),
                    )}
                  </p>
                </div>
                {simulationByMessageId[m.id] ? (
                  <div className="surface p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Simulação
                    </p>
                    <div className="mt-3 flex items-end justify-between">
                      <div>
                        <p className="text-[12px] text-muted-foreground">Limite recomendado</p>
                        <p className="num text-[20px] font-extrabold">
                          {simulationByMessageId[m.id]!.recommendedLimitLabel}
                        </p>
                      </div>
                      <div className="mx-3 h-px flex-1 bg-border" />
                      <div className="text-right">
                        <p className="text-[12px] text-muted-foreground">Economia projetada</p>
                        <p className="num text-[20px] font-extrabold text-[var(--coral)]">
                          {simulationByMessageId[m.id]!.projectedSavingsAfterLabel}
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
                      Compensação necessária para manter sua meta:{" "}
                      {simulationByMessageId[m.id]!.compensationRequiredLabel}.
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          ),
        )}
        {pending ? (
          <div className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent">
              <RitmoMark className="h-5 w-5" />
            </div>
            <div className="min-w-0 rounded-3xl rounded-tl-lg border border-border bg-card px-4 py-3">
              <p className="text-[14px] leading-relaxed text-muted-foreground">Pensando…</p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="sticky bottom-0 -mx-5 mt-8 bg-gradient-to-t from-background via-background to-transparent px-5 pb-1 pt-6">
        <div className="no-scrollbar -mx-5 mb-3 flex gap-2 overflow-x-auto px-5">
          {atalhos.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => void send(a)}
              className="shrink-0 rounded-full border border-border bg-card px-3.5 py-2 text-[12.5px] font-medium text-foreground"
            >
              {a}
            </button>
          ))}
        </div>
        <form
          className="flex items-center gap-2 rounded-full border border-border bg-card p-1.5 pl-4 shadow-[var(--shadow-soft)]"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pergunte sobre o seu dinheiro…"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={pending || input.trim().length === 0}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full brand-gradient disabled:opacity-50"
          >
            <ArrowUp className="h-4 w-4 text-primary-foreground" />
          </button>
        </form>
      </div>
    </PhoneShell>
  );
}
