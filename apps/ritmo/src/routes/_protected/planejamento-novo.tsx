import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { PhoneShell, ScreenHeader } from "@/components/ritmo/PhoneShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createManualPlanningItem } from "@/functions/planejamento-criar";
import { getCategoriesAction } from "@/functions/planejamento-actions";
import { CategoryPicker, type CategoryOption } from "@/components/ritmo/CategoryPicker";

type Kind = "event" | "fixed_expense";

/**
 * Manual planning creation (Planejamento → "Criar manualmente"). Persists
 * through the exact same mutation primitives the AI-assisted flow and the
 * copilot use (`createPlannedFinancialEvent`/`createFixedExpense`) — no
 * parallel/mock planning subsystem. A recurring commitment always needs a
 * real amount + category (the domain has no "unknown recurring amount"
 * concept); an event's budget is optional — omitting it creates an honest
 * "a definir" item rather than inventing a number.
 *
 * DEC-137: a recurring commitment's category is chosen from the canonical
 * `CategoryPicker` — this used to be a free-text input that could produce a
 * category string with no backing `Category` row, invisible to every other
 * category-aware screen. The loader preloads every category visible to
 * this profile, exactly like Planning's own loader.
 */
export const Route = createFileRoute("/_protected/planejamento-novo")({
  head: () => ({ meta: [{ title: "Novo item de planejamento — Ritmo" }] }),
  loader: async () => {
    const result = await getCategoriesAction();
    return { categories: result.ok ? result.categories : [] };
  },
  component: PlanejamentoNovo,
});

function PlanejamentoNovo() {
  const navigate = useNavigate();
  const data = Route.useLoaderData();
  const [categories, setCategories] = useState<CategoryOption[]>([...data.categories]);
  const handleCategoryCreated = (category: CategoryOption) =>
    setCategories((prev) => (prev.some((c) => c.id === category.id) ? prev : [...prev, category]));
  const [kind, setKind] = useState<Kind>("event");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [dueDayOfMonth, setDueDayOfMonth] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const amountReais = amount.trim() ? Number(amount.replace(",", ".")) : undefined;
    const result = await createManualPlanningItem({
      data: {
        kind,
        label,
        ...(amountReais !== undefined ? { amountReais } : {}),
        ...(kind === "fixed_expense" && categoryId ? { categoryId } : {}),
        ...(kind === "event" ? { startDate, endDate: endDate || startDate } : {}),
        ...(kind === "fixed_expense" && dueDayOfMonth.trim()
          ? { dueDayOfMonth: Number(dueDayOfMonth) }
          : {}),
      },
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    navigate({ to: "/planejamento" });
  }

  return (
    <PhoneShell>
      <ScreenHeader title="Novo item" backTo="/planejamento" />

      <div className="mb-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setKind("event")}
          className={`rounded-2xl border p-3 text-left transition-all ${
            kind === "event" ? "border-primary bg-accent" : "border-border bg-card"
          }`}
        >
          <p className="font-display text-sm font-bold">Evento</p>
          <p className="text-[11px] text-muted-foreground">Uma viagem, uma compra pontual</p>
        </button>
        <button
          type="button"
          onClick={() => setKind("fixed_expense")}
          className={`rounded-2xl border p-3 text-left transition-all ${
            kind === "fixed_expense" ? "border-primary bg-accent" : "border-border bg-card"
          }`}
        >
          <p className="font-display text-sm font-bold">Compromisso fixo</p>
          <p className="text-[11px] text-muted-foreground">Um gasto que se repete todo mês</p>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="label" className="text-[13px] font-semibold text-foreground">
            {kind === "event" ? "Nome do evento" : "Nome do compromisso"}
          </label>
          <Input
            id="label"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={kind === "event" ? "Viagem para a praia" : "Aluguel"}
          />
        </div>

        {kind === "fixed_expense" ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-foreground">Categoria</label>
            <CategoryPicker
              categories={categories}
              value={categoryId}
              onSelect={(c) => setCategoryId(c.id)}
              onCategoryCreated={handleCategoryCreated}
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="amount" className="text-[13px] font-semibold text-foreground">
            {kind === "event" ? "Orçamento (opcional)" : "Valor"}
          </label>
          <Input
            id="amount"
            type="number"
            min="0"
            step="0.01"
            required={kind === "fixed_expense"}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
          />
          {kind === "event" ? (
            <p className="text-[11.5px] text-muted-foreground">
              Deixe em branco se ainda não souber o valor — o Ritmo mostra isso honestamente como "a
              definir" em vez de inventar um número.
            </p>
          ) : null}
        </div>

        {kind === "event" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="startDate" className="text-[13px] font-semibold text-foreground">
                Data de início
              </label>
              <Input
                id="startDate"
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="endDate" className="text-[13px] font-semibold text-foreground">
                Data de fim (opcional)
              </label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="dueDay" className="text-[13px] font-semibold text-foreground">
              Dia do vencimento (opcional)
            </label>
            <Input
              id="dueDay"
              type="number"
              min="1"
              max="31"
              value={dueDayOfMonth}
              onChange={(e) => setDueDayOfMonth(e.target.value)}
              placeholder="Ex.: 10"
            />
          </div>
        )}

        {error ? <p className="text-[13px] text-destructive">{error}</p> : null}

        <Button
          type="submit"
          size="lg"
          className="mt-2 rounded-full"
          disabled={isSubmitting || (kind === "fixed_expense" && !categoryId)}
        >
          {isSubmitting ? "Salvando..." : "Salvar"}
        </Button>
      </form>
    </PhoneShell>
  );
}
