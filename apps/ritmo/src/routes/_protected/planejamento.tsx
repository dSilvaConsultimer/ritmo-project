import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarHeart,
  HelpCircle,
  Plus,
  Repeat,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import { PhoneShell, ScreenHeader } from "@/components/ritmo/PhoneShell";
import { ThemeToggle } from "@/components/ritmo/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategoryPicker, type CategoryOption } from "@/components/ritmo/CategoryPicker";
import {
  getCategorySpendingDetailAction,
  getCategoryTotalsAction,
  getPlanejamentoData,
  type SpendingPeriod,
} from "@/functions/planejamento";
import { brl } from "@/adapters/format";
import {
  toPlanejamentoViewModel,
  type PendingConfirmationView,
  type PlanejamentoRuleItem,
} from "@/adapters/planejamento";
import {
  acceptRecommendationAction,
  categorizeTransactionAction,
  confirmRecurringExpenseAction,
  confirmRecurringIncomeAction,
  createCategoryRuleAction,
  deleteCategoryRuleAction,
  rejectCandidateAction,
  rejectRecommendationAction,
} from "@/functions/planejamento-actions";

export const Route = createFileRoute("/_protected/planejamento")({
  head: () => ({
    meta: [
      { title: "Planejamento do mês — Ritmo" },
      {
        name: "description",
        content:
          "Entradas, saídas, compromissos fixos e eventos planejados do seu mês, de forma visual e calma.",
      },
      { property: "og:title", content: "Planejamento do mês — Ritmo" },
      {
        property: "og:description",
        content: "Veja o desenho completo do seu mês: entradas, compromissos e reservas.",
      },
    ],
  }),
  loader: () => getPlanejamentoData({ data: { period: null } }),
  component: Planejamento,
});

