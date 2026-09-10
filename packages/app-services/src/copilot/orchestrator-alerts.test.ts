import { describe, expect, it } from "vitest";
import { fixtureProfile, fromReais } from "@money-copilot/financial-engine";
import { MockAIProvider, mockTextResult, mockToolCallResult } from "@money-copilot/ai";
import { freshSeededDb } from "../test-helpers";
import { evaluateAlerts, listAlertsForProfile } from "../alerts";
import { recordManualTransaction } from "../mutations";
import { runCopilotTurn } from "./orchestrator";

const ASOF = "2026-09-05";
const MODEL = "gpt-5.6-terra";

function baseInput(overrides: Partial<Parameters<typeof runCopilotTurn>[0]> = {}) {
  return {
    financialProfileId: fixtureProfile.id,
    asOfDate: ASOF,
    userMessageText: "Tenho algum alerta?",
    model: MODEL,
    ...overrides,
  } as Parameters<typeof runCopilotTurn>[0];
}

async function makeMaterialAlert(db: Awaited<ReturnType<typeof freshSeededDb>>) {
  await evaluateAlerts(db, fixtureProfile.id, ASOF); // bootstrap
  await recordManualTransaction(db, fixtureProfile.id, { amount: fromReais(1000), merchantOrDescription: "Big purchase", date: ASOF });
  await evaluateAlerts(db, fixtureProfile.id, ASOF);
  const [alert] = (await listAlertsForProfile(db, fixtureProfile.id)).filter((a) => a.type === "SAFE_TO_SPEND_MATERIAL_DROP");
  return alert!;
}

