import { createServerFn } from "@tanstack/react-start";
import {
  createManualPlanningItemHandler,
  createManualPlanningItemInput,
} from "./planejamento-criar.server";

export const createManualPlanningItem = createServerFn({ method: "POST" })
  .validator(createManualPlanningItemInput)
  .handler(({ data }) => createManualPlanningItemHandler(data));
