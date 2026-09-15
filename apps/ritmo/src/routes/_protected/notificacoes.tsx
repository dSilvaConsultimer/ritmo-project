import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PhoneShell, ScreenHeader } from "@/components/ritmo/PhoneShell";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  getNotificacoesData,
  updateNotificacoes,
  type NotificacoesData,
} from "@/functions/notificacoes";

export const Route = createFileRoute("/_protected/notificacoes")({
  head: () => ({ meta: [{ title: "Notificações — Ritmo" }] }),
  loader: () => getNotificacoesData(),
  component: Notificacoes,
});

const CATEGORIES = [
  {
    key: "financialChangeEnabled",
    category: "FINANCIAL_CHANGE",
    label: "Mudanças financeiras",
    hint: "Quedas relevantes no seu Safe-to-Spend",
  },
  {
    key: "plannedEventsEnabled",
    category: "PLANNED_EVENTS",
    label: "Eventos planejados",
    hint: "Pressão de custo em eventos com data próxima",
  },
  {
    key: "recommendationsEnabled",
    category: "RECOMMENDATIONS",
    label: "Recomendações",
    hint: "Resultado de recomendações verificadas",
  },
  {
    key: "connectionHealthEnabled",
    category: "CONNECTION_HEALTH",
    label: "Conexões bancárias",
    hint: "Quando uma conexão precisa de atenção",
  },
  {
    key: "conciergeEnabled",
    category: "CONCIERGE",
    label: "Assistente",
    hint: "Planos do assistente que ficaram parados",
  },
] as const;

function Notificacoes() {
  const initialData = Route.useLoaderData();
  const [data, setData] = useState<NotificacoesData>(initialData);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [quietStart, setQuietStart] = useState(data.quietHoursStart ?? "");
  const [quietEnd, setQuietEnd] = useState(data.quietHoursEnd ?? "");

  async function apply(key: string, patch: Parameters<typeof updateNotificacoes>[0]["data"]) {
    setSavingKey(key);
    try {
      const updated = await updateNotificacoes({ data: patch });
      setData(updated);
    } finally {
      setSavingKey(null);
    }
  }

  async function handleSaveQuietHours() {
    if (!quietStart || !quietEnd) return;
    await apply("quietHours", { quietHoursStart: quietStart, quietHoursEnd: quietEnd });
  }

  async function handleClearQuietHours() {
    setQuietStart("");
    setQuietEnd("");
    await apply("quietHours", { quietHoursStart: null, quietHoursEnd: null });
  }

  return (
    <PhoneShell>
      <ScreenHeader title="Notificações" backTo="/mais" />

      <section>
        <h2 className="mb-3 font-display text-[15px] font-bold">Geral</h2>
        <div className="surface flex items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium">Notificações no app</p>
            <p className="text-[12px] text-muted-foreground">Alertas dentro do Ritmo</p>
          </div>
          <Switch
            checked={data.inAppEnabled}
            disabled={savingKey === "inAppEnabled"}
            onCheckedChange={(checked) => void apply("inAppEnabled", { inAppEnabled: checked })}
          />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 font-display text-[15px] font-bold">Categorias</h2>
        <div className="surface divide-y divide-border overflow-hidden">
          {CATEGORIES.map((c) => (
            <div key={c.key} className="flex items-center gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{c.label}</p>
                <p className="truncate text-[12px] text-muted-foreground">{c.hint}</p>
              </div>
              <Switch
                checked={data[c.key]}
                disabled={savingKey === c.key}
                onCheckedChange={(checked) =>
                  void apply(c.key, { category: c.category, enabled: checked })
                }
              />
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 font-display text-[15px] font-bold">Privacidade</h2>
        <div className="surface flex items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium">Mostrar valores</p>
            <p className="text-[12px] text-muted-foreground">
              Permite que futuras notificações externas mostrem valores em reais
            </p>
          </div>
          <Switch
            checked={data.privacyMode === "AMOUNT_ALLOWED"}
            disabled={savingKey === "privacyMode"}
            onCheckedChange={(checked) =>
              void apply("privacyMode", { privacyMode: checked ? "AMOUNT_ALLOWED" : "GENERIC" })
            }
          />
        </div>
      </section>

      <section className="mt-6 mb-2">
        <h2 className="mb-3 font-display text-[15px] font-bold">Horário silencioso</h2>
        <div className="surface flex flex-col gap-3 p-4">
          <p className="text-[12px] text-muted-foreground">
            Notificações continuam existindo dentro do app — este horário só se aplica a um futuro
            canal externo (push/e-mail).
          </p>
          <div className="flex items-center gap-3">
            <Input
              type="time"
              value={quietStart}
              onChange={(e) => setQuietStart(e.target.value)}
              aria-label="Início do horário silencioso"
            />
            <span className="text-[13px] text-muted-foreground">até</span>
            <Input
              type="time"
              value={quietEnd}
              onChange={(e) => setQuietEnd(e.target.value)}
              aria-label="Fim do horário silencioso"
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 rounded-full"
              disabled={!quietStart || !quietEnd || savingKey === "quietHours"}
              onClick={() => void handleSaveQuietHours()}
            >
              Salvar horário
            </Button>
            {data.quietHoursStart ? (
              <Button
                size="sm"
                variant="outline"
                className="flex-1 rounded-full"
                disabled={savingKey === "quietHours"}
                onClick={() => void handleClearQuietHours()}
              >
                Remover
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    </PhoneShell>
  );
}