function Planejamento() {
  const data = Route.useLoaderData();
  const vm = toPlanejamentoViewModel(data);
  const router = useRouter();
  const refresh = () => router.invalidate();
  const [categories, setCategories] = useState<CategoryOption[]>(data.categories);
  const handleCategoryCreated = (category: CategoryOption) =>
    setCategories((prev) => (prev.some((c) => c.id === category.id) ? prev : [...prev, category]));

  return (
    <PhoneShell>
      <ScreenHeader title="Planejamento" subtitle="Mês atual" action={<ThemeToggle />} />

      <div className="mb-5 grid grid-cols-2 gap-3">
        <Link
          to="/planejamento-novo"
          className="surface flex items-center justify-center gap-2 p-3.5 text-[13px] font-semibold"
        >
          <Plus className="h-4 w-4 shrink-0 text-primary" />
          Criar manualmente
        </Link>
        <Link
          to="/planejamento-ia"
          className="surface flex items-center justify-center gap-2 p-3.5 text-[13px] font-semibold"
        >
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          Criar com IA
        </Link>
      </div>

      {/* A. Resumo */}
      <section className="surface p-5">
        <p className="text-[12.5px] text-muted-foreground">Disponível até o fim do mês</p>
        <p className="num mt-1 text-[36px] font-extrabold leading-none">{vm.availableLabel}</p>

        <div className="mt-5 flex h-3 w-full overflow-hidden rounded-full bg-muted">
          {vm.legend.map((item) => (
            <div
              key={item.label}
              className={`h-full ${
                item.color === "brand"
                  ? "brand-gradient"
                  : item.color === "coral"
                    ? "bg-[var(--coral)]"
                    : "bg-[var(--success)]"
              }`}
              style={{ width: `${item.percent}%` }}
            />
          ))}
        </div>
        <div className="mt-3 space-y-2">
          {vm.legend.map((item) => (
            <Legend key={item.label} color={item.color} label={item.label} value={item.value} />
          ))}
        </div>
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3">
        <div className="surface p-4">
          <ArrowDownLeft className="h-4 w-4 text-[var(--success)]" />
          <p className="mt-3 text-[12px] text-muted-foreground">Entradas previstas</p>
          <p className="num mt-0.5 text-[17px] font-extrabold">{vm.incomeLabel}</p>
        </div>
        <div className="surface p-4">
          <ArrowUpRight className="h-4 w-4 text-[var(--coral)]" />
          <p className="mt-3 text-[12px] text-muted-foreground">Saídas previstas</p>
          <p className="num mt-0.5 text-[17px] font-extrabold">{vm.outflowLabel}</p>
        </div>
      </section>

      {/* B. Gastos por categoria */}
      <section className="mt-7">
        <h2 className="mb-3 font-display text-[17px] font-bold">Gastos por categoria</h2>
        <CategorySpendingSection
          categories={categories}
          initial={data.categoryTotals}
          initialPeriod={data.categorySpendingPeriod}
          onCategoryCreated={handleCategoryCreated}
        />
      </section>

      {/* C. Próximos compromissos */}
      <section className="mt-7">
        <h2 className="mb-3 font-display text-[17px] font-bold">Próximos compromissos</h2>
        <div className="surface p-5">
          {vm.timeline.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Nenhum evento com data confirmada neste momento.
            </p>
          ) : (
            <ol className="relative space-y-6 border-l border-dashed border-border pl-6">
              {vm.timeline.map((t) => (
                <TimelineItem
                  key={t.id}
                  dia={t.dateLabel}
                  titulo={t.title}
                  valor={t.valueLabel}
                  tone={t.tone}
                  nota={t.note}
                />
              ))}
            </ol>
          )}
        </div>
        <h3 className="mb-3 mt-5 font-display text-[14px] font-bold">Compromissos recorrentes</h3>
        {vm.recorrentes.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Nenhum compromisso fixo cadastrado ainda.
          </p>
        ) : (
          <div className="surface divide-y divide-border overflow-hidden">
            {vm.recorrentes.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <Repeat className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{c.label}</p>
                  <p className="text-[12px] text-muted-foreground">{c.detail}</p>
                </div>
                <p className="num shrink-0 text-[14px] font-bold">{c.amountLabel}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* D. Receitas previstas */}
      <section className="mt-7">
        <h2 className="mb-3 font-display text-[17px] font-bold">Receitas previstas</h2>
        {vm.incomeItems.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nenhuma receita declarada ainda.</p>
        ) : (
          <div className="surface divide-y divide-border overflow-hidden">
            {vm.incomeItems.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-4 py-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <ArrowDownLeft className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{i.label}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {i.dayBadge !== "–" ? `Todo mês · dia ${i.dayBadge}` : "Todo mês"}
                  </p>
                </div>
                <p className="num shrink-0 text-[14px] font-bold text-[var(--success)]">
                  {i.amountLabel}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* E. Ritmo precisa confirmar */}
      {vm.pendingConfirmations.length > 0 && (
        <section className="mt-7">
          <h2 className="mb-3 font-display text-[17px] font-bold">Ritmo precisa confirmar</h2>
          <div className="flex flex-col gap-3">
            {vm.pendingConfirmations.map((item) => (
              <PendingConfirmationCard
                key={pendingKey(item)}
                item={item}
                categories={categories}
                onCategoryCreated={handleCategoryCreated}
                onResolved={refresh}
              />
            ))}
          </div>
        </section>
      )}

      {/* F. Regras e categorias */}
      <section className="mt-7">
        <h2 className="mb-3 font-display text-[17px] font-bold">Regras e categorias</h2>
        <p className="mb-3 text-[12.5px] text-muted-foreground">
          O Ritmo categoriza suas movimentações automaticamente com estas regras, sempre na mesma
          ordem — sem adivinhação. Uma movimentação que não bate com nenhuma regra fica pendente em
          "Ritmo precisa confirmar".
        </p>
        {vm.rules.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nenhuma regra cadastrada ainda.</p>
        ) : (
          <div className="surface mb-3 divide-y divide-border overflow-hidden">
            {vm.rules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} onDeleted={refresh} />
            ))}
          </div>
        )}
        <AddRuleForm
          categories={categories}
          onCategoryCreated={handleCategoryCreated}
          onCreated={refresh}
        />
      </section>

      <section className="mt-7 mb-2">
        <h2 className="mb-3 font-display text-[17px] font-bold">Eventos planejados</h2>
        {vm.eventCards.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nenhum evento planejado no momento.</p>
        ) : (
          vm.eventCards.map((card) => (
            <div key={card.id} className="surface flex items-center gap-4 p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl mark-gradient text-white">
                <CalendarHeart className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold">{card.title}</p>
                <p className="text-[12px] text-muted-foreground">{card.note}</p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full brand-gradient"
                    style={{ width: `${card.progressPercent}%` }}
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </section>
    </PhoneShell>
  );
}

function Legend({
  color,
  label,
  value,
}: {
  color: "brand" | "coral" | "success";
  label: string;
  value: string;
}) {
  const dot =
    color === "brand"
      ? "brand-gradient"
      : color === "coral"
        ? "bg-[var(--coral)]"
        : "bg-[var(--success)]";
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{label}</span>
      <span className="num shrink-0 text-[13px] font-semibold">{value}</span>
    </div>
  );
}

