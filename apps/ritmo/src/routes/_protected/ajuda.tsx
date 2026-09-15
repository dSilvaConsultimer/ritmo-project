import { createFileRoute } from "@tanstack/react-router";
import { PhoneShell, ScreenHeader } from "@/components/ritmo/PhoneShell";

/**
 * "Central de ajuda" (Mais → Suporte) — honest, static product
 * documentation. Ritmo has no live support chat/ticketing system yet, so
 * this never pretends to be one; it's the same kind of real content a
 * printed FAQ would carry, not a fabricated dynamic backend.
 */
export const Route = createFileRoute("/_protected/ajuda")({
  head: () => ({ meta: [{ title: "Central de ajuda — Ritmo" }] }),
  component: Ajuda,
});

const TOPICS: readonly { question: string; answer: string }[] = [
  {
    question: "O que é o Safe-to-Spend?",
    answer:
      "É quanto você ainda pode gastar até o fim do mês com tranquilidade — já descontando compromissos fixos, gastos variáveis previstos e reservas para eventos planejados.",
  },
  {
    question: "Como o Ritmo conecta ao meu banco?",
    answer:
      "Através da Pluggy, uma parceira de conexão bancária segura. O Ritmo só lê suas movimentações — nunca move dinheiro, faz pagamentos ou transferências. Suas credenciais bancárias nunca ficam salvas no Ritmo.",
  },
  {
    question: "Como as categorias das movimentações são definidas?",
    answer:
      'Por regras determinísticas (veja "Categorias e regras", em Mais) — nunca por adivinhação. Uma movimentação que não bate com nenhuma regra fica honestamente "Sem categoria".',
  },
  {
    question: "O assistente pode mexer no meu dinheiro sozinho?",
    answer:
      'Não. O assistente só registra algo (um gasto manual, uma reserva para um evento) quando você pede isso de forma explícita e decidida — nunca a partir de uma pergunta hipotética como "e se eu gastasse...".',
  },
  {
    question: "Minha conexão bancária parou de funcionar. O que fazer?",
    answer:
      "Vá em Mais → Instituições conectadas. Se algo precisar de atenção, o Ritmo mostra isso ali com um botão para reconectar.",
  },
];

function Ajuda() {
  return (
    <PhoneShell>
      <ScreenHeader title="Central de ajuda" backTo="/mais" />

      <div className="flex flex-col gap-3">
        {TOPICS.map((topic) => (
          <div key={topic.question} className="surface p-4">
            <p className="text-[14px] font-semibold">{topic.question}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {topic.answer}
            </p>
          </div>
        ))}
      </div>
    </PhoneShell>
  );
}
