import { createServerFn } from "@tanstack/react-start";
import {
  getNotificacoesDataHandler,
  updateNotificacoesHandler,
  updateNotificacoesInput,
} from "./notificacoes.server";

export const getNotificacoesData = createServerFn({ method: "GET" }).handler(
  getNotificacoesDataHandler,
);
export type { NotificacoesData } from "./notificacoes.server";

export const updateNotificacoes = createServerFn({ method: "POST" })
  .validator(updateNotificacoesInput)
  .handler(({ data }) => updateNotificacoesHandler(data));
