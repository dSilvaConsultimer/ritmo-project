import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { PhoneShell, ScreenHeader } from "@/components/ritmo/PhoneShell";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  confirmPlanningDraft,
  requestPlanningDraft,
  type PlanningDraft,
} from "@/functions/planejamento-ia";

/**
 * AI-assisted planning creation (Planejamento → "Criar com IA"). The AI
 * only ever proposes a DRAFT (`requestPlanningDraft`) — nothing is
 * persisted until the user explicitly reviews and confirms it
 * (`confirmPlanningDraft`), which saves through the exact same
 * `createFixedExpense`/`createPlannedFinancialEvent` primitives manual
 * creation uses. The draft stays fully editable here before saving — the
 * AI interprets intent, the user (and the real financial engine) stay in
 * control of what's actually recorded.
 */
export const Route = createFileRoute("/_protected/planejamento-ia")({
  head: () => ({ meta: [{ title: "Criar com IA — Ritmo" }] }),
  component: PlanejamentoIA,
});

type Step = "prompt" | "review";

function PlanejamentoIA() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("prompt");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<PlanningDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function handleInterpret() {
    setError(null);
    setIsBusy(true);
    const result = await requestPlanningDraft({ data: { message } });
    setIsBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setDraft(result.draft);
    setStep("review");
  }

  async function handleConfirm() {
    if (!draft) return;
    setError(null);
    setIsBusy(true);
    const result = await confirmPlanningDraft({ data: draft });
    setIsBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    navigate({ to: "/planejamento" });
  }

  function updateDraft(patch: Partial<PlanningDraft>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  if (step === "review" && draft) {
    return (
      <PhoneShell>
        <ScreenHeader title="Revisar antes de salvar" backTo="/planejamento" />

        <div className="surface mb-5 flex items-start gap-3 p-4">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-[13px] text-foreground">{draft.rationale}</p>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-foreground">Tipo</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => updateDraft({ kind: "event" })}
                className={`rounded-2xl border p-3 text-left transition-all ${
                  draft.kind === "event" ? "border-primary bg-accent" : "border-border bg-card"
                }`}
              >
                <p className="font-display text-sm font-bold">Evento</p>
              </button>
              <button
                type="button"
                onClick={() => updateDraft({ kind: "fixed_expense" })}
                className={`rounded-2xl border p-3 text-left transition-all ${
                  draft.kind === "fixed_expense"
                    ? "border-primary bg-accent"
                    : "border-border bg-card"
                }`}
              >
                <p className="font-display text-sm font-bold">Compromisso fixo</p>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="draft-label" className="text-[13px] font-semibold text-foreground">
              Nome
            </label>
            <Input
              id="draft-label"
              value={draft.label}
              onChange={(e) => updateDraft({ label: e.target.value })}
            />
          </div>

          {draft.kind === "fixed_expense" ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="draft-category" className="text-[13px] font-semibold text-foreground">
                Categoria
              </label>
              <Input
                id="draft-category"
                value={draft.category ?? ""}
                onChange={(e) => updateDraft({ category: e.target.value || null })}
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="draft-amount" className="text-[13px] font-semibold text-foreground">
              {draft.kind === "event" ? "Orçamento (opcional)" : "Valor"}
            </label>
            <Input
              id="draft-amount"
              type="number"
              min="0"
              step="0.01"
              value={draft.amountReais ?? ""}
              onChange={(e) =>
                updateDraft({ amountReais: e.target.value ? Number(e.target.value) : null })
              }
              placeholder="0,00"
            />
          </div>

          {draft.kind === "event" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="draft-start" className="text-[13px] font-semibold text-foreground">
                  Data de início
                </label>
                <Input
                  id="draft-start"
                  type="date"
                  value={draft.startDate ?? ""}
                  onChange={(e) => updateDraft({ startDate: e.target.value || null })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="draft-end" className="text-[13px] font-semibold text-foreground">
                  Data de fim (opcional)
                </label>
                <Input
                  id="draft-end"
                  type="date"
                  value={draft.endDate ?? ""}
                  onChange={(e) => updateDraft({ endDate: e.target.value || null })}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="draft-due" className="text-[13px] font-semibold text-foreground">
                Dia do vencimento (opcional)
              </label>
              <Input
                id="draft-due"
                type="number"
                min="1"
                max="31"
                value={draft.dueDayOfMonth ?? ""}
                onChange={(e) =>
                  updateDraft({ dueDayOfMonth: e.target.value ? Number(e.target.value) : null })
                }
              />
            </div>
          )}

          {error ? <p className="text-[13px] text-destructive">{error}</p> : null}

          <Button
            size="lg"
            className="mt-2 rounded-full"
            disabled={isBusy}
            onClick={() => void handleConfirm()}
          >
            {isBusy ? "Salvando..." : "Confirmar e salvar"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            disabled={isBusy}
            onClick={() => {
              setStep("prompt");
              setDraft(null);
              setError(null);
            }}
          >
            Tentar de novo
          </Button>
        </div>
      </PhoneShell>
    );
  }

  return (
    <PhoneShell>
      <ScreenHeader title="Criar com IA" backTo="/planejamento" />

      <p className="mb-4 text-[13px] text-muted-foreground">
        Descreva o que você quer planejar, do seu jeito. A IA interpreta e te mostra um rascunho —
        nada é salvo até você confirmar.
      </p>

      <div className="flex flex-col gap-4">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ex.: Quero viajar em dezembro e gastar até 4 mil"
          rows={4}
        />
        {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
        <Button
          size="lg"
          className="rounded-full"
          disabled={isBusy || message.trim().length === 0}
          onClick={() => void handleInterpret()}
        >
          {isBusy ? "Interpretando..." : "Interpretar com IA"}
        </Button>
      </div>
    </PhoneShell>
  );
}
