import { createServerFn } from "@tanstack/react-start";
import {
  confirmPlanningDraftHandler,
  confirmPlanningDraftInput,
  requestPlanningDraftHandler,
  requestPlanningDraftInput,
} from "./planejamento-ia.server";

export const requestPlanningDraft = createServerFn({ method: "POST" })
  .validator(requestPlanningDraftInput)
  .handler(({ data }) => requestPlanningDraftHandler(data));
export type { PlanningDraft } from "./planejamento-ia.server";

export const confirmPlanningDraft = createServerFn({ method: "POST" })
  .validator(confirmPlanningDraftInput)
  .handler(({ data }) => confirmPlanningDraftHandler(data));