function TimelineItem({
  dia,
  titulo,
  valor,
  nota,
  tone,
  done,
}: {
  dia: string;
  titulo: string;
  valor: string;
  nota: string;
  tone: "in" | "out" | "plan";
  done?: boolean;
}) {
  const dot =
    tone === "in" ? "bg-[var(--success)]" : tone === "out" ? "bg-[var(--coral)]" : "brand-gradient";
  return (
    <li className="relative">
      <span
        className={`absolute -left-[31px] top-1 h-3 w-3 rounded-full ring-4 ring-card ${dot} ${
          done ? "opacity-55" : ""
        }`}
      />
      <p className="text-[11px] font-medium text-muted-foreground">{dia}</p>
      <div className="mt-0.5 flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-[14px] font-semibold">{titulo}</p>
        <p
          className={`num shrink-0 text-[13px] font-bold ${
            tone === "in" ? "text-[var(--success)]" : "text-foreground"
          }`}
        >
          {valor}
        </p>
      </div>
      <p className="text-[12px] text-muted-foreground">{nota}</p>
    </li>
  );
}

interface CategoryTotalRow {
  readonly categoryId: string;
  readonly categoryName: string;
  readonly subcategory: string | null;
  readonly totalCents: number;
  readonly transactionCount: number;
}

interface DrilldownTransaction {
  readonly id: string;
  readonly date: string;
  readonly description: string;
  readonly amountCents: number;
  readonly direction: string;
}

/**
 * DEC-135: "Gastos por categoria" — real CONSUMPTION/FEE/REFUND
 * transactions only (never TRANSFER/CARD_PAYMENT/INVESTMENT — see
 * `monthlyCategoryTotals`'s own doc comment), with a period toggle and a
 * category filter answering "Quanto eu gastei com Transporte este mês?"
 * without asking the AI. Subcategory buckets are rolled up into one total
 * per top-level category for this view — the drill-down still shows every
 * individual transaction.
 */
