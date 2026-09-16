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
import { Checkbox } from "@/components/ui/checkbox";
import { getPlanejamentoData } from "@/functions/planejamento";
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
  loader: () => getPlanejamentoData(),
  component: Planejamento,
});

function Planejamento() {
  const data = Route.useLoaderData();
  const vm = toPlanejamentoViewModel(data);
  const router = useRouter();
  const refresh = () => router.invalidate();

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

      {vm.pendingConfirmations.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-3 font-display text-[17px] font-bold">Ritmo precisa confirmar</h2>
          <div className="flex flex-col gap-3">
            {vm.pendingConfirmations.map((item) => (
              <PendingConfirmationCard key={pendingKey(item)} item={item} onResolved={refresh} />
            ))}
          </div>
        </section>
      )}

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

      <section className="mt-7">
        <h2 className="mb-3 font-display text-[17px] font-bold">Linha do mês</h2>
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
      </section>

      <section className="mt-7">
        <h2 className="mb-3 font-display text-[17px] font-bold">Compromissos recorrentes</h2>
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
        <AddRuleForm onCreated={refresh} />
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

function AddRuleForm({ onCreated }: { onCreated: () => void }) {
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!pattern.trim() || !category.trim()) return;
    setIsSaving(true);
    setError(null);
    const result = await createCategoryRuleAction({
      data: { matchType: "CONTAINS_MERCHANT", pattern: pattern.trim(), category: category.trim() },
    });
    setIsSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setPattern("");
    setCategory("");
    onCreated();
  }

  return (
    <div className="surface flex flex-col gap-2 p-4">
      <p className="text-[12.5px] font-semibold">Nova regra</p>
      <div className="flex gap-2">
        <Input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="Ex.: UBER"
          className="flex-1"
        />
        <Input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Ex.: Transporte"
          className="flex-1"
        />
      </div>
      {error && <p className="text-[12px] text-destructive">{error}</p>}
      <Button
        size="sm"
        onClick={() => void handleSubmit()}
        disabled={isSaving || !pattern.trim() || !category.trim()}
      >
        Adicionar
      </Button>
    </div>
  );
}

function PendingConfirmationCard({
  item,
  onResolved,
}: {
  item: PendingConfirmationView;
  onResolved: () => void;
}) {
  if (item.kind === "UNCATEGORIZED_TRANSACTION") {
    return <UncategorizedCard item={item} onResolved={onResolved} />;
  }
  if (item.kind === "RECURRING_INCOME_CANDIDATE" || item.kind === "RECURRING_EXPENSE_CANDIDATE") {
    return <RecurringCandidateCard item={item} onResolved={onResolved} />;
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
  onResolved,
}: {
  item: Extract<PendingConfirmationView, { kind: "UNCATEGORIZED_TRANSACTION" }>;
  onResolved: () => void;
}) {
  const [category, setCategory] = useState("");
  const [always, setAlways] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!category.trim()) return;
    setIsSaving(true);
    setError(null);
    const result = await categorizeTransactionAction({
      data: {
        transactionId: item.transactionId,
        category: category.trim(),
        alwaysForMerchant: always,
      },
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
      icon={<HelpCircle className="h-4 w-4" />}
      title={item.title}
      subtitle={item.subtitle}
      amountLabel={item.amountLabel}
    >
      <div className="flex flex-col gap-2">
        <Input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Qual categoria?"
        />
        <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Checkbox checked={always} onCheckedChange={(c) => setAlways(c === true)} />
          Sempre classificar assim
        </label>
        {error && <p className="text-[12px] text-destructive">{error}</p>}
        <Button size="sm" onClick={() => void handleSave()} disabled={isSaving || !category.trim()}>
          Salvar
        </Button>
      </div>
    </PendingCardShell>
  );
}

function RecurringCandidateCard({
  item,
  onResolved,
}: {
  item: Extract<
    PendingConfirmationView,
    { kind: "RECURRING_INCOME_CANDIDATE" | "RECURRING_EXPENSE_CANDIDATE" }
  >;
  onResolved: () => void;
}) {
  const isIncome = item.kind === "RECURRING_INCOME_CANDIDATE";
  const [label, setLabel] = useState(item.title);
  const [category, setCategory] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!label.trim() || (!isIncome && !category.trim())) return;
    setIsSaving(true);
    setError(null);
    const result = isIncome
      ? await confirmRecurringIncomeAction({
          data: { candidateId: item.candidateId, label: label.trim() },
        })
      : await confirmRecurringExpenseAction({
          data: { candidateId: item.candidateId, label: label.trim(), category: category.trim() },
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
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Categoria"
          />
        )}
        {error && <p className="text-[12px] text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            onClick={() => void handleConfirm()}
            disabled={isSaving || !label.trim() || (!isIncome && !category.trim())}
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