describe("runCopilotTurn — alerts (Sprint 7)", () => {
  it("(P) getAlerts/getAlertDetails/reevaluateAlertContext never mutate anything", async () => {
    const db = await freshSeededDb();
    const alert = await makeMaterialAlert(db);

    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "getAlerts", argumentsJson: "{}" }]),
      mockTextResult("Você tem 1 alerta ativo: seu Safe-to-Spend caiu."),
    ]);
    const response = await runCopilotTurn(baseInput({ db, aiProvider: provider }));
    expect(response.toolExecutions).toEqual([{ name: "getAlerts", status: "SUCCESS" }]);

    const detailsProvider = new MockAIProvider([
      mockToolCallResult([{ id: "call_2", name: "getAlertDetails", argumentsJson: JSON.stringify({ alertId: alert.id }) }]),
      mockTextResult("Esse alerta existe porque seu Safe-to-Spend caiu."),
    ]);
    const detailsResponse = await runCopilotTurn(
      baseInput({ db, aiProvider: detailsProvider, userMessageText: "Por que você está me avisando disso?" }),
    );
    expect(detailsResponse.toolExecutions).toEqual([{ name: "getAlertDetails", status: "SUCCESS" }]);

    const stillActive = (await listAlertsForProfile(db, fixtureProfile.id)).find((a) => a.id === alert.id);
    expect(stillActive?.status).toBe("ACTIVE_UNSEEN"); // reading never marks seen
  });

  it("(Q) explicit PT-BR mark-seen mutates exactly once", async () => {
    const db = await freshSeededDb();
    const alert = await makeMaterialAlert(db);

    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "markAlertSeen", argumentsJson: JSON.stringify({ alertId: alert.id }) }]),
      mockTextResult("Marquei como visto."),
    ]);
    const response = await runCopilotTurn(baseInput({ db, aiProvider: provider, userMessageText: "Pode marcar como visto." }));
    expect(response.toolExecutions).toEqual([{ name: "markAlertSeen", status: "SUCCESS" }]);

    const updated = (await listAlertsForProfile(db, fixtureProfile.id)).find((a) => a.id === alert.id);
    expect(updated?.status).toBe("ACTIVE_SEEN");
  });

  it("(Q) explicit PT-BR dismiss mutates exactly once", async () => {
    const db = await freshSeededDb();
    const alert = await makeMaterialAlert(db);

    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "dismissAlert", argumentsJson: JSON.stringify({ alertId: alert.id }) }]),
      mockTextResult("Ignorei esse alerta."),
    ]);
    const response = await runCopilotTurn(baseInput({ db, aiProvider: provider, userMessageText: "Pode ignorar esse alerta." }));
    expect(response.toolExecutions).toEqual([{ name: "dismissAlert", status: "SUCCESS" }]);

    const updated = (await listAlertsForProfile(db, fixtureProfile.id)).find((a) => a.id === alert.id);
    expect(updated?.status).toBe("DISMISSED");
  });

  it("(R) hypothetical PT-BR dismiss language does NOT mutate", async () => {
    const db = await freshSeededDb();
    const alert = await makeMaterialAlert(db);

    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "dismissAlert", argumentsJson: JSON.stringify({ alertId: alert.id }) }]),
      mockTextResult("Se você ignorasse, o alerta ficaria dispensado."),
    ]);
    const response = await runCopilotTurn(
      baseInput({ db, aiProvider: provider, userMessageText: "E se eu ignorasse esse alerta?" }),
    );
    expect(response.toolExecutions).toEqual([{ name: "dismissAlert", status: "FAILED" }]);

    const unchanged = (await listAlertsForProfile(db, fixtureProfile.id)).find((a) => a.id === alert.id);
    expect(unchanged?.status).toBe("ACTIVE_UNSEEN");
  });

  it("explicit PT-BR notification-preference change mutates exactly once", async () => {
    const db = await freshSeededDb();
    const provider = new MockAIProvider([
      mockToolCallResult([
        { id: "call_1", name: "updateNotificationPreference", argumentsJson: JSON.stringify({ category: "CONCIERGE", enabled: false }) },
      ]),
      mockTextResult("Prontinho, desativei os alertas de concierge."),
    ]);
    const response = await runCopilotTurn(
      baseInput({ db, aiProvider: provider, userMessageText: "Não quero mais receber alertas de concierge." }),
    );
    expect(response.toolExecutions).toEqual([{ name: "updateNotificationPreference", status: "SUCCESS" }]);
  });

  it("grounding passes when the assistant cites the alert's own evidence amount exactly", async () => {
    const db = await freshSeededDb();
    const alert = await makeMaterialAlert(db);
    const deltaReais = (alert.evidence as { deltaCents: number }).deltaCents / 100;
    const formatted = deltaReais.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "getAlertDetails", argumentsJson: JSON.stringify({ alertId: alert.id }) }]),
      mockTextResult(`Seu Safe-to-Spend caiu R$ ${formatted}.`),
    ]);
    const response = await runCopilotTurn(
      baseInput({ db, aiProvider: provider, userMessageText: "Por que você está me avisando disso?" }),
    );
    expect(response.groundingStatus).not.toBe("FAILED");
  });

  it("grounding fails on an invented alert amount not backed by any tool result", async () => {
    const db = await freshSeededDb();
    await makeMaterialAlert(db);

    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "getAlerts", argumentsJson: "{}" }]),
      mockTextResult("Seu Safe-to-Spend caiu R$ 999.999,00."),
    ]);
    const response = await runCopilotTurn(baseInput({ db, aiProvider: provider }));
    expect(response.groundingStatus).toBe("FAILED");
  });

  it("never suggests reducing the protected family-support commitment when explaining a tighter-budget alert", async () => {
    const db = await freshSeededDb();
    await makeMaterialAlert(db);

    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "getAlerts", argumentsJson: "{}" }]),
      mockTextResult("Seu Safe-to-Spend caiu desde a última atualização — mas isso não afeta o valor protegido para sua mãe."),
    ]);
    const response = await runCopilotTurn(baseInput({ db, aiProvider: provider }));
    expect(response.text.toLowerCase()).not.toMatch(/reduza|cancele a ajuda|corte o valor/);
  });
});