function CategorySpendingSection({
  categories,
  initial,
  initialPeriod,
  onCategoryCreated,
}: {
  categories: readonly CategoryOption[];
  initial: readonly CategoryTotalRow[];
  initialPeriod: SpendingPeriod;
  onCategoryCreated: (category: CategoryOption) => void;
}) {
  const [period, setPeriod] = useState<SpendingPeriod>(initialPeriod);
  const [totals, setTotals] = useState<readonly CategoryTotalRow[]>(initial);
  const [filter, setFilter] = useState("__all__");
  const [isLoading, setIsLoading] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  async function handlePeriodChange(next: SpendingPeriod) {
    if (next === period) return;
    setPeriod(next);
    setExpandedCategory(null);
    setIsLoading(true);
    const result = await getCategoryTotalsAction({ data: { period: next } });
    setIsLoading(false);
    setTotals(result);
  }

  const rolledUp = new Map<
    string,
    { categoryName: string; totalCents: number; transactionCount: number }
  >();
  for (const t of totals) {
    const existing = rolledUp.get(t.categoryId) ?? {
      categoryName: t.categoryName,
      totalCents: 0,
      transactionCount: 0,
    };
    rolledUp.set(t.categoryId, {
      categoryName: existing.categoryName,
      totalCents: existing.totalCents + t.totalCents,
      transactionCount: existing.transactionCount + t.transactionCount,
    });
  }
  const rows = [...rolledUp.entries()]
    .map(([categoryId, v]) => ({ categoryId, ...v }))
    .sort((a, b) => b.totalCents - a.totalCents);
  const visibleRows = filter === "__all__" ? rows : rows.filter((r) => r.categoryId === filter);
  const grandTotalCents = rows.reduce((sum, r) => sum + r.totalCents, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={period === "current" ? "default" : "outline"}
          className="flex-1"
          onClick={() => void handlePeriodChange("current")}
        >
          Este mês
        </Button>
        <Button
          size="sm"
          variant={period === "previous" ? "default" : "outline"}
          className="flex-1"
          onClick={() => void handlePeriodChange("previous")}
        >
          Mês passado
        </Button>
      </div>

      <select
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value);
          setExpandedCategory(null);
        }}
        className="rounded-xl border border-border bg-card px-3 py-2.5 text-[13.5px]"
      >
        <option value="__all__">Todas as categorias</option>
        <option value="UNCATEGORIZED">Sem categoria</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {isLoading ? (
        <p className="text-[13px] text-muted-foreground">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nenhum gasto registrado neste período.</p>
      ) : (
        <div className="surface divide-y divide-border overflow-hidden">
          {filter === "__all__" && (
            <div className="flex items-center justify-between bg-accent/40 px-4 py-3">
              <p className="text-[13px] font-semibold">Total do período</p>
              <p className="num text-[14px] font-bold">{brl(grandTotalCents)}</p>
            </div>
          )}
          {visibleRows.map((row) => (
            <CategorySpendingRow
              key={row.categoryId}
              categoryId={row.categoryId}
              categoryName={row.categoryName}
              totalCents={row.totalCents}
              transactionCount={row.transactionCount}
              period={period}
              expanded={expandedCategory === row.categoryId}
              onToggle={() =>
                setExpandedCategory(expandedCategory === row.categoryId ? null : row.categoryId)
              }
              categories={categories}
              onCategoryCreated={onCategoryCreated}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CategorySpendingRow({
  categoryId,
  categoryName,
  totalCents,
  transactionCount,
  period,
  expanded,
  onToggle,
  categories,
  onCategoryCreated,
}: {
  categoryId: string;
  categoryName: string;
  totalCents: number;
  transactionCount: number;
  period: SpendingPeriod;
  expanded: boolean;
  onToggle: () => void;
  categories: readonly CategoryOption[];
  onCategoryCreated: (category: CategoryOption) => void;
}) {
  const [transactions, setTransactions] = useState<readonly DrilldownTransaction[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleToggle() {
    onToggle();
    if (transactions === null) {
      setIsLoading(true);
      const result = await getCategorySpendingDetailAction({ data: { period, categoryId } });
      setIsLoading(false);
      setTransactions(result);
    }
  }

  const displayLabel = categoryId === "UNCATEGORIZED" ? "Sem categoria" : categoryName;

  return (
    <div>
      <button
        type="button"
        onClick={() => void handleToggle()}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Tag className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{displayLabel}</p>
          <p className="text-[12px] text-muted-foreground">{transactionCount} movimentação(ões)</p>
        </div>
        <p className="num shrink-0 text-[14px] font-bold">{brl(totalCents)}</p>
      </button>
      {expanded && (
        <div className="border-t border-border bg-muted/30 px-4 py-3">
          {isLoading ? (
            <p className="text-[12px] text-muted-foreground">Carregando…</p>
          ) : (
            <div className="flex flex-col gap-2">
              {transactions?.map((t) => (
                <DrilldownTransactionRow
                  key={t.id}
                  transaction={t}
                  categories={categories}
                  onCategoryCreated={onCategoryCreated}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DrilldownTransactionRow({
  transaction,
  categories,
  onCategoryCreated,
}: {
  transaction: DrilldownTransaction;
  categories: readonly CategoryOption[];
  onCategoryCreated: (category: CategoryOption) => void;
}) {
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSave(alwaysForMerchant: boolean) {
    if (!categoryId) return;
    setIsSaving(true);
    await categorizeTransactionAction({
      data: { transactionId: transaction.id, categoryId, alwaysForMerchant },
    });
    setIsSaving(false);
    setDone(true);
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-card p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[13px]">{transaction.description}</p>
        <p className="num shrink-0 text-[13px] font-semibold">{brl(transaction.amountCents)}</p>
      </div>
      {done ? (
        <p className="text-[11.5px] text-[var(--success)]">Categoria atualizada.</p>
      ) : isCorrecting ? (
        <div className="flex flex-col gap-2">
          <CategoryPicker
            categories={categories}
            value={categoryId}
            onSelect={(c) => setCategoryId(c.id)}
            onCategoryCreated={onCategoryCreated}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={isSaving || !categoryId}
              onClick={() => void handleSave(false)}
            >
              Só esta
            </Button>
            <Button
              size="sm"
              className="flex-1"
              disabled={isSaving || !categoryId}
              onClick={() => void handleSave(true)}
            >
              Todas
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsCorrecting(true)}
          className="self-start text-[11.5px] font-semibold text-primary"
        >
          Corrigir categoria
        </button>
      )}
    </div>
  );
}

function pendingKey(item: PendingConfirmationView): string {
  switch (item.kind) {
    case "UNCATEGORIZED_TRANSACTION":
      return `tx-${item.transactionId}`;
    case "RECURRING_INCOME_CANDIDATE":
    case "RECURRING_EXPENSE_CANDIDATE":
      return `cand-${item.candidateId}`;
    case "RECOMMENDATION":
      return `rec-${item.recommendationId}`;
  }
}

function RuleRow({ rule, onDeleted }: { rule: PlanejamentoRuleItem; onDeleted: () => void }) {
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);
    await deleteCategoryRuleAction({ data: { ruleId: rule.id } });
    setIsDeleting(false);
    onDeleted();
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Tag className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium">{rule.summary}</p>
        <p className="truncate text-[12px] text-muted-foreground">{rule.matchLabel}</p>
        <p className="truncate text-[11px] text-muted-foreground">{rule.originLabel}</p>
      </div>
      {rule.deletable && (
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={isDeleting}
          aria-label="Remover regra"
          className="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function AddRuleForm({
  categories,
  onCategoryCreated,
  onCreated,
}: {
  categories: readonly CategoryOption[];
  onCategoryCreated: (category: CategoryOption) => void;
  onCreated: () => void;
}) {
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!pattern.trim() || !categoryId) return;
    setIsSaving(true);
    setError(null);
    const result = await createCategoryRuleAction({
      data: { matchType: "CONTAINS_MERCHANT", pattern: pattern.trim(), categoryId },
    });
    setIsSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setPattern("");
    setCategoryId(null);
    onCreated();
  }

  return (
    <div className="surface flex flex-col gap-2 p-4">
      <p className="text-[12.5px] font-semibold">Nova regra</p>
      <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="Ex.: UBER" />
      <CategoryPicker
        categories={categories}
        value={categoryId}
        onSelect={(c) => setCategoryId(c.id)}
        onCategoryCreated={onCategoryCreated}
        placeholder="Categoria da regra"
      />
      {error && <p className="text-[12px] text-destructive">{error}</p>}
      <Button
        size="sm"
        onClick={() => void handleSubmit()}
        disabled={isSaving || !pattern.trim() || !categoryId}
      >
        Adicionar
      </Button>
    </div>
  );
}

function PendingConfirmationCard({
  item,
  categories,
  onCategoryCreated,
  onResolved,
}: {
  item: PendingConfirmationView;
  categories: readonly CategoryOption[];
  onCategoryCreated: (category: CategoryOption) => void;
  onResolved: () => void;
}) {
  if (item.kind === "UNCATEGORIZED_TRANSACTION") {
    return (
      <UncategorizedCard
        item={item}
        categories={categories}
        onCategoryCreated={onCategoryCreated}
        onResolved={onResolved}
      />
    );
  }
  if (item.kind === "RECURRING_INCOME_CANDIDATE" || item.kind === "RECURRING_EXPENSE_CANDIDATE") {
    return (
      <RecurringCandidateCard
        item={item}
        categories={categories}
        onCategoryCreated={onCategoryCreated}
        onResolved={onResolved}
      />
    );
  }
  return <RecommendationCard item={item} onResolved={onResolved} />;
}

function PendingCardShell({
  icon,
  title,
  subtitle,
  amountLabel,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  amountLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="surface p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{title}</p>
          <p className="text-[12px] text-muted-foreground">{subtitle}</p>
        </div>
        {amountLabel && <p className="num shrink-0 text-[14px] font-bold">{amountLabel}</p>}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function UncategorizedCard({
  item,
  categories,
  onCategoryCreated,
  onResolved,
}: {
  item: Extract<PendingConfirmationView, { kind: "UNCATEGORIZED_TRANSACTION" }>;
  categories: readonly CategoryOption[];
  onCategoryCreated: (category: CategoryOption) => void;
  onResolved: () => void;
}) {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSave(alwaysForMerchant: boolean) {
    if (!categoryId) return;
    setIsSaving(true);
    setError(null);
    const result = await categorizeTransactionAction({
      data: { transactionId: item.transactionId, categoryId, alwaysForMerchant },
    });
    setIsSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (alwaysForMerchant && result.retroactivelyReclassifiedCount > 0) {
      setSuccessMessage(
        `Combinado. ${result.retroactivelyReclassifiedCount} movimentação(ões) antiga(s) da ${item.title} também foram reclassificadas.`,
      );
      setTimeout(onResolved, 1800);
      return;
    }
    onResolved();
  }

  return (
    <PendingCardShell
      icon={<HelpCircle className="h-4 w-4" />}
      title={item.title}
      subtitle={item.subtitle}
      amountLabel={item.amountLabel}
    >
      {successMessage ? (
        <p className="text-[12.5px] text-[var(--success)]">{successMessage}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <CategoryPicker
            categories={categories}
            value={categoryId}
            onSelect={(c) => {
              setCategoryId(c.id);
              setCategoryName(c.name);
            }}
            onCategoryCreated={onCategoryCreated}
            placeholder="Qual categoria?"
          />
          {error && <p className="text-[12px] text-destructive">{error}</p>}
          <p className="text-[12px] text-muted-foreground">
            Usar "{categoryName ?? "..."}" só nesta movimentação ou em todas da {item.title}?
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => void handleSave(false)}
              disabled={isSaving || !categoryId}
            >
              Só esta
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={() => void handleSave(true)}
              disabled={isSaving || !categoryId}
            >
              Todas, passadas e futuras
            </Button>
          </div>
        </div>
      )}
    </PendingCardShell>
  );
}

function RecurringCandidateCard({
  item,
  categories,
  onCategoryCreated,
  onResolved,
}: {
  item: Extract<
    PendingConfirmationView,
    { kind: "RECURRING_INCOME_CANDIDATE" | "RECURRING_EXPENSE_CANDIDATE" }
  >;
  categories: readonly CategoryOption[];
  onCategoryCreated: (category: CategoryOption) => void;
  onResolved: () => void;
}) {
  const isIncome = item.kind === "RECURRING_INCOME_CANDIDATE";
  const [label, setLabel] = useState(item.title);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!label.trim() || (!isIncome && (!categoryId || !categoryName))) return;
    setIsSaving(true);
    setError(null);
    const result = isIncome
      ? await confirmRecurringIncomeAction({
          data: { candidateId: item.candidateId, label: label.trim() },
        })
      : await confirmRecurringExpenseAction({
          data: { candidateId: item.candidateId, label: label.trim(), category: categoryName! },
        });
    setIsSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onResolved();
  }

  async function handleReject() {
    setIsSaving(true);
    setError(null);
    const result = await rejectCandidateAction({
      data: { candidateId: item.candidateId, kind: isIncome ? "INCOME" : "FIXED_EXPENSE" },
    });
    setIsSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onResolved();
  }

  return (
    <PendingCardShell
      icon={<Repeat className="h-4 w-4" />}
      title={item.title}
      subtitle={item.subtitle}
      amountLabel={item.amountLabel}
    >
      <div className="flex flex-col gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nome" />
        {!isIncome && (
          <CategoryPicker
            categories={categories}
            value={categoryId}
            onSelect={(c) => {
              setCategoryId(c.id);
              setCategoryName(c.name);
            }}
            onCategoryCreated={onCategoryCreated}
            placeholder="Categoria"
          />
        )}
        {error && <p className="text-[12px] text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            onClick={() => void handleConfirm()}
            disabled={isSaving || !label.trim() || (!isIncome && !categoryId)}
          >
            Confirmar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => void handleReject()}
            disabled={isSaving}
          >
            Não é recorrente
          </Button>
        </div>
      </div>
    </PendingCardShell>
  );
}

function RecommendationCard({
  item,
  onResolved,
}: {
  item: Extract<PendingConfirmationView, { kind: "RECOMMENDATION" }>;
  onResolved: () => void;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setIsSaving(true);
    setError(null);
    const result = await acceptRecommendationAction({
      data: { recommendationId: item.recommendationId },
    });
    setIsSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onResolved();
  }

  async function handleReject() {
    setIsSaving(true);
    setError(null);
    const result = await rejectRecommendationAction({
      data: { recommendationId: item.recommendationId },
    });
    setIsSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onResolved();
  }

  return (
    <PendingCardShell
      icon={<Sparkles className="h-4 w-4" />}
      title={item.title}
      subtitle={item.subtitle}
    >
      <div className="flex flex-col gap-2">
        {error && <p className="text-[12px] text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            onClick={() => void handleAccept()}
            disabled={isSaving}
          >
            Aceitar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => void handleReject()}
            disabled={isSaving}
          >
            Rejeitar
          </Button>
        </div>
      </div>
    </PendingCardShell>
  );
}
